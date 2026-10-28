// Turning pasted / picked images into something small enough to send,
// and recognizing GIF links.

const MAX_SIDE = 1600; // longest edge in pixels after resizing
const MAX_DATA_URL = 3_400_000; // the server allows 3.5M characters

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Prepares an image file for sending. Photos are scaled down and re-encoded so
 * they upload quickly on mobile data. GIFs are sent untouched (re-encoding would
 * freeze the animation), so they must already be small enough.
 */
export async function prepareImage(file: File, maxSide = MAX_SIDE): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) && !/^image\//.test(file.type)) {
    throw new Error("That file isn't an image.");
  }
  if (file.type === "image/gif") {
    const url = await readAsDataUrl(file);
    if (url.length > MAX_DATA_URL) throw new Error("That GIF is too big (max about 2.5 MB).");
    return url;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Couldn't read that image. Try a PNG, JPEG, GIF or WebP.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5, 0.35]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    // Safari can't encode WebP and quietly hands back PNG; use JPEG there instead.
    const usable = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!usable) continue;
    const url = await readAsDataUrl(usable);
    if (url.length <= MAX_DATA_URL) return url;
  }
  throw new Error("Couldn't shrink that image enough to send.");
}

/** The first image in a paste or drop, if there is one. */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return Array.from(data.files ?? []).find((f) => f.type.startsWith("image/")) ?? null;
}

const GIF_HOSTS = [/^media\d*\.giphy\.com$/, /^i\.giphy\.com$/, /^media\.tenor\.com$/, /^c\.tenor\.com$/, /^i\.imgur\.com$/, /^static\.klipy\.com$/];

/**
 * If a whole message is just a GIF link, returns the direct image URL.
 * Handles GIPHY page links (giphy.com/gifs/some-title-ID) by pointing at the media file.
 */
export function gifUrlFrom(text: string): string | null {
  const t = text.trim();
  if (/\s/.test(t)) return null;
  let url: URL;
  try { url = new URL(t); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "giphy.com" || url.hostname === "www.giphy.com") {
    const m = url.pathname.match(/^\/(?:gifs|stickers)\/(?:.*-)?([A-Za-z0-9]+)\/?$/);
    return m ? `https://media.giphy.com/media/${m[1]}/giphy.gif` : null;
  }
  if (!GIF_HOSTS.some((h) => h.test(url.hostname))) return null;
  if (url.hostname === "i.imgur.com" && !/\.(gif|gifv|webp|mp4)$/i.test(url.pathname)) return null;
  if (url.hostname === "i.imgur.com") url.pathname = url.pathname.replace(/\.(gifv|mp4)$/i, ".gif");
  return url.toString();
}

/** True for text that is only 1-3 emoji (shown bigger, like most chat apps). */
export function isJumboEmoji(text?: string) {
  if (!text || text.length > 24) return false;
  const stripped = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣#*0-9\s]/gu, "");
  if (stripped.length) return false;
  const count = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.replace(/\s/g, ""))].length;
  return count >= 1 && count <= 3 && /\p{Extended_Pictographic}/u.test(text);
}
