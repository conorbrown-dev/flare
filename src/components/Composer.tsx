import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { gifUrlFrom, imageFromTransfer, prepareImage } from "../lib/media";
import type { Message, Outgoing } from "../lib/types";
import { EmojiPicker } from "./EmojiPicker";
import { GifPicker } from "./GifPicker";

const MAX = 4000;
const touchFirst = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export type ComposerHandle = { attach: (file: File) => void; focus: () => void };

type Props = {
  handle: RefObject<ComposerHandle | null>;
  editing: Message | null;
  onSend: (out: Outgoing) => void;
  onSaveEdit: (id: string, text: string) => void;
  onCancelEdit: () => void;
  onEditLast: () => void;
  onError: (message: string) => void;
};

const Icon = ({ d, label }: { d: string; label: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <title>{label}</title>
    <path d={d} />
  </svg>
);

export function Composer({ handle, editing, onSend, onSaveEdit, onCancelEdit, onEditLast, onError }: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [picker, setPicker] = useState<"emoji" | "gif" | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftBeforeEdit = useRef("");

  async function attach(file: File) {
    setPreparing(true);
    try {
      setImage(await prepareImage(file));
      box.current?.focus();
    } catch (err) {
      onError((err as Error).message || "Couldn't read that image.");
    } finally {
      setPreparing(false);
    }
  }

  handle.current = { attach, focus: () => box.current?.focus() };

  // Entering edit mode loads the message into the box; leaving restores the draft.
  useEffect(() => {
    if (editing) {
      draftBeforeEdit.current = text;
      setText(editing.text ?? "");
      setImage(null);
      requestAnimationFrame(() => {
        const el = box.current;
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    } else {
      setText(draftBeforeEdit.current);
      draftBeforeEdit.current = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  // Grow the box with its content, up to about six lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function submit() {
    const trimmed = text.trim();
    if (trimmed.length > MAX) return onError(`Messages are limited to ${MAX} characters.`);
    if (editing) {
      if (!trimmed && editing.kind === "text") return onError("A message can't be empty. Delete it instead.");
      if (trimmed !== (editing.text ?? "")) onSaveEdit(editing.id, trimmed);
      onCancelEdit(); // leaving edit mode brings back whatever you were typing before
      return;
    }
    if (image) {
      onSend({ kind: "image", src: image, text: trimmed || undefined });
      setImage(null);
    } else if (trimmed) {
      const gif = gifUrlFrom(trimmed);
      onSend(gif ? { kind: "gif", src: gif } : { kind: "text", text: trimmed });
    } else {
      return;
    }
    setText("");
    box.current?.focus();
  }

  function insertEmoji(emoji: string) {
    const el = box.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => el?.setSelectionRange(start + emoji.length, start + emoji.length));
  }

  const canSend = !preparing && (!!image || !!text.trim() || (!!editing && editing.kind !== "text"));

  return (
    <div className="flex-none border-t border-line bg-panel px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {editing && (
        <div className="flex items-center gap-2 px-1 pb-2 text-[13px]">
          <span className="text-primary font-semibold">Editing message</span>
          <span className="flex-1 truncate text-dim">{editing.text}</span>
          <button className="chip" onClick={onCancelEdit}>Cancel</button>
        </div>
      )}
      {(image || preparing) && (
        <div className="flex items-end gap-2 px-1 pb-2">
          {image ? (
            <img src={image} alt="Image to send" className="h-20 max-w-40 object-contain border border-line bg-bg" />
          ) : (
            <div className="h-20 w-28 grid place-items-center border border-dashed border-line text-dim text-xs">Preparing…</div>
          )}
          <span className="text-xs text-dim flex-1">Add a caption below, or just send.</span>
          {image && <button className="chip" onClick={() => setImage(null)}>Remove</button>}
        </div>
      )}
      <div className="flex items-end gap-1">
        {!editing && (
          <>
            <button className="icon-btn !w-10 !h-10 flex-none" onClick={() => fileInput.current?.click()} aria-label="Attach an image" title="Attach an image">
              <Icon label="Attach an image" d="M21 12.5 12.9 20.6a5.2 5.2 0 0 1-7.4-7.4l8.5-8.5a3.5 3.5 0 0 1 4.9 4.9l-8.5 8.5a1.7 1.7 0 0 1-2.5-2.5l7.8-7.8" />
            </button>
            <button className="icon-btn !w-10 !h-10 flex-none font-bold text-[12px] tracking-wide" onClick={() => setPicker("gif")} aria-label="Send a GIF" title="Send a GIF">
              <span className="border border-current px-1 leading-4">GIF</span>
            </button>
          </>
        )}
        <textarea
          ref={box}
          rows={1}
          value={text}
          maxLength={MAX + 200}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const file = imageFromTransfer(e.clipboardData);
            if (file && !editing) { e.preventDefault(); attach(file); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touchFirst()) { e.preventDefault(); submit(); }
            else if (e.key === "Escape" && editing) { e.preventDefault(); onCancelEdit(); }
            else if (e.key === "ArrowUp" && !text && !editing && !image) { e.preventDefault(); onEditLast(); }
          }}
          placeholder={image ? "Add a caption…" : "Message"}
          aria-label={editing ? "Edit message" : "Message"}
          enterKeyHint={touchFirst() ? "enter" : "send"}
          className="input flex-1 min-w-0 !text-base !py-2 resize-none leading-snug"
        />
        <button className="icon-btn !w-10 !h-10 flex-none text-[20px]" onClick={() => setPicker("emoji")} aria-label="Add emoji" title="Add emoji">
          😊
        </button>
        <button className="btn primary !px-3.5 !py-2 flex-none" onClick={submit} disabled={!canSend} aria-label={editing ? "Save edit" : "Send"}>
          {editing ? "Save" : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
          )}
        </button>
      </div>
      {text.length > MAX - 300 && (
        <p className={`text-[11px] text-right px-1 pt-1 ${text.length > MAX ? "error" : "dim"}`}>{text.length} / {MAX}</p>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ""; }}
      />
      {picker === "emoji" && <EmojiPicker title="Add emoji" keepOpen onPick={insertEmoji} onClose={() => { setPicker(null); box.current?.focus(); }} />}
      {picker === "gif" && <GifPicker onPick={(url) => onSend({ kind: "gif", src: url })} onClose={() => setPicker(null)} />}
    </div>
  );
}
