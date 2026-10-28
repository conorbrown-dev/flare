import { memo, type ReactNode } from "react";
import { colorFor } from "../lib/colors";
import { nativeName } from "../lib/languages";
import { isJumboEmoji } from "../lib/media";
import { languageView } from "../lib/translation";
import type { Me, Message } from "../lib/types";
import { QUICK_REACTIONS } from "./EmojiPicker";

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

/** Plain text with web links made clickable. Never renders HTML from the message. */
function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2 break-all">
        {m[0]}
      </a>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

type Props = {
  message: Message;
  me: Me | null;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onReact: (id: string, emoji: string) => void;
  onMoreReactions: (id: string) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onRetry: (tempId: string) => void;
  onDiscard: (tempId: string) => void;
  onViewImage: (src: string) => void;
  myLang: string;
  chosenLang?: string;
  canTranslate: boolean;
  onChooseLang: (m: Message, lang: string) => void;
};

export const MessageItem = memo(function MessageItem({
  message: m, me, selected, onSelect, onReact, onMoreReactions, onEdit, onDelete, onRetry, onDiscard, onViewImage,
  myLang, chosenLang, canTranslate, onChooseLang,
}: Props) {
  const mine = !!me && m.authorId === me.authorId;
  const color = colorFor(m.color);
  const confirmed = !m.pending && !m.failed;
  const view = languageView(m, myLang, chosenLang, canTranslate);
  const shownText = view.text;
  const jumbo = m.kind === "text" && isJumboEmoji(shownText);

  // One tap on the 🌐 line flips between the original and a translation.
  const toggleTarget = view.isTranslated
    ? m.lang
    : view.options.find((o) => o.role === "sent" && o.ready)?.lang ?? view.options.find((o) => o.role === "yours")?.lang;
  let langLine: string | null = null;
  if (view.sending) langLine = `Translating to ${nativeName(m.sentLang!)}…`;
  else if (view.waitingFor) langLine = `Translating to ${nativeName(view.waitingFor)}…`;
  else if (m.translationFailed && m.sentLang && !view.isTranslated) langLine = `Couldn't translate to ${nativeName(m.sentLang)}, showing the original`;
  else if (view.isTranslated) langLine = `${nativeName(view.shownLang!)} · translated from ${nativeName(m.lang!)} · show original`;
  else if (toggleTarget && view.options.length) langLine = `${nativeName(m.lang!)} (original) · show in ${nativeName(toggleTarget)}`;

  return (
    <li
      className={`msg relative px-3 py-1.5 border-l-[3px] ${selected ? "bg-panel-2" : "hover:bg-panel/70"} ${m.pending ? "opacity-60" : ""}`}
      style={{ borderLeftColor: color }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,img")) return;
        if (confirmed) onSelect(selected ? null : m.id);
      }}
      data-seq={m.seq}
    >
      <div className="flex items-baseline gap-2">
        <div className="flex-1 min-w-0 break-words whitespace-pre-wrap leading-snug text-[15px]">
          <span className="font-semibold mr-1.5" style={{ color }}>
            {m.name}:
          </span>
          {m.kind === "text" && shownText && (jumbo ? <span className="text-4xl leading-tight align-middle">{shownText}</span> : <Linkified text={shownText} />)}
          {m.kind !== "text" && shownText && <Linkified text={shownText} />}
        </div>
        <span className="flex-none text-[11px] text-dim tabular-nums" title={new Date(m.createdAt).toLocaleString()}>
          {m.pending ? "sending…" : time(m.createdAt)}
          {m.editedAt && <span title={`Edited ${new Date(m.editedAt).toLocaleString()}`}> · edited</span>}
        </span>
      </div>

      {langLine && (
        <button
          className="lang-line mt-0.5 flex items-center gap-1 text-[11.5px] text-dim hover:text-text text-left disabled:hover:text-dim"
          disabled={view.sending || !!view.waitingFor || !toggleTarget || !confirmed}
          onClick={() => toggleTarget && onChooseLang(m, toggleTarget)}
          aria-label={langLine}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={view.sending || view.waitingFor ? "animate-spin" : ""}>
            <circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19M12 2.5c3 3.2 3 15.8 0 19M12 2.5c-3 3.2-3 15.8 0 19" />
          </svg>
          <span>{langLine}</span>
        </button>
      )}

      {(m.kind === "image" || m.kind === "gif") && m.src && (
        <img
          src={m.src}
          alt={m.kind === "gif" ? "GIF" : `Image from ${m.name}`}
          loading="lazy"
          className="mt-1.5 max-h-72 max-w-[min(100%,420px)] w-auto object-contain bg-panel border border-line cursor-zoom-in"
          onClick={() => onViewImage(m.src!)}
        />
      )}

      {m.failed && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="error">Not sent: {m.failed}</span>
          <button className="chip" onClick={() => onRetry(m.tempId!)}>Retry</button>
          <button className="chip" onClick={() => onDiscard(m.tempId!)}>Discard</button>
        </div>
      )}

      {m.reactions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.reactions.map((r) => {
            const reacted = !!me && r.users.some((u) => u.authorId === me.authorId);
            return (
              <button
                key={r.emoji}
                className={`chip !px-2 !py-0.5 !text-[13px] ${reacted ? "on" : ""}`}
                onClick={() => onReact(m.id, r.emoji)}
                title={r.users.map((u) => u.name).join(", ")}
                aria-label={`${r.emoji} ${r.users.length}, from ${r.users.map((u) => u.name).join(", ")}${reacted ? ". Tap to remove yours" : ""}`}
                aria-pressed={reacted}
              >
                {r.emoji} <span className="tabular-nums">{r.users.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {selected && confirmed && (
        <div className="mt-2 flex flex-wrap items-center gap-1" role="toolbar" aria-label="Message actions">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} className="chip !text-lg !px-2 !py-0.5" onClick={() => { onReact(m.id, e); onSelect(null); }} aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
          <button className="chip !px-2.5 !py-1" onClick={() => onMoreReactions(m.id)} aria-label="More reactions">
            ＋😊
          </button>
          <span className="flex-1" />
          {m.kind === "text" && shownText && (
            <button className="chip !py-1" onClick={() => { navigator.clipboard?.writeText(shownText); onSelect(null); }}>Copy</button>
          )}
          {view.options.length > 0 && (
            <div className="basis-full flex flex-wrap items-center gap-1 pt-1" role="group" aria-label="Show this message in">
              <span className="text-[11px] text-dim mr-0.5">Show in</span>
              {view.options.map((o) => (
                <button
                  key={o.lang}
                  className={`chip !py-1 !text-[12px] ${view.shownLang === o.lang && !view.waitingFor ? "on" : ""} ${view.waitingFor === o.lang ? "on" : ""}`}
                  aria-pressed={view.shownLang === o.lang}
                  onClick={() => onChooseLang(m, o.lang)}
                >
                  {nativeName(o.lang)} <span className="text-dim">· {o.role === "sent" ? "sent" : o.role === "original" ? "original" : "yours"}</span>
                </button>
              ))}
            </div>
          )}
          {mine && (
            <>
              <button className="chip !py-1" onClick={() => onEdit(m)}>Edit</button>
              <button className="chip !py-1 hover:!text-primary" onClick={() => onDelete(m)}>Delete</button>
            </>
          )}
        </div>
      )}
    </li>
  );
});
