import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Backdrop } from "./components/Backdrop";
import { ChatScreen } from "./components/ChatScreen";
import { savedName, savedPassword, saveName, savePassword } from "./lib/storage";

const ROOM_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").replace(/^[-_]+/, "").slice(0, 40);

type RoomInfo = { name: string; exists: boolean; hasPassword: boolean };
type Phase =
  | { at: "checking" }
  | { at: "form"; info: RoomInfo; error?: string }
  | { at: "chat"; name: string; password: string | null }
  | { at: "deleted"; by: string; byMe: boolean }
  | { at: "unreachable" };

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh grid place-items-center p-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm bg-panel/85 border border-line p-5 flex flex-col gap-4 shadow-2xl">{children}</div>
    </main>
  );
}

function Landing({ error }: { error?: string }) {
  const [name, setName] = useState("");
  const go = (e: FormEvent) => {
    e.preventDefault();
    const room = slug(name);
    if (ROOM_RE.test(room)) location.assign(`/${room}`);
  };
  return (
    <Frame>
      <h2>Flare</h2>
      <p className="text-sm text-dim leading-relaxed">
        Pick a room name. If nobody's using it yet, you'll start it (and can add a password). If it exists, you'll join it.
      </p>
      {error && <p className="error text-sm">{error}</p>}
      <form onSubmit={go} className="flex flex-col gap-3">
        <label className="field">
          <span className="field-label">Room</span>
          <div className="flex items-center input !p-0 focus-within:outline-2 focus-within:outline-focus">
            <span className="pl-2.5 text-primary">/</span>
            <input
              className="flex-1 min-w-0 bg-transparent outline-none px-1.5 py-2.5 text-base"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="friday-game-night"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              aria-label="Room name"
            />
          </div>
          {name && slug(name) !== name && <span className="field-msg">Will open /{slug(name) || "…"}</span>}
        </label>
        <button className="btn primary !py-2.5" disabled={!ROOM_RE.test(slug(name))}>Go to room</button>
      </form>
    </Frame>
  );
}

function JoinForm({ info, error, onJoin }: { info: RoomInfo; error?: string; onJoin: (name: string, password: string | null) => void }) {
  const [name, setName] = useState(savedName());
  const [password, setPassword] = useState("");
  const creating = !info.exists;
  const needsPassword = info.exists && info.hasPassword;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (needsPassword && !password)) return;
    onJoin(name.trim().replace(/\s+/g, " "), password || null);
  };
  return (
    <Frame>
      <div>
        <h2>#{info.name}</h2>
        <p className="text-sm text-dim mt-1.5 leading-relaxed">
          {creating
            ? "This room doesn't exist yet. You'll start it, and you'll be the only one who can delete it."
            : needsPassword
              ? "This room is password protected."
              : "Pick a name to join the room."}
        </p>
      </div>
      {error && <p className="error text-sm" role="alert">{error}</p>}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input !text-base !py-2.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="nickname"
            autoFocus={!name}
            required
          />
        </label>
        {(creating || needsPassword) && (
          <label className="field">
            <span className="field-label">{creating ? "Password (optional)" : "Room password"}</span>
            <input
              className="input !text-base !py-2.5"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
              autoComplete={creating ? "new-password" : "current-password"}
              autoFocus={!!name && needsPassword}
              required={needsPassword}
            />
            {creating && <span className="field-msg">Leave empty for a room anyone with the link can join.</span>}
          </label>
        )}
        <button className="btn primary !py-2.5" disabled={!name.trim() || (needsPassword && !password)}>
          {creating ? "Create room" : "Join room"}
        </button>
      </form>
      <a href="/" className="text-[12px] text-dim self-center hover:text-primary">Choose a different room</a>
    </Frame>
  );
}

export default function App() {
  const [background, setBackground] = useState<string | null>(null);
  return (
    <>
      <Backdrop image={background} />
      <Screens onBackground={setBackground} />
    </>
  );
}

function Screens({ onBackground }: { onBackground: (image: string | null) => void }) {
  const raw = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ""));
  const room = raw.toLowerCase();
  const valid = ROOM_RE.test(room);
  const [phase, setPhase] = useState<Phase>({ at: "checking" });

  async function check(error?: string) {
    try {
      const r = await fetch(`/api/rooms/${encodeURIComponent(room)}`);
      if (!r.ok) throw new Error();
      const info: RoomInfo = await r.json();
      const name = savedName();
      const pw = savedPassword(room);
      // Open rooms let you straight in if we already know your name.
      if (!error && info.exists && name && (!info.hasPassword || pw)) return setPhase({ at: "chat", name, password: pw });
      setPhase({ at: "form", info, error });
    } catch {
      setPhase({ at: "unreachable" });
    }
  }

  useEffect(() => {
    if (!valid) return;
    if (raw !== room) history.replaceState(null, "", `/${room}`);
    document.title = `#${room}`;
    check();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!raw) return <Landing />;
  if (!valid) return <Landing error={`"/${raw}" isn't a valid room. Use letters, numbers, - and _ (up to 40).`} />;

  switch (phase.at) {
    case "checking":
      return <Frame><p className="text-dim text-sm">Looking for #{room}…</p></Frame>;
    case "unreachable":
      return (
        <Frame>
          <h2>Can't reach the server</h2>
          <p className="text-sm text-dim">Check your connection and try again.</p>
          <button className="btn primary" onClick={() => { setPhase({ at: "checking" }); check(); }}>Try again</button>
        </Frame>
      );
    case "form":
      return (
        <JoinForm
          info={phase.info}
          error={phase.error}
          onJoin={(name, password) => {
            saveName(name);
            savePassword(room, password);
            setPhase({ at: "chat", name, password });
          }}
        />
      );
    case "chat":
      return (
        <ChatScreen
          room={room}
          name={phase.name}
          password={phase.password}
          onJoinError={(code, message) => {
            if (code === "bad_password" || code === "password_required") savePassword(room, null);
            check(message); // re-check: the room may have been created by someone else meanwhile
          }}
          onDeleted={(by, byMe) => { savePassword(room, null); setPhase({ at: "deleted", by, byMe }); }}
          onBackground={onBackground}
        />
      );
    case "deleted":
      return (
        <Frame>
          <h2>Room deleted</h2>
          <p className="text-sm text-dim leading-relaxed">
            {phase.byMe ? `You deleted #${room}.` : `${phase.by || "The room's creator"} deleted #${room}.`} All of its messages are gone.
          </p>
          <div className="flex gap-2">
            <a className="btn no-underline" href="/">Home</a>
            <a className="btn primary no-underline" href={`/${room}`}>Start #{room} again</a>
          </div>
        </Frame>
      );
  }
}
