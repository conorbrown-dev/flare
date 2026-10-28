// Run with `npm test`. Starts the real server and talks to it over WebSockets.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import os from "node:os";
import path from "node:path";

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(PORT), GIPHY_API_KEY: "", DATABASE_FILE: path.join(os.tmpdir(), `flare-test-${randomUUID()}.db`) }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => d.toString().includes("Flare server") && resolve());
    proc.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
});
after(() => proc.kill());

/** A test client that queues every server message so tests can await them in order. */
async function client(clientId = randomUUID()) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const queue = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  await new Promise((r) => ws.on("open", r));
  return {
    ws, clientId,
    send: (m) => ws.send(JSON.stringify(m)),
    next(...types) {
      const match = (m) => types.includes(m.type);
      const type = types.join("|");
      const i = queue.findIndex(match);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ match, resolve });
        setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 2000);
      });
    },
    async join(room, name, password) {
      this.send({ type: "join", room, name, password, clientId });
      return this.next("joined", "error");
    },
    close: () => new Promise((r) => { ws.on("close", r); ws.close(); }),
  };
}

const room = () => `test-${randomUUID().slice(0, 8)}`;

test("visiting a new room creates it; an open room lets anyone in", async () => {
  const name = room();
  assert.deepEqual(await (await fetch(`${BASE}/api/rooms/${name}`)).json(), { name, exists: false, hasPassword: false });
  const a = await client();
  const joined = await a.join(name, "Ann");
  assert.equal(joined.type, "joined");
  assert.equal(joined.created, true);
  assert.equal(joined.you.isOwner, true);
  assert.deepEqual(await (await fetch(`${BASE}/api/rooms/${name}`)).json(), { name, exists: true, hasPassword: false });
  const b = await client();
  const j2 = await b.join(name, "Ben");
  assert.equal(j2.type, "joined");
  assert.equal(j2.you.isOwner, false);
  assert.notEqual(j2.you.color, joined.you.color, "second person gets a different rainbow color");
  await a.close(); await b.close();
});

test("a password room refuses wrong or missing passwords", async () => {
  const name = room();
  const a = await client();
  await a.join(name, "Ann", "hunter2");
  assert.equal((await (await fetch(`${BASE}/api/rooms/${name}`)).json()).hasPassword, true);
  const b = await client();
  assert.equal((await b.join(name, "Ben")).code, "password_required");
  const c = await client();
  assert.equal((await c.join(name, "Cat", "wrong")).code, "bad_password");
  const d = await client();
  assert.equal((await d.join(name, "Dee", "hunter2")).type, "joined");
  // Not joined → cannot send anything.
  b.send({ type: "send", kind: "text", text: "sneaky" });
  assert.equal((await b.next("error")).message, "Join a room first.");
  await Promise.all([a, b, c, d].map((x) => x.close()));
});

test("repeated wrong passwords get locked out", async () => {
  const name = room();
  const a = await client();
  await a.join(name, "Ann", "pw");
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const x = await client();
    codes.push((await x.join(name, `X${i}`, "nope")).code);
    await x.close();
  }
  assert.deepEqual(codes, ["bad_password", "bad_password", "bad_password", "bad_password", "bad_password", "rate_limited"]);
  await a.close();
});

test("messages arrive in the same order for everyone, with sequence numbers", async () => {
  const name = room();
  const a = await client(); const b = await client();
  await a.join(name, "Ann"); await b.join(name, "Ben");
  for (let i = 0; i < 8; i++) (i % 2 ? b : a).send({ type: "send", kind: "text", text: `m${i}`, tempId: `t${i}` });
  const seenA = []; const seenB = [];
  for (let i = 0; i < 8; i++) { seenA.push((await a.next("message")).message); seenB.push((await b.next("message")).message); }
  assert.deepEqual(seenA.map((m) => m.seq), seenB.map((m) => m.seq));
  assert.deepEqual(seenA.map((m) => m.seq), [...seenA.map((m) => m.seq)].sort((x, y) => x - y));
  // A latecomer gets the same history in the same order.
  const c = await client();
  const joined = await c.join(name, "Cat");
  assert.deepEqual(joined.messages.map((m) => m.id), seenA.map((m) => m.id));
  await Promise.all([a, b, c].map((x) => x.close()));
});

test("images, GIF links and bad media", async () => {
  const name = room();
  const a = await client();
  await a.join(name, "Ann");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  a.send({ type: "send", kind: "image", src: png, text: "pasted" });
  assert.equal((await a.next("message")).message.kind, "image");
  a.send({ type: "send", kind: "gif", src: "https://media.giphy.com/media/abc123/giphy.gif" });
  assert.equal((await a.next("message")).message.kind, "gif");
  a.send({ type: "send", kind: "gif", src: "https://evil.example.com/x.gif" });
  assert.equal((await a.next("error")).code, "invalid");
  a.send({ type: "send", kind: "image", src: "data:text/html;base64,PHNjcmlwdD4=" });
  assert.equal((await a.next("error")).code, "invalid");
  await a.close();
});

test("only the author can edit or delete; anyone can react", async () => {
  const name = room();
  const a = await client(); const b = await client();
  await a.join(name, "Ann"); await b.join(name, "Ben");
  a.send({ type: "send", kind: "text", text: "helo" });
  const { message } = await a.next("message"); await b.next("message");

  b.send({ type: "edit", id: message.id, text: "hijacked" });
  assert.equal((await b.next("error")).code, "forbidden");
  b.send({ type: "delete", id: message.id });
  assert.equal((await b.next("error")).code, "forbidden");

  a.send({ type: "edit", id: message.id, text: "hello" });
  const edited = (await b.next("message_updated")).message;
  assert.equal(edited.text, "hello"); assert.ok(edited.editedAt);
  await a.next("message_updated");

  b.send({ type: "react", id: message.id, emoji: "👍" });
  const reacted = (await a.next("message_updated")).message;
  assert.deepEqual(reacted.reactions, [{ emoji: "👍", users: [{ authorId: reacted.reactions[0].users[0].authorId, name: "Ben" }] }]);
  await b.next("message_updated");
  b.send({ type: "react", id: message.id, emoji: "👍" }); // toggles off
  assert.deepEqual((await a.next("message_updated")).message.reactions, []);
  await b.next("message_updated");
  b.send({ type: "react", id: message.id, emoji: "hello" });
  assert.equal((await b.next("error")).code, "invalid");

  a.send({ type: "delete", id: message.id });
  assert.equal((await b.next("message_deleted")).id, message.id);
  await Promise.all([a, b].map((x) => x.close()));
});

test("others hear when someone joins and leaves (but not for a second tab)", async () => {
  const name = room();
  const a = await client(); const b = await client();
  await a.join(name, "Ann"); await b.join(name, "Ben");
  assert.equal((await a.next("presence")).event, "join");
  const b2 = await client(b.clientId); // same browser, second tab
  await b2.join(name, "Ben");
  await b2.close();
  await b.close();
  const p = await a.next("presence");
  assert.equal(p.event, "leave");
  assert.equal(p.member.name, "Ben");
  assert.deepEqual(p.members.map((m) => m.name), ["Ann"]);
  await a.close();
});

test("names must be unique among people in the room", async () => {
  const name = room();
  const a = await client(); const b = await client();
  await a.join(name, "Ann");
  assert.equal((await b.join(name, "ann")).code, "name_taken");
  await Promise.all([a, b].map((x) => x.close()));
});

test("only the room's creator can delete it; everyone is told", async () => {
  const name = room();
  const a = await client(); const b = await client();
  await a.join(name, "Ann"); await b.join(name, "Ben");
  b.send({ type: "delete_room" });
  assert.equal((await b.next("error")).code, "forbidden");
  a.send({ type: "delete_room" });
  assert.equal((await b.next("room_deleted")).by, "Ann");
  assert.equal((await (await fetch(`${BASE}/api/rooms/${name}`)).json()).exists, false);
  // The creator stays owner after reconnecting from the same browser.
  const name2 = room();
  const c = await client();
  await c.join(name2, "Cat");
  await c.close();
  const c2 = await client(c.clientId);
  assert.equal((await c2.join(name2, "Cat")).you.isOwner, true);
  await c2.close();
});

test("bad room names are rejected", async () => {
  assert.equal((await fetch(`${BASE}/api/rooms/${encodeURIComponent("../etc")}`)).status, 400);
  const a = await client();
  assert.equal((await a.join("has space", "Ann")).code, "invalid");
  await a.close();
});
