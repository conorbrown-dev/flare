// Room state and rules. Rooms in use are kept in memory for speed; every change
// is also written to the database (server/db.js) so rooms survive restarts.
import crypto from "node:crypto";

export const LIMITS = {
  roomName: /^[a-z0-9][a-z0-9_-]{0,39}$/, // 1-40 chars, URL-safe
  userName: 24,
  password: 128,
  text: 4000,
  imageBytes: 3_500_000, // base64 characters of a data URL (~2.6 MB binary)
  backgroundBytes: 3_500_000, // same limit for a room's custom background
  roomImageBytes: 60_000_000, // all images kept in one room's history
  history: 500, // messages kept per room
  reactionsPerMessage: 20,
  colors: 7, // rainbow: red, orange, yellow, green, blue, indigo, violet
};

// Hosts that GIF links may point at. Tenor's search API is gone, but links to
// its media CDN still load, so they stay allowed for pasted links.
export const GIF_HOSTS = [
  "media.giphy.com",
  "i.giphy.com",
  /^media\d+\.giphy\.com$/,
  "media.tenor.com",
  "c.tenor.com",
  "i.imgur.com",
  "static.klipy.com",
];

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function normalizeRoomName(raw) {
  const name = String(raw ?? "").trim().toLowerCase();
  return LIMITS.roomName.test(name) ? name : null;
}

export function isAllowedGifUrl(raw) {
  if (typeof raw !== "string" || raw.length > 1000) return false;
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return GIF_HOSTS.some((h) => (typeof h === "string" ? url.hostname === h : h.test(url.hostname)));
}

export function isValidEmoji(raw) {
  return typeof raw === "string" && raw.length > 0 && raw.length <= 16 && EMOJI.test(raw) && !/\s/.test(raw);
}

/** Public, stable ID for a browser. The secret clientId never leaves the server. */
export function authorIdFor(clientId) {
  return crypto.createHash("sha256").update(String(clientId)).digest("hex").slice(0, 16);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return { salt, hash };
}

function checkPassword(password, stored) {
  const hash = crypto.scryptSync(String(password ?? ""), stored.salt, 32);
  return crypto.timingSafeEqual(hash, stored.hash);
}

export class ChatError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class Room {
  /** `saved` is a room loaded from the database; without it this is a brand-new room. */
  constructor(name, ownerId, password, saved = null) {
    this.name = name;
    this.ownerId = saved?.ownerId ?? ownerId;
    this.password = saved ? saved.password : password ? hashPassword(password) : null;
    this.createdAt = saved?.createdAt ?? Date.now();
    this.lastActivity = saved?.lastActivity ?? Date.now();
    this.seq = saved?.seq ?? 0; // increases by one per message; defines the one true order
    this.messages = saved?.messages ?? [];
    this.imageBytes = this.messages.reduce((n, m) => n + (m.kind === "image" ? m.src.length : 0), 0);
    this.connections = new Map(); // connection -> member
    this.colorByAuthor = saved?.colors ?? new Map(); // keeps someone's color if they rejoin
    this.background = saved?.background ?? null; // custom background image (data URL); null = default space scene
  }

  get hasPassword() { return this.password !== null; }

  members() {
    const byAuthor = new Map();
    for (const m of this.connections.values()) byAuthor.set(m.authorId, m);
    return [...byAuthor.values()].map(publicMember);
  }

  isConnected(authorId) {
    for (const m of this.connections.values()) if (m.authorId === authorId) return true;
    return false;
  }

  /** Returns [color, isNew]. Someone keeps the same color whenever they come back. */
  pickColor(authorId) {
    if (this.colorByAuthor.has(authorId)) return [this.colorByAuthor.get(authorId), false];
    const used = new Array(LIMITS.colors).fill(0);
    for (const m of this.members()) used[m.color]++;
    const color = used.indexOf(Math.min(...used));
    this.colorByAuthor.set(authorId, color);
    return [color, true];
  }

  find(id) {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) throw new ChatError("not_found", "That message no longer exists.");
    return msg;
  }

  /** Adds a message; returns any old messages trimmed to stay within the history limits. */
  add(message) {
    message.seq = ++this.seq;
    this.messages.push(message);
    this.imageBytes += message.kind === "image" ? message.src.length : 0;
    const trimmed = [];
    while (this.messages.length > LIMITS.history || this.imageBytes > LIMITS.roomImageBytes) {
      trimmed.push(this.messages[0]);
      this.remove(this.messages[0]);
    }
    this.lastActivity = Date.now();
    return trimmed;
  }

  remove(message) {
    const i = this.messages.indexOf(message);
    if (i === -1) return;
    this.messages.splice(i, 1);
    if (message.kind === "image") this.imageBytes -= message.src.length;
  }
}

function publicMember(m) {
  return { authorId: m.authorId, name: m.name, color: m.color };
}

export function publicMessage(msg) {
  return {
    id: msg.id,
    seq: msg.seq,
    tempId: msg.tempId,
    authorId: msg.authorId,
    name: msg.name,
    color: msg.color,
    kind: msg.kind,
    text: msg.text,
    src: msg.src,
    createdAt: msg.createdAt,
    editedAt: msg.editedAt,
    reactions: [...msg.reactions].map(([emoji, users]) => ({
      emoji,
      users: [...users].map(([authorId, name]) => ({ authorId, name })),
    })),
  };
}

export class RoomStore {
  /** `db` (optional) saves everything to disk; without it rooms live only in memory. */
  constructor(db = null) {
    this.db = db;
    this.rooms = new Map(); // rooms currently in memory; others are loaded from disk on demand
  }

  /** The room, from memory or loaded from disk, or undefined if it doesn't exist. */
  get(name) {
    let room = this.rooms.get(name);
    if (!room && this.db) {
      const saved = this.db.loadRoom(name);
      if (saved) {
        room = new Room(name, null, null, saved);
        this.rooms.set(name, room);
      }
    }
    return room;
  }

  info(rawName) {
    const name = normalizeRoomName(rawName);
    if (!name) return null;
    const room = this.get(name);
    return { name, exists: !!room, hasPassword: room?.hasPassword ?? false };
  }

  /**
   * Joins a room, creating it when it doesn't exist. Creating sets the password
   * (optional) and makes this browser the owner. Joining an existing room with
   * a password requires the right password.
   */
  join(conn, { room: rawRoom, name: rawName, password, clientId }) {
    const roomName = normalizeRoomName(rawRoom);
    if (!roomName) throw new ChatError("invalid", "Room names use letters, numbers, - and _ (max 40).");
    const name = String(rawName ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > LIMITS.userName) throw new ChatError("invalid", `Pick a name of 1-${LIMITS.userName} characters.`);
    if (typeof clientId !== "string" || clientId.length < 16 || clientId.length > 100) throw new ChatError("invalid", "Missing client id.");
    if (password != null && (typeof password !== "string" || password.length > LIMITS.password)) throw new ChatError("invalid", "Password is too long.");

    const authorId = authorIdFor(clientId);
    let room = this.get(roomName);
    let created = false;
    if (!room) {
      room = new Room(roomName, authorId, password || null);
      this.db?.createRoom(room);
      this.rooms.set(roomName, room);
      created = true;
    } else if (room.hasPassword) {
      if (!password) throw new ChatError("password_required", "This room needs a password.");
      if (!checkPassword(password, room.password)) throw new ChatError("bad_password", "Wrong password.");
    }

    // (A brand-new room has nobody in it yet, so this only applies to existing rooms.)
    const lower = name.toLowerCase();
    for (const m of room.connections.values()) {
      if (m.authorId !== authorId && m.name.toLowerCase() === lower) {
        throw new ChatError("name_taken", `Someone here is already called ${m.name}.`);
      }
    }

    const wasConnected = room.isConnected(authorId);
    const [color, newColor] = room.pickColor(authorId);
    if (newColor) this.db?.saveColors(room);
    const member = { authorId, name, color };
    room.connections.set(conn, member);
    room.lastActivity = Date.now();
    return { room, member, created, firstConnection: !wasConnected };
  }

  /** Returns the member if this was their last open connection (they really left). */
  leave(conn, room) {
    const member = room.connections.get(conn);
    if (!member) return null;
    room.connections.delete(conn);
    room.lastActivity = Date.now();
    return room.isConnected(member.authorId) ? null : member;
  }

  post(room, member, { tempId, kind, text, src }) {
    text = typeof text === "string" ? text.trim() : "";
    if (text.length > LIMITS.text) throw new ChatError("too_large", `Messages are limited to ${LIMITS.text} characters.`);
    if (kind === "text") {
      if (!text) throw new ChatError("invalid", "Empty message.");
      src = undefined;
    } else if (kind === "image") {
      if (typeof src !== "string" || src.length > LIMITS.imageBytes) throw new ChatError("too_large", "That image is too large.");
      if (!DATA_IMAGE.test(src)) throw new ChatError("invalid", "Only PNG, JPEG, GIF and WebP images can be sent.");
    } else if (kind === "gif") {
      if (!isAllowedGifUrl(src)) throw new ChatError("invalid", "GIFs must come from GIPHY, Tenor, Imgur or KLIPY.");
    } else {
      throw new ChatError("invalid", "Unknown message type.");
    }
    const message = {
      id: crypto.randomUUID(),
      tempId: typeof tempId === "string" ? tempId.slice(0, 64) : undefined,
      authorId: member.authorId,
      name: member.name,
      color: member.color,
      kind,
      text: text || undefined,
      src,
      createdAt: Date.now(),
      editedAt: undefined,
      reactions: new Map(), // emoji -> Map(authorId -> name)
    };
    const trimmed = room.add(message);
    this.db?.addMessage(room, message, trimmed);
    return message;
  }

  edit(room, member, { id, text }) {
    const msg = room.find(id);
    if (msg.authorId !== member.authorId) throw new ChatError("forbidden", "You can only edit your own messages.");
    text = typeof text === "string" ? text.trim() : "";
    if (text.length > LIMITS.text) throw new ChatError("too_large", `Messages are limited to ${LIMITS.text} characters.`);
    if (!text && msg.kind === "text") throw new ChatError("invalid", "A message can't be empty. Delete it instead.");
    msg.text = text || undefined;
    msg.editedAt = Date.now();
    room.lastActivity = Date.now();
    this.db?.updateMessage(room, msg);
    return msg;
  }

  delete(room, member, { id }) {
    const msg = room.find(id);
    if (msg.authorId !== member.authorId) throw new ChatError("forbidden", "You can only delete your own messages.");
    room.remove(msg);
    room.lastActivity = Date.now();
    this.db?.deleteMessage(room, msg);
    return msg;
  }

  react(room, member, { id, emoji }) {
    if (!isValidEmoji(emoji)) throw new ChatError("invalid", "That isn't an emoji.");
    const msg = room.find(id);
    let users = msg.reactions.get(emoji);
    if (users?.has(member.authorId)) {
      users.delete(member.authorId);
      if (users.size === 0) msg.reactions.delete(emoji);
    } else {
      if (!users) {
        if (msg.reactions.size >= LIMITS.reactionsPerMessage) throw new ChatError("invalid", "This message has too many different reactions.");
        users = new Map();
        msg.reactions.set(emoji, users);
      }
      users.set(member.authorId, member.name);
    }
    this.db?.updateMessage(room, msg);
    return msg;
  }

  /** The room's creator can set a custom background image, or pass null for the default. */
  setBackground(room, member, { src }) {
    if (room.ownerId !== member.authorId) throw new ChatError("forbidden", "Only the person who started the room can change its background.");
    if (src != null) {
      if (typeof src !== "string" || src.length > LIMITS.backgroundBytes) throw new ChatError("too_large", "That image is too large.");
      if (!DATA_IMAGE.test(src)) throw new ChatError("invalid", "Backgrounds can be PNG, JPEG, GIF or WebP images.");
    }
    room.background = src ?? null;
    room.lastActivity = Date.now();
    this.db?.saveBackground(room);
    return room.background;
  }

  deleteRoom(room, member) {
    if (room.ownerId !== member.authorId) throw new ChatError("forbidden", "Only the person who started the room can delete it.");
    this.rooms.delete(room.name);
    this.db?.deleteRoom(room.name);
  }

  /**
   * Housekeeping. Empty rooms are dropped from memory after `idleMs` (they stay
   * on disk and reload when someone visits). Rooms with no activity for `ttlMs`
   * are deleted for good; a ttlMs of 0 keeps rooms forever.
   */
  sweep({ idleMs, ttlMs }) {
    const now = Date.now();
    for (const [name, room] of this.rooms) {
      if (room.connections.size > 0) continue;
      const idle = now - room.lastActivity;
      if (ttlMs > 0 && idle > ttlMs) {
        this.rooms.delete(name);
        this.db?.deleteRoom(name);
      } else if (this.db && idle > idleMs) {
        this.db.touchRoom(room); // remember when it was last used
        this.rooms.delete(name); // still saved on disk
      }
    }
    if (ttlMs > 0 && this.db) {
      for (const name of this.db.staleRoomNames(now - ttlMs)) {
        if (!this.rooms.has(name)) this.db.deleteRoom(name);
      }
    }
  }
}
