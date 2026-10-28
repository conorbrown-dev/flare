// Languages offered for reading and translating. Must match LANGUAGES in server/translate.js.
export const LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "sv", name: "Swedish", native: "Svenska" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "cs", name: "Czech", native: "Čeština" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "el", name: "Greek", native: "Ελληνικά" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "zh", name: "Chinese (Simplified)", native: "中文" },
];

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));
export const isLanguage = (code: string | null | undefined): code is string => !!code && byCode.has(code);

/** e.g. "日本語" — what a language calls itself. */
export const nativeName = (code: string) => byCode.get(code)?.native ?? code;
/** e.g. "Japanese (日本語)" — for settings lists. */
export const fullName = (code: string) => {
  const l = byCode.get(code);
  if (!l) return code;
  return l.name === l.native ? l.name : `${l.name} (${l.native})`;
};

/** The browser's language if we support it, otherwise English. */
export function browserLanguage() {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag?.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}
