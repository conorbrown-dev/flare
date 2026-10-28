// Rooms must survive a server restart: messages, order, edits, reactions,
// password, owner and colors all come back from the database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import WebSocket from "ws";

const PORT = 3998;
const BG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DB_FILE = path.join(os.tmpdir(), `flare-persist-${randomUUID()}.db`);

function startServer() {
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/index.js"], {
    env: { ...process.env, PORT: String(PORT), GIPHY_API_KEY: "", DATABASE_FILE: DB_FILE },
    stdio: "pipe",
  });
  return new Promise((resolve, reject) => {
    running.add(proc);
    proc.stdout.on("data", (d) => d.toString().includes("Flare server") && resolve(proc));
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
}

const running = new Set();
const stopServer = (proc) => new Promise((r) => {
  running.delete(proc);
  if (proc.exitCode !== null) return r();
  proc.on("exit", r);
  proc.kill("SIGTERM");
});

/** Opens a connection, joins, and collects every later server message. */
function join(room, name, clientId, password) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const inbox = [];
    ws.on("open", () => ws.send(JSON.stringify({ type: "join", room, name, clientId, password })));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === "joined" || (msg.type === "error" && msg.request === "join")) resolve({ ws, reply: msg, inbox });
      else inbox.push(msg);
    });
    ws.on("error", reject);
  });
}

const waitFor = async (inbox, type, n = 1) => {
  for (let i = 0; i < 100; i++) {
    if (inbox.filter((m) => m.type === type).length >= n) return inbox.filter((m) => m.type === type);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no ${type}`);
};

test("rooms survive a restart", async (t) => {
  t.after(async () => { for (const p of running) await stopServer(p); for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) fs.rmSync(f, { force: true }); });
  const ann = "a".repeat(32), ben = "b".repeat(32);

  // --- First run: build up some history ---
  let server = await startServer();
  const a = await join("keeper", "Ann", ann, "s3cret");
  assert.equal(a.reply.created, true);
  const b = await join("keeper", "Ben", ben, "s3cret");
  const send = (c, text) => c.ws.send(JSON.stringify({ type: "send", kind: "text", text }));
  send(a, "first"); send(b, "second"); send(a, "third"); send(a, "to be deleted");
  const sent = (await waitFor(a.inbox, "message", 4)).map((m) => m.message);
  const byText = (text) => sent.find((m) => m.text === text).id; // Ann and Ben race, so order may vary
  a.ws.send(JSON.stringify({ type: "edit", id: byText("first"), text: "first (edited)" }));
  b.ws.send(JSON.stringify({ type: "react", id: byText("first"), emoji: "🔥" }));
  a.ws.send(JSON.stringify({ type: "delete", id: byText("to be deleted") }));
  a.ws.send(JSON.stringify({ type: "set_background", src: BG }));
  await waitFor(a.inbox, "room_updated");
  await waitFor(a.inbox, "message_deleted");
  await waitFor(a.inbox, "message_updated", 2);
  // A second room that gets deleted must stay deleted.
  const c = await join("gone", "Ann", ann);
  c.ws.send(JSON.stringify({ type: "delete_room" }));
  await waitFor(c.inbox, "room_deleted");
  for (const x of [a, b, c]) x.ws.close();
  await stopServer(server);

  // --- Second run: everything should be back ---
  server = await startServer();
  try {
    const info = await (await fetch(`http://localhost:${PORT}/api/rooms/keeper`)).json();
    assert.deepEqual(info, { name: "keeper", exists: true, hasPassword: true });
    assert.equal((await (await fetch(`http://localhost:${PORT}/api/rooms/gone`)).json()).exists, false, "deleted room stays deleted");

    assert.equal((await join("keeper", "Cat", "c".repeat(32), "wrong")).reply.code, "bad_password", "password still enforced");

    const ann2 = await join("keeper", "Ann", ann, "s3cret");
    const { reply } = ann2;
    assert.equal(reply.you.isOwner, true, "creator is still the owner");
    assert.equal(reply.background, BG, "custom background kept");
    assert.equal(reply.you.color, a.reply.you.color, "Ann keeps her color");
    const expected = sent.filter((m) => m.text !== "to be deleted").map((m) => (m.text === "first" ? "first (edited)" : m.text));
    assert.deepEqual(reply.messages.map((m) => m.text), expected, "history in the same order, deletion kept");
    assert.ok(reply.messages[0].editedAt, "edit kept");
    assert.deepEqual(reply.messages[0].reactions.map((r) => [r.emoji, r.users.map((u) => u.name)]), [["🔥", ["Ben"]]], "reaction kept");
    assert.deepEqual(reply.messages.map((m) => m.seq), sent.filter((m) => m.text !== "to be deleted").map((m) => m.seq), "sequence numbers kept");

    // New messages continue the sequence instead of restarting at 1.
    send(ann2, "after restart");
    const [next] = await waitFor(ann2.inbox, "message");
    assert.equal(next.message.seq, 5);
    ann2.ws.close();
  } finally {
    await stopServer(server);
  }
});
