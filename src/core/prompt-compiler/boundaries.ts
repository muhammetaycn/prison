import { cleanText, fold } from "@/core/text/normalize";

/** A complete boundary instruction must not acquire another "Do not" from its list heading. */
export function isBoundaryDirective(text: string): boolean {
  const value = fold(cleanText(text));
  return /^(?:do not|don['’]t|never)\b/.test(value)
    || /^(?:keep|leave|maintain|ensure)\b.+\b(?:disabled|forbidden|prohibited|blocked|off|unchanged|intact)\b(?:\s+(?:unless|until|without)\b.*)?[.!]?$/.test(value);
}
