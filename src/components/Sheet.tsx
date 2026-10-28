import { useEffect, type ReactNode } from "react";

/**
 * A panel that slides up from the bottom on phones and sits centered on wider
 * screens. Uses the theme's .overlay backdrop. Closes on backdrop tap or Escape.
 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="overlay z-40 !items-end sm:!items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full sm:w-[min(520px,94vw)] max-h-[85dvh] bg-bg border-t sm:border border-primary flex flex-col gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sheet-in"
      >
        <div className="flex items-center gap-2">
          <h2 className="flex-1">{title}</h2>
          <button className="icon-btn !w-9 !h-9" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3l10 10M13 3 3 13" /></svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        {footer && <div className="footer">{footer}</div>}
      </div>
    </div>
  );
}
