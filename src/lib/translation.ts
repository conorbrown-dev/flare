import type { Message } from "./types";

export type LangOption = { lang: string; role: "sent" | "original" | "yours"; ready: boolean };

/**
 * Works out what to show for a message's text.
 *
 * - By default everyone sees the version the author chose to send (e.g. Japanese),
 *   once it's ready; until then, or if it failed, the original.
 * - `chosen` is a reader's pick from the options: the sent translation, the
 *   original, or the reader's own primary language.
 */
export function languageView(m: Message, myLang: string, chosen: string | undefined, canTranslate: boolean) {
  const has = (lang: string) => lang === m.lang || !!m.translations?.[lang];
  const sentReady = !!m.sentLang && !!m.translations?.[m.sentLang];
  const defaultLang = sentReady ? m.sentLang! : m.lang;
  const want = chosen ?? defaultLang;
  const shownLang = want && has(want) ? want : m.lang; // fall back to the original while waiting
  const text = shownLang && shownLang !== m.lang ? m.translations![shownLang] : m.text;

  const options: LangOption[] = [];
  const add = (lang: string | undefined, role: LangOption["role"]) => {
    if (!lang || options.some((o) => o.lang === lang)) return;
    if (role === "yours" && !canTranslate && !has(lang)) return;
    options.push({ lang, role, ready: has(lang) });
  };
  if (m.text && m.lang) {
    add(m.sentLang, "sent");
    add(m.lang, "original");
    add(myLang, "yours");
  }

  return {
    text,
    shownLang,
    isTranslated: !!shownLang && !!m.lang && shownLang !== m.lang,
    /** Waiting on the author's chosen translation. */
    sending: !!m.sentLang && !sentReady && !m.translationFailed && (m.pending || !!m.translating?.includes(m.sentLang)),
    /** Waiting on a translation this reader asked for. */
    waitingFor: chosen && !has(chosen) ? chosen : null,
    options: options.length > 1 ? options : [],
  };
}
