import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { RoomStore, ChatError, publicMessage } from "./rooms.js";
import { Db } from "./db.js";
import { createTranslator, isLanguage } from "./translate.js";

const PORT = Number(process.env.PORT ?? 3001);
const GIPHY_API_KEY = process.env.GIPHY_API_KEY ?? "";
const GIPHY_RATING = process.env.GIPHY_RATING ?? "pg-13";
// Rooms are kept forever unless ROOM_TTL_DAYS is set (then deleted after that many idle days).
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_DAYS ?? 0) * 86_400_000;
// Where the database file lives. On Railway this is the mounted volume.
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

const db = new Db(process.env.DATABASE_FILE ?? path.join(DATA_DIR, "flare.db"));
const store = new RoomStore(db);
const translator = createTranslator();

// ---------- HTTP: room lookup, GIF search, built client ----------

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.giphy.com https://media.tenor.com https://c.tenor.com https://i.imgur.com https://static.klipy.com",
  "connect-src 'self' ws: wss:",
  "worker-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function searchGiphy(q, offset) {
  const endpoint = q ? "search" : "trending";
  const params = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: "24", offset: String(offset), rating: GIPHY_RATING });
  if (q) params.set("q", q.slice(0, 50));
  const r = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`);
  if (!r.ok) throw new Error(`GIPHY responded ${r.status}`);
  const body = await r.json();
  return {
    enabled: true,
    next: body.pagination ? body.pagination.offset + body.pagination.count : null,
    results: (body.data ?? []).map((g) => ({
      id: g.id,
      title: g.title,
      preview: g.images?.fixed_width?.url ?? g.images?.downsized?.url,
      url: g.images?.downsized_medium?.url ?? g.images?.original?.url,
      width: Number(g.images?.fixed_width?.width ?? 200),
      height: Number(g.images?.fixed_width?.height ?? 200),
    })).filter((g) => g.preview && g.url),
  };
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(DIST, path.normalize(urlPath));
  if (!file.startsWith(DIST)) return json(res, 400, { error: "bad path" });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html"); // SPA: /any-room
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Client not built. Run `npm run build`, or use `npm run dev` during development.");
  }
  const ext = path.extname(file);
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": cache,
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/config") return json(res, 200, { giphy: !!GIPHY_API_KEY, translation: translator.enabled });
    if (url.pathname.startsWith("/api/rooms/")) {
      const info = store.info(decodeURIComponent(url.pathname.slice("/api/rooms/".length)));
      return info ? json(res, 200, info) : json(res, 400, { error: "Room names use letters, numbers, - and _ (max 40)." });
    }
    if (url.pathname === "/api/gifs") {
      if (!GIPHY_API_KEY) return json(res, 200, { enabled: false, results: [] });
      const offset = Math.max(0, Math.min(4999, Number(url.searchParams.get("offset")) || 0));
      return json(res, 200, await searchGiphy(url.searchParams.get("q")?.trim() ?? "", offset));
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "not found" });
    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    json(res, 502, { error: "Something went wrong." });
  }
});

// ---------- WebSocket: the chat itself ----------

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 5 * 1024 * 1024 });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const ws of room.connections.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
}

/**
 * Translates a message in the background. The message is already posted and
 * in order; when the translation arrives it's saved and sent as an update.
 * `only` limits the update to one connection (an on-demand request).
 */
function translateMessage(room, message, to, requester = null) {
  const sourceText = message.text;
  if (!translator.enabled || !sourceText || !message.lang || to === message.lang) return;
  message.translating ??= new Set();
  message.waiting ??= new Map(); // lang -> connections that asked for it
  if (requester) {
    if (!message.waiting.has(to)) message.waiting.set(to, new Set());
    message.waiting.get(to).add(requester);
  }
  if (message.translating.has(to)) return; // already on its way; the requester is now waiting too
  message.translating.add(to);
  const takeWaiting = () => { const w = message.waiting.get(to) ?? new Set(); message.waiting.delete(to); return w; };
  translator.translate(sourceText, message.lang, to)
    .then((text) => {
      message.translating.delete(to);
      const waiting = takeWaiting();
      const saved = store.saveTranslation(room, message.id, sourceText, to, text);
      if (!saved || !store.rooms.has(room.name)) return;
      const update = { type: "message_updated", message: publicMessage(saved) };
      if (to === saved.sentLang) broadcast(room, update);
      else for (const ws of waiting) send(ws, update);
    })
    .catch((err) => {
      message.translating.delete(to);
      const waiting = takeWaiting();
      console.error(`translation ${message.lang}->${to} failed:`, err.message);
      if (!store.rooms.has(room.name) || message.text !== sourceText) return;
      if (to === message.sentLang) {
        message.translationFailed = true;
        broadcast(room, { type: "message_updated", message: publicMessage(message) });
      } else {
        for (const ws of waiting) send(ws, { type: "error", code: "translation_failed", message: "Couldn't translate that message right now.", request: "translate", id: message.id });
      }
    });
}

// Wrong-password attempts per IP+room: 5 tries, then a 60 second lockout.
const attempts = new Map();
function checkLockout(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) throw new ChatError("rate_limited", "Too many wrong passwords. Try again in a minute.");
}
function recordFailure(key) {
  const a = attempts.get(key) ?? { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) { a.count = 0; a.until = Date.now() + 60_000; }
  attempts.set(key, a);
}

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
  let room = null;
  let member = null;
  let tokens = 10; // message rate limit: bursts of 10, refilling 2 per second
  let translateTokens = 20; // on-demand translations: bursts of 20, refilling 1 per 2 seconds
  const refill = setInterval(() => { tokens = Math.min(10, tokens + 1); }, 500);
  const refillTranslate = setInterval(() => { translateTokens = Math.min(20, translateTokens + 1); }, 2000);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    try {
      if (msg.type === "ping") return send(ws, { type: "pong" });

      if (msg.type === "join") {
        if (room) throw new ChatError("invalid", "Already in a room.");
        const key = `${ip}|${String(msg.room).toLowerCase()}`;
        checkLockout(key);
        let joined;
        try {
          joined = store.join(ws, msg);
        } catch (err) {
          if (err.code === "bad_password") recordFailure(key);
          throw err;
        }
        attempts.delete(key);
        ({ room, member } = joined);
        send(ws, {
          type: "joined",
          room: room.name,
          created: joined.created,
          hasPassword: room.hasPassword,
          background: room.background,
          you: { ...member, isOwner: room.ownerId === member.authorId },
          members: room.members(),
          messages: room.messages.map(publicMessage),
        });
        if (joined.firstConnection) {
          for (const other of room.connections.keys()) {
            if (other !== ws && room.connections.get(other).authorId !== member.authorId) {
              send(other, { type: "presence", event: "join", member, members: room.members() });
            }
          }
        }
        return;
      }

      if (!room || !store.rooms.has(room.name)) throw new ChatError("invalid", "Join a room first.");

      if (msg.type === "send") {
        if (tokens <= 0) throw new ChatError("rate_limited", "Slow down a little.");
        tokens -= 1;
        if (!translator.enabled) delete msg.translateTo;
        const message = store.post(room, member, msg);
        if (message.sentLang && translator.enabled) message.translating = new Set([message.sentLang]);
        broadcast(room, { type: "message", message: publicMessage(message) });
        if (message.sentLang) { message.translating?.clear(); translateMessage(room, message, message.sentLang); }
        return;
      }
      if (msg.type === "edit") {
        const message = store.edit(room, member, msg);
        if (message.sentLang && translator.enabled) { message.translating = new Set([message.sentLang]); }
        broadcast(room, { type: "message_updated", message: publicMessage(message) });
        if (message.sentLang) { message.translating?.clear(); translateMessage(room, message, message.sentLang); }
        return;
      }
      if (msg.type === "delete") {
        const message = store.delete(room, member, msg);
        return broadcast(room, { type: "message_deleted", id: message.id });
      }
      if (msg.type === "react") {
        const message = store.react(room, member, msg);
        return broadcast(room, { type: "message_updated", message: publicMessage(message) });
      }
      if (msg.type === "translate") {
        if (!translator.enabled) throw new ChatError("invalid", "Translation isn't set up on this server.");
        if (!isLanguage(msg.to)) throw new ChatError("invalid", "Unknown language.");
        const message = room.find(msg.id);
        if (!message.text || !message.lang) throw new ChatError("invalid", "That message can't be translated.");
        if (message.translations[msg.to] || msg.to === message.lang) return send(ws, { type: "message_updated", message: publicMessage(message) });
        if (translateTokens <= 0) throw new ChatError("rate_limited", "Too many translations at once. Try again in a moment.");
        translateTokens -= 1;
        return translateMessage(room, message, msg.to, ws);
      }
      if (msg.type === "set_background") {
        const background = store.setBackground(room, member, msg);
        return broadcast(room, { type: "room_updated", background, by: member.name });
      }
      if (msg.type === "delete_room") {
        store.deleteRoom(room, member);
        broadcast(room, { type: "room_deleted", by: member.name });
        for (const other of room.connections.keys()) other.close(4000, "room deleted");
        room.connections.clear();
        return;
      }
      throw new ChatError("invalid", "Unknown request.");
    } catch (err) {
      if (!(err instanceof ChatError)) console.error(err);
      send(ws, {
        type: "error",
        code: err.code ?? "server_error",
        message: err instanceof ChatError ? err.message : "Something went wrong.",
        request: msg.type,
        id: msg.id,
        tempId: msg.tempId,
      });
    }
  });

  ws.on("close", () => {
    clearInterval(refill);
    clearInterval(refillTranslate);
    if (!room) return;
    const left = store.leave(ws, room);
    if (left && store.rooms.has(room.name)) {
      broadcast(room, { type: "presence", event: "leave", member: left, members: room.members() });
    }
  });
});

// Drop connections that stopped answering (phone went to sleep, network lost).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

setInterval(() => {
  store.sweep({ idleMs: 30 * 60_000, ttlMs: ROOM_TTL_MS });
  for (const [k, a] of attempts) if (a.until < Date.now() && a.count === 0) attempts.delete(k);
}, 10 * 60_000).unref();

// Close the database cleanly when Railway stops the old container during a deploy.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    for (const ws of wss.clients) ws.close(1012, "server restarting");
    server.close();
    db.close();
    process.exit(0);
  });
}

server.listen(PORT, () => {
  console.log(`Flare server on http://localhost:${PORT}${GIPHY_API_KEY ? "" : " (GIF search off: set GIPHY_API_KEY)"}${translator.enabled ? ` (translation: ${translator.provider})` : " (translation off: set ANTHROPIC_API_KEY or DEEPL_API_KEY)"}`);
});

export { server, store };
