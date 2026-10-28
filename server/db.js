// Saves rooms and messages to a SQLite file so they survive restarts and deploys.
// Uses Node's built-in SQLite (Node 22.13+), so there is nothing extra to install.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS rooms (
    name          TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL,
    pw_salt       BLOB,
    pw_hash       BLOB,
    created_at    INTEGER NOT NULL,
    last_activity INTEGER NOT NULL,
    seq           INTEGER NOT NULL DEFAULT 0,
    colors        TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    room       TEXT NOT NULL REFERENCES rooms(name) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    temp_id    TEXT,
    author_id  TEXT NOT NULL,
    name       TEXT NOT NULL,
    color      INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    text       TEXT,
    src        TEXT,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    reactions  TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS messages_by_room ON messages (room, seq);
`;

// Reactions are Map(emoji -> Map(authorId -> name)) in memory; stored as JSON pairs.
const reactionsToJson = (reactions) => JSON.stringify([...reactions].map(([emoji, users]) => [emoji, [...users]]));
const reactionsFromJson = (json) => new Map(JSON.parse(json).map(([emoji, users]) => [emoji, new Map(users)]));

export class Db {
  constructor(file) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    // Columns added after the first release; existing databases get them on startup.
    const columns = new Set(this.db.prepare("PRAGMA table_info(rooms)").all().map((c) => c.name));
    if (!columns.has("background")) this.db.exec("ALTER TABLE rooms ADD COLUMN background TEXT");
    const q = (sql) => this.db.prepare(sql);
    this.q = {
      getRoom: q("SELECT * FROM rooms WHERE name = ?"),
      insertRoom: q("INSERT INTO rooms (name, owner_id, pw_salt, pw_hash, created_at, last_activity, seq, colors) VALUES (?, ?, ?, ?, ?, ?, 0, '{}')"),
      touchRoom: q("UPDATE rooms SET last_activity = ?, seq = ? WHERE name = ?"),
      saveColors: q("UPDATE rooms SET colors = ? WHERE name = ?"),
      saveBackground: q("UPDATE rooms SET background = ? WHERE name = ?"),
      deleteRoom: q("DELETE FROM rooms WHERE name = ?"),
      getMessages: q("SELECT * FROM messages WHERE room = ? ORDER BY seq"),
      insertMessage: q(`INSERT INTO messages (id, room, seq, temp_id, author_id, name, color, kind, text, src, created_at, edited_at, reactions)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      updateMessage: q("UPDATE messages SET text = ?, edited_at = ?, reactions = ? WHERE id = ?"),
      deleteMessage: q("DELETE FROM messages WHERE id = ?"),
      staleRooms: q("SELECT name FROM rooms WHERE last_activity < ?"),
    };
  }

  /** Everything needed to rebuild a room in memory, or null if it doesn't exist. */
  loadRoom(name) {
    const row = this.q.getRoom.get(name);
    if (!row) return null;
    return {
      ownerId: row.owner_id,
      password: row.pw_hash ? { salt: Buffer.from(row.pw_salt), hash: Buffer.from(row.pw_hash) } : null,
      createdAt: row.created_at,
      lastActivity: row.last_activity,
      seq: row.seq,
      colors: new Map(Object.entries(JSON.parse(row.colors))),
      background: row.background ?? null,
      messages: this.q.getMessages.all(name).map((m) => ({
        id: m.id,
        seq: m.seq,
        tempId: m.temp_id ?? undefined,
        authorId: m.author_id,
        name: m.name,
        color: m.color,
        kind: m.kind,
        text: m.text ?? undefined,
        src: m.src ?? undefined,
        createdAt: m.created_at,
        editedAt: m.edited_at ?? undefined,
        reactions: reactionsFromJson(m.reactions),
      })),
    };
  }

  createRoom(room) {
    this.q.insertRoom.run(room.name, room.ownerId, room.password?.salt ?? null, room.password?.hash ?? null, room.createdAt, room.lastActivity);
  }

  saveColors(room) {
    this.q.saveColors.run(JSON.stringify(Object.fromEntries(room.colorByAuthor)), room.name);
  }

  saveBackground(room) {
    this.q.saveBackground.run(room.background, room.name);
  }

  /** Adds a message and drops any trimmed ones in a single transaction. */
  addMessage(room, m, trimmed) {
    this.transaction(() => {
      this.q.insertMessage.run(m.id, room.name, m.seq, m.tempId ?? null, m.authorId, m.name, m.color, m.kind,
        m.text ?? null, m.src ?? null, m.createdAt, m.editedAt ?? null, reactionsToJson(m.reactions));
      for (const old of trimmed) this.q.deleteMessage.run(old.id);
      this.q.touchRoom.run(room.lastActivity, room.seq, room.name);
    });
  }

  updateMessage(room, m) {
    this.transaction(() => {
      this.q.updateMessage.run(m.text ?? null, m.editedAt ?? null, reactionsToJson(m.reactions), m.id);
      this.q.touchRoom.run(room.lastActivity, room.seq, room.name);
    });
  }

  deleteMessage(room, m) {
    this.transaction(() => {
      this.q.deleteMessage.run(m.id);
      this.q.touchRoom.run(room.lastActivity, room.seq, room.name);
    });
  }

  touchRoom(room) {
    this.q.touchRoom.run(room.lastActivity, room.seq, room.name);
  }

  deleteRoom(name) {
    this.q.deleteRoom.run(name); // messages go with it (ON DELETE CASCADE)
  }

  staleRoomNames(cutoff) {
    return this.q.staleRooms.all(cutoff).map((r) => r.name);
  }

  transaction(fn) {
    this.db.exec("BEGIN");
    try { fn(); this.db.exec("COMMIT"); } catch (err) { this.db.exec("ROLLBACK"); throw err; }
  }

  close() { this.db.close(); }
}
