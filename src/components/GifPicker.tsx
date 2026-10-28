import { useEffect, useRef, useState } from "react";
import { Sheet } from "./Sheet";

type Gif = { id: string; title: string; preview: string; url: string; width: number; height: number };

/** GIF search through the server's GIPHY proxy (the API key stays on the server). */
export function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Gif[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  async function load(query: string, offset: number) {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/gifs?${new URLSearchParams({ q: query, offset: String(offset) })}`);
      const body = await r.json();
      if (id !== request.current) return; // a newer search replaced this one
      if (!r.ok) throw new Error(body.error);
      setEnabled(body.enabled);
      setResults((prev) => (offset ? [...prev, ...body.results] : body.results));
      setNext(body.results.length ? body.next : null);
    } catch {
      if (id === request.current) setError("Couldn't load GIFs. Check your connection and try again.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(q.trim(), 0), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Sheet title="Send a GIF" onClose={onClose}>
      {!enabled ? (
        <div className="text-sm leading-relaxed text-dim space-y-2">
          <p>GIF search isn't set up on this server yet. It needs a free GIPHY API key in the <code className="text-text">GIPHY_API_KEY</code> setting.</p>
          <p>You can still paste a GIF link from GIPHY, Tenor, Imgur or KLIPY into the message box and it will show as a GIF.</p>
        </div>
      ) : (
        <>
          <input
            className="input !text-base mb-3"
            type="search"
            placeholder="Search GIPHY"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            enterKeyHint="search"
            aria-label="Search GIFs"
          />
          <div className="overflow-y-auto max-h-[52dvh] min-h-40">
            <div className="columns-2 sm:columns-3 gap-1.5">
              {results.map((g) => (
                <button
                  key={g.id}
                  className="block w-full mb-1.5 bg-panel-2 hover:outline-2 hover:outline-primary focus-visible:outline-2 focus-visible:outline-focus"
                  style={{ aspectRatio: `${g.width} / ${g.height}` }}
                  onClick={() => { onPick(g.url); onClose(); }}
                  title={g.title}
                >
                  <img src={g.preview} alt={g.title || "GIF"} loading="lazy" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
            {error && <p className="error text-sm">{error}</p>}
            {!loading && !error && results.length === 0 && <p className="dim text-sm">No GIFs found.</p>}
            {next !== null && results.length > 0 && (
              <button className="btn w-full mt-1" disabled={loading} onClick={() => load(q.trim(), next)}>
                {loading ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
          <p className="text-[11px] dim text-right">Powered by GIPHY</p>
        </>
      )}
    </Sheet>
  );
}
