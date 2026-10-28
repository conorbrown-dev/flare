import { useCallback, useEffect, useRef, useState } from "react";
import { clientId, uid } from "./storage";
import type { Me, Member, Message, Outgoing, SystemLine } from "./types";

export type ChatStatus = "connecting" | "open" | "reconnecting" | "join_error" | "deleted";

export type ChatEvent =
  | { type: "message"; message: Message }
  | { type: "join" | "leave"; member: Member }
  | { type: "error"; message: string }
  | { type: "deleted"; by: string };

type Options = {
  room: string;
  name: string;
  password: string | null;
  onEvent: (e: ChatEvent) => void;
};

/**
 * Keeps confirmed messages in server order (by `seq`), then our own unconfirmed
 * messages after them in the order we sent them. The server's `seq` is the single
 * source of truth for order, so everyone sees the same sequence.
 */
function ordered(list: Message[]) {
  const confirmed = list.filter((m) => !m.pending && !m.failed).sort((a, b) => a.seq - b.seq);
  const unconfirmed = list.filter((m) => m.pending || m.failed);
  return [...confirmed, ...unconfirmed];
}

export function useChat({ room, name, password, onEvent }: Options) {
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const [joinError, setJoinError] = useState<{ code: string; message: string } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [system, setSystem] = useState<SystemLine[]>([]);

  const ws = useRef<WebSocket | null>(null);
  const meRef = useRef<Me | null>(null);
  const joined = useRef(false);
  const stopped = useRef(false); // true after a fatal error or room deletion
  const outbox = useRef(new Map<string, Message>()); // tempId -> our unconfirmed message
  const lastSeq = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const raw = useCallback((data: object) => {
    const sock = ws.current;
    if (sock && sock.readyState === WebSocket.OPEN && joined.current) {
      sock.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  const addSystem = (text: string) =>
    setSystem((s) => [...s.slice(-49), { id: uid(8), afterSeq: lastSeq.current, text, at: Date.now() }]);

  useEffect(() => {
    stopped.current = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pinger: ReturnType<typeof setInterval> | undefined;

    function connect() {
      if (stopped.current) return;
      clearTimeout(timer);
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const sock = new WebSocket(`${proto}//${location.host}/ws`);
      ws.current = sock;
      joined.current = false;

      sock.onopen = () => {
        sock.send(JSON.stringify({ type: "join", room, name, password, clientId: clientId() }));
        pinger = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('{"type":"ping"}'), 25_000);
      };

      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "joined": {
            retry = 0;
            joined.current = true;
            meRef.current = msg.you;
            setMe(msg.you);
            setMembers(msg.members);
            setJoinError(null);
            setStatus("open");
            const server: Message[] = msg.messages;
            lastSeq.current = server.at(-1)?.seq ?? 0;
            // Anything we sent that the server already has is done; the rest is resent in order.
            const known = new Set(server.filter((m) => m.authorId === msg.you.authorId).map((m) => m.tempId));
            for (const id of known) if (id) outbox.current.delete(id);
            setMessages(ordered([...server, ...outbox.current.values()]));
            for (const m of outbox.current.values()) {
              if (!m.failed) sock.send(JSON.stringify({ type: "send", tempId: m.tempId, kind: m.kind, text: m.text, src: m.src }));
            }
            break;
          }
          case "message": {
            const m: Message = msg.message;
            lastSeq.current = Math.max(lastSeq.current, m.seq);
            const mine = m.authorId === meRef.current?.authorId;
            if (mine && m.tempId) outbox.current.delete(m.tempId);
            setMessages((list) => ordered([...list.filter((x) => x.id !== m.id && !(mine && m.tempId && x.tempId === m.tempId && x.pending)), m]));
            if (!mine) onEventRef.current({ type: "message", message: m });
            break;
          }
          case "message_updated":
            setMessages((list) => list.map((x) => (x.id === msg.message.id ? msg.message : x)));
            break;
          case "message_deleted":
            setMessages((list) => list.filter((x) => x.id !== msg.id));
            break;
          case "presence": {
            setMembers(msg.members);
            addSystem(`${msg.member.name} ${msg.event === "join" ? "joined" : "left"}`);
            onEventRef.current({ type: msg.event, member: msg.member });
            break;
          }
          case "room_deleted":
            stopped.current = true;
            setStatus("deleted");
            onEventRef.current({ type: "deleted", by: msg.by });
            break;
          case "error": {
            if (msg.request === "join") {
              const transient = msg.code === "server_error";
              if (!transient) {
                stopped.current = true;
                setJoinError({ code: msg.code, message: msg.message });
                setStatus("join_error");
                sock.close();
              }
              break;
            }
            if (msg.request === "send" && msg.tempId && outbox.current.has(msg.tempId)) {
              const failed = { ...outbox.current.get(msg.tempId)!, pending: false, failed: msg.message };
              outbox.current.set(msg.tempId, failed);
              setMessages((list) => ordered(list.map((x) => (x.tempId === msg.tempId && (x.pending || x.failed) ? failed : x))));
              break;
            }
            onEventRef.current({ type: "error", message: msg.message });
            break;
          }
        }
      };

      sock.onclose = () => {
        clearInterval(pinger);
        joined.current = false;
        if (ws.current !== sock || stopped.current) return;
        setStatus("reconnecting");
        retry += 1;
        timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** retry));
      };
    }

    // Phones drop sockets when they sleep; reconnect straight away when we come back.
    const wake = () => {
      const s = ws.current;
      if (!stopped.current && document.visibilityState === "visible" && (!s || s.readyState === WebSocket.CLOSED)) {
        retry = 0;
        connect();
      }
    };

    setStatus("connecting");
    connect();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
      clearInterval(pinger);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      ws.current?.close();
      ws.current = null;
    };
  }, [room, name, password]);

  const send = useCallback((out: Outgoing) => {
    const me = meRef.current;
    const tempId = uid(12);
    const temp: Message = {
      id: `temp-${tempId}`, seq: Number.MAX_SAFE_INTEGER, tempId, pending: true,
      authorId: me?.authorId ?? "", name: me?.name ?? name, color: me?.color ?? 0,
      kind: out.kind, text: out.text, src: out.src, createdAt: Date.now(), reactions: [],
    };
    outbox.current.set(tempId, temp);
    setMessages((list) => ordered([...list, temp]));
    raw({ type: "send", tempId, ...out }); // if offline it goes out after reconnecting
  }, [name, raw]);

  const retryFailed = useCallback((tempId: string) => {
    const m = outbox.current.get(tempId);
    if (!m) return;
    const again = { ...m, pending: true, failed: undefined };
    outbox.current.set(tempId, again);
    setMessages((list) => ordered(list.map((x) => (x.tempId === tempId && (x.failed || x.pending) ? again : x))));
    raw({ type: "send", tempId, kind: m.kind, text: m.text, src: m.src });
  }, [raw]);

  const discardFailed = useCallback((tempId: string) => {
    outbox.current.delete(tempId);
    setMessages((list) => list.filter((x) => !(x.tempId === tempId && (x.failed || x.pending))));
  }, []);

  const offline = () => onEventRef.current({ type: "error", message: "You're offline. Try again when reconnected." });

  return {
    status, joinError, me, members, messages, system,
    send, retryFailed, discardFailed,
    edit: (id: string, text: string) => raw({ type: "edit", id, text }) || offline(),
    remove: (id: string) => raw({ type: "delete", id }) || offline(),
    react: (id: string, emoji: string) => raw({ type: "react", id, emoji }) || offline(),
    deleteRoom: () => raw({ type: "delete_room" }) || offline(),
  };
}
