// Small wrappers so private browsing or blocked storage never breaks the app.

function get(store: Storage | undefined, key: string) {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}
function set(store: Storage | undefined, key: string, value: string | null) {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch { /* ignore */ }
}
const local = typeof localStorage === "undefined" ? undefined : localStorage;
const session = typeof sessionStorage === "undefined" ? undefined : sessionStorage;

let memoryId: string | null = null;

/** Random hex ID. Works over plain http too (crypto.randomUUID needs https). */
export function uid(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A secret random ID for this browser. The server only ever shows others a hash
 * of it, and uses it to know which messages are yours and whether you started a room.
 */
export function clientId(): string {
  let id = get(local, "chat.clientId") ?? memoryId;
  if (!id) {
    id = uid(32);
    memoryId = id;
    set(local, "chat.clientId", id);
  }
  return id;
}

export const savedName = () => get(local, "chat.name") ?? "";
export const saveName = (name: string) => set(local, "chat.name", name);

// Room passwords are kept only for this tab session, so a reload or a dropped
// connection can rejoin without asking again.
export const savedPassword = (room: string) => get(session, `chat.pw.${room}`);
export const savePassword = (room: string, pw: string | null) => set(session, `chat.pw.${room}`, pw);

export const notificationsWanted = () => get(local, "chat.notify") === "1";
export const setNotificationsWanted = (on: boolean) => set(local, "chat.notify", on ? "1" : "0");
