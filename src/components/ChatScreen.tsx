import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { colorFor } from "../lib/colors";
import { notificationPermission, notify, requestNotifications } from "../lib/notify";
import { notificationsWanted, setNotificationsWanted, uid } from "../lib/storage";
import type { Message } from "../lib/types";
import { useChat, type ChatEvent } from "../lib/useChat";
import { Composer, type ComposerHandle } from "./Composer";
import { EmojiPicker } from "./EmojiPicker";
import { MessageItem } from "./MessageItem";
import { Sheet } from "./Sheet";

type Toast = { id: string; text: string; tone?: "error" };

type Props = {
  room: string;
  name: string;
  password: string | null;
  onJoinError: (code: string, message: string) => void;
  onDeleted: (by: string, byMe: boolean) => void;
};

const dayLabel = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

function preview(m: Message) {
  if (m.kind === "image") return m.text ? `📷 ${m.text}` : "📷 sent an image";
  if (m.kind === "gif") return "sent a GIF";
  return m.text ?? "";
}

export function ChatScreen({ room, name, password, onJoinError, onDeleted }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unread, setUnread] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [sheet, setSheet] = useState<null | "members" | "menu" | "delete-room" | { reactTo: string } | { confirmDelete: Message } | { image: string }>(null);
  const [notifyOn, setNotifyOn] = useState(() => notificationsWanted() && notificationPermission() === "granted");
  const [dragging, setDragging] = useState(false);
  const deletedByMe = useRef(false);
  const deletedBy = useRef("");

  const toast = useCallback((text: string, tone?: "error") => {
    const id = uid(6);
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 5000 : 3500);
  }, []);

  const onEvent = useCallback((e: ChatEvent) => {
    const away = document.visibilityState !== "visible" || !document.hasFocus();
    if (e.type === "message") {
      if (away) setUnread((n) => n + 1);
      notify(`${e.message.name} · #${room}`, preview(e.message), `room-${room}`);
    } else if (e.type === "leave") {
      toast(`${e.member.name} left the room`);
      notify(`#${room}`, `${e.member.name} left the room`, `room-${room}-presence`);
    } else if (e.type === "error") {
      toast(e.message, "error");
    } else if (e.type === "deleted") {
      deletedBy.current = e.by;
      notify(`#${room}`, `${e.by} deleted this room`);
    }
  }, [room, toast]);

  const chat = useChat({ room, name, password, onEvent });
  const { status, me, members, messages, system } = chat;

  useEffect(() => {
    if (status === "join_error" && chat.joinError) onJoinError(chat.joinError.code, chat.joinError.message);
    if (status === "deleted") onDeleted(deletedBy.current, deletedByMe.current);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unread count in the tab title while you're looking elsewhere.
  useEffect(() => {
    document.title = unread ? `(${unread}) #${room}` : `#${room}`;
  }, [unread, room]);
  useEffect(() => {
    const seen = () => document.visibilityState === "visible" && setUnread(0);
    window.addEventListener("focus", seen);
    document.addEventListener("visibilitychange", seen);
    return () => { window.removeEventListener("focus", seen); document.removeEventListener("visibilitychange", seen); };
  }, []);

  // ---- Scrolling: stick to the bottom unless the reader has scrolled up ----
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(0);
  const lastCount = useRef(0);
  const scrollToBottom = (smooth = false) => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };
  useLayoutEffect(() => {
    const added = messages.length - lastCount.current;
    lastCount.current = messages.length;
    const last = messages.at(-1);
    if (atBottom.current || (added > 0 && last?.pending)) {
      scrollToBottom();
      setNewBelow(0);
    } else if (added > 0) {
      setNewBelow((n) => n + added);
    }
  }, [messages, system.length]);

  // ---- Build the visible list: messages in server order, with "X left" lines and day dividers ----
  const rows = useMemo(() => {
    const out: ReactNode[] = [];
    const lines = [...system].sort((a, b) => a.afterSeq - b.afterSeq);
    let li = 0;
    let lastDay = "";
    const sys = (text: string, key: string) => (
      <li key={key} className="px-3 py-1 text-center text-[12px] text-dim" role="status">{text}</li>
    );
    for (const m of messages) {
      if (!m.pending && !m.failed) while (li < lines.length && lines[li].afterSeq < m.seq) { out.push(sys(lines[li].text, lines[li].id)); li++; }
      const day = dayLabel(m.createdAt);
      if (day !== lastDay) {
        out.push(
          <li key={`day-${m.id}`} className="flex items-center gap-3 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-dim" aria-hidden="true">
            <span className="flex-1 border-t border-line" />{day}<span className="flex-1 border-t border-line" />
          </li>,
        );
        lastDay = day;
      }
      out.push(
        <Fragment key={m.id}>
          <MessageItem
            message={m}
            me={me}
            selected={selected === m.id}
            onSelect={setSelected}
            onReact={chat.react}
            onMoreReactions={(id) => setSheet({ reactTo: id })}
            onEdit={(msg) => { setSelected(null); setEditing(msg); }}
            onDelete={(msg) => setSheet({ confirmDelete: msg })}
            onRetry={chat.retryFailed}
            onDiscard={chat.discardFailed}
            onViewImage={(src) => setSheet({ image: src })}
          />
        </Fragment>,
      );
    }
    while (li < lines.length) { out.push(sys(lines[li].text, lines[li].id)); li++; }
    return out;
  }, [messages, system, me, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Paste/drop an image anywhere on the page ----
  const composer = useRef<ComposerHandle | null>(null);
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("textarea,input")) return; // the composer handles its own
      const file = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
      if (file) { e.preventDefault(); composer.current?.attach(file); }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);

  async function toggleNotifications() {
    const permission = notificationPermission();
    if (notifyOn) {
      setNotificationsWanted(false); setNotifyOn(false);
      return toast("Notifications off");
    }
    if (permission === "unsupported") {
      return toast(
        window.isSecureContext
          ? "This browser can't show notifications here. On iPhone, add this page to your Home Screen first."
          : "Notifications need a secure (https) address. They work on localhost or once the app is deployed with https.",
        "error",
      );
    }
    if (permission === "denied") return toast("Notifications are blocked for this site. Allow them in your browser's site settings.", "error");
    if (await requestNotifications()) {
      setNotificationsWanted(true); setNotifyOn(true);
      toast("Notifications on. You'll be alerted about new messages and people leaving while this tab is in the background.");
    } else {
      toast("Notifications weren't allowed.", "error");
    }
  }

  async function shareLink() {
    const url = location.href;
    setSheet(null);
    try {
      if (navigator.share) return await navigator.share({ title: `#${room}`, url });
      await navigator.clipboard.writeText(url);
      toast("Room link copied");
    } catch { /* share sheet dismissed */ }
  }

  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.authorId === me?.authorId && !m.pending && !m.failed && m.kind === "text");
    if (mine) setEditing(mine);
  };

  return (
    <div
      className="flex flex-col h-dvh w-full max-w-3xl mx-auto bg-bg sm:border-x sm:border-line relative"
      onClick={(e) => { if (selected && !(e.target as HTMLElement).closest(".msg")) setSelected(null); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => {
        setDragging(false);
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
        if (file) { e.preventDefault(); composer.current?.attach(file); }
      }}
    >
      {/* Header */}
      <header className="flex-none flex items-center gap-1 h-14 pl-3 pr-1 border-b border-line bg-panel pt-[env(safe-area-inset-top)] box-content">
        <div className="flex-1 min-w-0">
          <h1 className="text-[15px] font-semibold truncate">
            <span className="text-primary">#</span>{room}
          </h1>
          <p className="text-[12px] text-dim truncate">
            {status === "open" ? `${members.length} here${chat.me ? ` · you're ` : ""}` : status === "reconnecting" ? "Reconnecting…" : "Connecting…"}
            {status === "open" && me && <span style={{ color: colorFor(me.color) }}>{me.name}</span>}
          </p>
        </div>
        <button className={`icon-btn !w-11 !h-11 ${notifyOn ? "!text-primary" : ""}`} onClick={toggleNotifications} aria-pressed={notifyOn} aria-label={notifyOn ? "Turn notifications off" : "Turn notifications on"} title={notifyOn ? "Notifications on" : "Notifications off"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10 20a2.2 2.2 0 0 0 4 0" />
            {!notifyOn && <path d="M3 3l18 18" />}
          </svg>
        </button>
        <button className="icon-btn !w-auto !h-11 px-2 gap-1 !flex items-center" onClick={() => setSheet("members")} aria-label={`${members.length} people here`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 13.6a6.5 6.5 0 0 1 3.5 6.4" /></svg>
          <span className="text-[13px] tabular-nums">{members.length}</span>
        </button>
        <button className="icon-btn !w-11 !h-11" onClick={() => setSheet("menu")} aria-label="Room menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
        </button>
      </header>

      {status === "reconnecting" && (
        <div className="flex-none px-3 py-1.5 text-[12px] bg-panel-2 border-b border-primary-dim text-text" role="status">
          Connection lost. Reconnecting… messages you send will go out when it's back.
        </div>
      )}

      {/* Toasts */}
      <div className="absolute left-0 right-0 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-30 flex flex-col items-center gap-1.5 px-3 pointer-events-none" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-in max-w-md w-fit px-3 py-2 text-[13px] bg-panel-2 border shadow-lg ${t.tone === "error" ? "border-primary text-text" : "border-line"}`}>
            {t.text}
          </div>
        ))}
      </div>

      {/* Messages */}
      <div
        ref={list}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (atBottom.current) setNewBelow(0);
        }}
        onLoadCapture={() => atBottom.current && scrollToBottom()}
      >
        {messages.length === 0 && status === "open" && (
          <div className="h-full grid place-items-center p-8 text-center">
            <div className="space-y-2 max-w-xs">
              <p className="text-primary text-[13px] uppercase tracking-[0.12em]">#{room}</p>
              <p className="text-dim text-sm">No messages yet. Say hello, paste an image, or share the link so others can join.</p>
              <button className="btn" onClick={shareLink}>Share room link</button>
            </div>
          </div>
        )}
        {status !== "open" && messages.length === 0 && (
          <div className="h-full grid place-items-center text-dim text-sm">Connecting…</div>
        )}
        <ul className="py-2">{rows}</ul>
      </div>

      {newBelow > 0 && (
        <button className="btn primary absolute left-1/2 -translate-x-1/2 bottom-24 z-20 shadow-lg !rounded-none" onClick={() => scrollToBottom(true)}>
          {newBelow} new ↓
        </button>
      )}

      <Composer
        handle={composer}
        editing={editing}
        onSend={(out) => { atBottom.current = true; chat.send(out); }}
        onSaveEdit={chat.edit}
        onCancelEdit={() => setEditing(null)}
        onEditLast={editLast}
        onError={(m) => toast(m, "error")}
      />

      {dragging && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/60 border-2 border-dashed border-primary pointer-events-none">
          <p className="text-primary text-lg">Drop the image to send it</p>
        </div>
      )}

      {/* Sheets */}
      {sheet === "members" && (
        <Sheet title={`In #${room} (${members.length})`} onClose={() => setSheet(null)}>
          <ul className="overflow-y-auto -mx-1">
            {members.map((m) => (
              <li key={m.authorId} className="row !cursor-default !items-center" style={{ borderLeftColor: colorFor(m.color) }}>
                <span className="w-3 h-3 flex-none" style={{ background: colorFor(m.color) }} />
                <span className="grow font-semibold" style={{ color: colorFor(m.color) }}>{m.name}</span>
                {m.authorId === me?.authorId && <span className="tag">you</span>}
              </li>
            ))}
          </ul>
        </Sheet>
      )}

      {sheet === "menu" && (
        <Sheet title={`#${room}`} onClose={() => setSheet(null)}>
          <div className="flex flex-col gap-2">
            <button className="btn text-left !py-3" onClick={shareLink}>Share room link</button>
            <button className="btn text-left !py-3" onClick={() => { setSheet(null); toggleNotifications(); }}>
              {notifyOn ? "Turn notifications off" : "Turn notifications on"}
            </button>
            <a className="btn text-left !py-3 no-underline" href="/">Leave room</a>
            {me?.isOwner && (
              <button className="btn text-left !py-3 !text-primary !border-primary-dim" onClick={() => setSheet("delete-room")}>Delete room…</button>
            )}
          </div>
          {me?.isOwner && <p className="text-[12px] text-dim mt-3">You started this room, so you can delete it.</p>}
        </Sheet>
      )}

      {sheet === "delete-room" && (
        <Sheet
          title="Delete this room?"
          onClose={() => setSheet(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSheet(null)}>Cancel</button>
              <button className="btn primary" onClick={() => { deletedByMe.current = true; chat.deleteRoom(); setSheet(null); }}>Delete room</button>
            </>
          }
        >
          <p className="text-sm leading-relaxed">
            Everyone in <span className="text-primary">#{room}</span> will be removed and all messages will be gone for good.
            Anyone who visits the link afterwards will start a new, empty room.
          </p>
        </Sheet>
      )}

      {sheet && typeof sheet === "object" && "confirmDelete" in sheet && (
        <Sheet
          title="Delete message?"
          onClose={() => setSheet(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSheet(null)}>Cancel</button>
              <button className="btn primary" onClick={() => { chat.remove(sheet.confirmDelete.id); setSelected(null); setSheet(null); }}>Delete</button>
            </>
          }
        >
          <p className="text-sm text-dim break-words line-clamp-4">{preview(sheet.confirmDelete) || "This message"}</p>
          <p className="text-sm mt-2">It will be removed for everyone.</p>
        </Sheet>
      )}

      {sheet && typeof sheet === "object" && "reactTo" in sheet && (
        <EmojiPicker title="React" onPick={(e) => { chat.react(sheet.reactTo, e); setSelected(null); }} onClose={() => setSheet(null)} />
      )}

      {sheet && typeof sheet === "object" && "image" in sheet && (
        <div className="overlay z-50 !bg-black/90 p-2" onClick={() => setSheet(null)} role="dialog" aria-label="Image">
          <img src={sheet.image} alt="" className="max-w-full max-h-full object-contain" />
          <button className="icon-btn absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 !w-11 !h-11 !text-text" aria-label="Close image">✕</button>
        </div>
      )}
    </div>
  );
}
