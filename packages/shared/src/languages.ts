export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
  { code: "ur-Latn", name: "Roman Urdu", nativeName: "Roman Urdu" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export function getLanguageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}