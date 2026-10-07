import { fold } from "@/core/text/normalize";

const MODE_WORD = "(?:mod(?:u|unu|unda|uyla|undan|da|dan)?|mode)";
const MODE_NAMES = new RegExp(`\\b(?:(?:jailbreak|jb)(?:[ -]+${MODE_WORD})?|(?:uncensored|sansursuz|hakiki)[ -]+${MODE_WORD})\\b`, "g");
const ENABLE_BEFORE = /\b(?:enable|activate|use|ac|etkinlestir|kullan|aktiflestir|turn on|want)(?:\s+(?:the|a))?\s*$/;
const ENABLE_AFTER = /^\s*(?:(?:is|be|should|must|will|remain|stay|please|lutfen)\s+){0,3}(?:ac|acin|etkinlestir|kullan|aktiflestir|istiyorum|enable|enabled|activate|activated|active|on|acik|acar\s+misin|acar\s+misiniz)\b/;
// Anchor the negative action to the mode name; unrelated "do not deploy" constraints are separate selections.
const DISABLE_BEFORE = /\b(?:without|no|disable|deactivate|turn off|kapat|kapatin|kullanma|acma|do not|don['’]t|never|not)(?:\s+(?:want(?:\s+to)?|use|enable|activate|allow|turn on)){0,2}(?:\s+(?:the|any|a))?\s*$/;
const DISABLE_AFTER = /^\s*(?:(?:is|be|should|must|will|remain|stay|please|lutfen)\s+){0,3}(?:(?:kullanmak|acmak|etkinlestirmek|aktiflestirmek)\s+istemiyorum|kullanma|kullanmayin|kullanilmasin|kullanmasin|acma|acmayin|acilmasin|acmasin|istemiyorum|olmasin|kapali|kapat|kapatin|kapatir\s+misin|kapatir\s+misiniz|pasif|disable|disabled|deactivate|off|devre disi|not(?:\s+(?:be|remain|stay))?\s+(?:enabled|activated|used|active|on))\b/;
const IN_MODE = /[ -]+(?:modda|modunda|moduyla)\b/;

/** A reference or a status question is task data, not a request to switch the mode. */
function isInformationalReference(before: string, after: string, clause: string): boolean {
  const localBefore = before.split(/,|\b(?:but|then|ama|sonra)\b/).at(-1)!.trim().replace(/["'“‘`]/g, "");
  after = after.replace(/^\s*:\s*/, " ");
  if (/^(?:explain|describe|define|what|how|why|tell me about|is|are|was|were|should i|can i|could i|would i|if i|neden|ne|nasil)\b/.test(localBefore)) return true;
  if (/^(?:can|could|should|would|must)(?:\s+the)?$/.test(localBefore)) return true;
  if (/^\s*(?:nedir|ne demek|ne anlama|nasil|hakkinda|acikla|aciklayin|anlat|tanimla|explain|describe|define|what|how|why)\b/.test(after)) return true;
  if (/^\s*(?:(?:is|be)\s+)?(?:enabled|disabled|active|inactive|on|off|acik|kapali|pasif|acilmasin|kullanilmasin|olmasin)\s+(?:degil\s+)?(?:mi|midir|miydi|misin|misiniz)\b/.test(after)) return true;
  if (/\?\s*$/.test(clause) && /^\s*(?:(?:is|be|should)\s+)?(?:not\s+(?:be\s+)?)?(?:enabled|disabled|active|inactive|on|off|acik|kapali|pasif)\s*\?/.test(after)) return true;
  return /["'”’`]\s*(?:cumlesi|komutu|ifadesi|phrase|command|instruction)\b.*\b(?:ne|anlama|acikla|anlat|means|mean|explain|describe)\b/.test(after);
}

/** Undefined means no mode selection. Only user-authored mode phrases qualify, not generic product filters. */
export function readJailbreakModeRequest(rawRequest: string): boolean | undefined {
  let requested: boolean | undefined;
  for (const clause of fold(rawRequest).match(/[^.!?;\n]+(?:[.!?;\n]+|$)/g) ?? []) {
    const text = clause.trim();
    for (const match of text.matchAll(MODE_NAMES)) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      if (isInformationalReference(before, after, text)) continue;
      const actionBefore = before.replace(/["'“‘`]\s*$/, "");
      const actionAfter = after.replace(/^\s*["'”’`]/, "");
      if (DISABLE_BEFORE.test(actionBefore) || DISABLE_AFTER.test(actionAfter)) {
        requested = false;
        continue;
      }
      const headingOrBareSelection = !actionBefore.trim() && /^(?:\s*[:.!;\n]\s*|\s*$)/.test(actionAfter);
      if (IN_MODE.test(match[0]) || ENABLE_BEFORE.test(actionBefore) || ENABLE_AFTER.test(actionAfter) || headingOrBareSelection) {
        requested = true;
      }
    }
  }
  return requested;
}
