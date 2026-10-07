/** Text helpers shared by the engines. Pure functions, no I/O. */

const TURKISH_FOLD: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  i̇: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  â: "a",
  î: "i",
  û: "u",
};

/** Lowercases with Turkish rules and folds Turkish letters to ASCII for robust matching. */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]|i̇/g, (ch) => TURKISH_FOLD[ch] ?? ch);
}

/** Trims, collapses whitespace and removes leading list markers ("- ", "1. ", "• "). */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^([-*•·]|\d+[.)])\s+/, "")
    .trim();
}

/** Clean list item: no trailing period (lists read better without), no empty strings. */
export function cleanItem(text: string): string {
  return cleanText(text).replace(/[.;,]+$/, "").trim();
}

export function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLocaleUpperCase("tr") + text.slice(1);
}

/** Ensures a sentence ends with terminal punctuation. */
export function ensureSentence(text: string): string {
  const t = cleanText(text);
  if (!t) return t;
  return /[.!?:)]$/.test(t) ? t : `${t}.`;
}

/** Normalized comparison key: folded, punctuation removed, single spaces. */
export function normalizeKey(text: string): string {
  return fold(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    normalizeKey(text)
      .split(" ")
      .filter((t) => t.length > 2),
  );
}

/** Jaccard similarity of meaningful word tokens. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return normalizeKey(a) === normalizeKey(b) ? 1 : 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function isNearDuplicate(a: string, b: string, threshold = 0.8): boolean {
  const ka = normalizeKey(a);
  const kb = normalizeKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return similarity(a, b) >= threshold;
}

/** Removes empty and near-duplicate strings, keeping the first occurrence. */
export function dedupeTexts(texts: string[], threshold = 0.8): string[] {
  const out: string[] = [];
  for (const raw of texts) {
    const text = cleanItem(raw);
    if (!text) continue;
    if (out.some((existing) => isNearDuplicate(existing, text, threshold))) continue;
    out.push(text);
  }
  return out;
}

export function truncateWords(text: string, maxWords: number): string {
  const words = cleanText(text).split(" ");
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

/** Replaces {name} placeholders. Unknown placeholders are left as-is so the validator can catch them. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? vars[key]! : match));
}

/** Lowercases the first letter unless the first word looks like an acronym ("API", "URL"). */
export function lowercaseFirst(text: string): string {
  if (text.length < 2) return text.toLocaleLowerCase("en");
  const second = text.charAt(1);
  if (second === second.toLocaleUpperCase("en") && second !== second.toLocaleLowerCase("en")) return text;
  return text.charAt(0).toLocaleLowerCase("en") + text.slice(1);
}
