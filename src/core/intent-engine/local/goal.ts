import { capitalizeFirst, cleanText, ensureSentence, truncateWords } from "@/core/text/normalize";

/**
 * Goal extraction for the local fallback engine: removes the "write me a prompt for X" wrapper
 * so the goal describes the task the target AI must do, and turns Turkish future-tense relative
 * clauses ("ekletecek", "sağlayacak") into imperatives ("ekle", "sağla").
 */

const NOT_LETTER = "(?=$|[^\\p{L}\\p{N}])";

const TARGET_MENTION = new RegExp(
  `(?:open\\s?ai\\s+)?(?<![\\p{L}])(?:codex|claude|chat\\s?gpt|gpt(?:-?\\d[\\w.]*)?|gemini)` +
    `(?:['’]?(?:ye|ya|yi|yı|nin|nın|e|a|i|ı|in|ın|un|ün|da|de))?` +
    `(?:\\s+(?:için|icin|ile|for|with))?${NOT_LETTER}`,
  "giu",
);

const META_TR =
  /\s*(?:için\s+)?(?:bir\s+)?(?:profesyonel\s+|detaylı\s+|iyi\s+)?(?:prompt|istem)(?:u|unu|ı|i|lar|ları)?\s*(?:üret(?:in|iniz)?|yaz(?:ın|ınız)?|oluştur(?:un|unuz)?|hazırla(?:yın|yınız)?|ver(?:in|iniz)?|çıkar(?:ın|ınız)?)(?!\p{L})/giu;
const META_EN =
  /\b(?:please\s+)?(?:write|generate|create|make|give\s+me|produce|craft|build)\s+(?:me\s+)?(?:a|an|the)?\s*(?:[\p{L}-]+\s+){0,2}?prompt(?!\s+(?:generator|builder|engine|library|templates?|system|manager|editor|collection|tool)\b)\s*(?:for|to|that|which|so\s+that)?\s*/giu;
const LEADING_PROMPT_WRAPPER = /^(?:a\s+|an\s+|the\s+)?prompt\s+(?:for|to|that|which)\s+/giu;
const TRAILING_PROMPT_WRAPPER = /\s+(?:prompt|promptu|promptunu)\s*$/giu;
const LEADING_ZH_PROMPT_WRAPPER = /^(?:请|麻烦)?(?:帮我|为我|给我)?(?:(?:为|给)\s*(?:codex|claude|chat\s?gpt|gpt|gemini)\s*)?(?:写|编写|生成|制作|创建)(?:一个|一段|一份)?(?:详细的|专业的|完整的|清晰的)?(?:提示词|prompt)(?!生成器|编辑器|管理器|系统|工具|库|模板)(?:\s*[，,:：]\s*)?(?:用于|用来|来|以便)?\s*/iu;
const TRAILING_ZH_PROMPT_WRAPPER = /^(?:请|麻烦)?(?:帮我)?为(.+?)(?:编写|生成|写|创建)(?:一个|一段|一份)?(?:详细的|专业的|完整的)?(?:提示词|prompt)[。.!]?$/iu;

const PROTECTION_PHRASE = /(?:\S+\s+)?\S+\s+(?:bozmadan|değiştirmeden|dokunmadan|bozulmadan)\s*/giu;
const PROTECTION_PHRASE_EN = /\s*,?\s*without (?:breaking|changing|touching) [^,.;]+/giu;

const FUTURE = /^(.+?)(y?ecek|y?acak)$/u;
const STEM_EXCEPTIONS: Record<string, string> = {
  ed: "et",
  gid: "git",
  yaptır: "yap",
  yazdır: "yaz",
  ettir: "et",
  düzelttir: "düzelt",
  buldur: "bul",
  anlat: "anlat",
  ilet: "ilet",
};

/** "ekletecek" → "ekle", "sağlayacak" → "sağla", "edecek" → "et". Other words are returned unchanged. */
export function toImperative(word: string): string {
  const match = word.match(FUTURE);
  if (!match?.[1] || match[1].length < 2) return word;
  let stem = match[1];
  const lower = stem.toLocaleLowerCase("tr");
  if (STEM_EXCEPTIONS[lower]) return STEM_EXCEPTIONS[lower]!;
  if (/(?:let|lat|rt)$/u.test(lower)) stem = stem.slice(0, -1);
  return stem;
}

const EN_THIRD_PERSON = /^(\p{L}+?)(ches|shes|sses|xes|zes|s)$/u;

function englishBaseVerb(word: string): string {
  const match = word.match(EN_THIRD_PERSON);
  if (!match?.[1] || match[1].length < 2) return word;
  const suffix = match[2];
  return suffix === "s" ? match[1] : `${match[1]}${suffix!.slice(0, -2)}`;
}

function imperativizeClause(clause: string): string {
  const words = clause.trim().split(/\s+/);
  if (words.length === 0) return clause;
  const last = words[words.length - 1]!;
  const converted = toImperative(last);
  if (converted !== last) {
    words[words.length - 1] = converted;
  } else if (/^(that|which|to)$/i.test(words[0]!)) {
    words.shift();
    if (words[0]) words[0] = englishBaseVerb(words[0]);
  } else if (/^[a-z]/i.test(words[0]!) && words.length > 2 && /^(a|an|the|my|our|your|its)$/i.test(words[1]!)) {
    words[0] = englishBaseVerb(words[0]!);
  }
  return words.join(" ");
}

function stripWrapper(raw: string): string {
  const trailingZh = raw.trim().match(TRAILING_ZH_PROMPT_WRAPPER);
  const source = trailingZh?.[1] ?? raw.replace(LEADING_ZH_PROMPT_WRAPPER, "");
  return cleanText(
    source
      .replace(TARGET_MENTION, " ")
      .replace(META_TR, " ")
      .replace(META_EN, " ")
      .replace(LEADING_PROMPT_WRAPPER, " ")
      .replace(TRAILING_PROMPT_WRAPPER, " ")
      .replace(/\s+([.,;:!?])/g, "$1"),
  )
    .replace(/^[\s,.;:–—-]+/, "")
    .replace(/[\s,.;:–—-]+$/, "");
}

/** Splits on " ve " only after a future-tense verb ("yapacak ve ..."), and on ", and " / "; ". */
export function splitClauses(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  const splitter = /(\p{L}+(?:ecek|acak))\s+ve\s+/u;
  for (let guard = 0; guard < 8; guard++) {
    const match = rest.match(splitter);
    if (!match || match.index === undefined) break;
    const end = match.index + match[1]!.length;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end + match[0].length - match[1]!.length);
  }
  parts.push(rest);
  return parts
    .flatMap((part) => part.split(/\s*(?:;|,\s+and\s+)\s*/i))
    // Chinese clauses do not need spaces. Western punctuation in paths, versions and code remains intact.
    .flatMap((part) => /\p{Script=Han}/u.test(part) ? part.split(/[，。；！？]/u) : [part])
    .map((part) => cleanText(part))
    .filter(Boolean);
}

export interface ExtractedGoal {
  goal: string;
  clauses: string[];
}

export function extractGoal(raw: string): ExtractedGoal {
  const stripped = stripWrapper(raw) || cleanText(raw);
  const clauses = splitClauses(stripped).map(imperativizeClause);
  const goalText = imperativizeClause(
    stripped.replace(/(\p{L}+(?:ecek|acak))(?=\s+ve\s)/gu, (word) => toImperative(word)),
  );
  const capitalized = capitalizeFirst(goalText);
  const goal = /[。！？]$/u.test(capitalized) ? capitalized : ensureSentence(capitalized);
  const requirementClauses = clauses
    .map((clause) =>
      cleanText(clause.replace(PROTECTION_PHRASE, " ").replace(PROTECTION_PHRASE_EN, " ")),
    )
    .filter((clause) => clause.split(" ").length >= 2 || /\p{Script=Han}.*\p{Script=Han}/u.test(clause))
    .map((clause) => capitalizeFirst(clause));
  return { goal, clauses: requirementClauses };
}

export function titleFromGoal(goal: string): string {
  if (/\p{Script=Han}/u.test(goal) && !/\s/u.test(goal)) {
    const title = goal.replace(/[。！？.!?]$/u, "");
    return [...title].length > 32 ? `${[...title].slice(0, 32).join("")}…` : title;
  }
  return truncateWords(goal.replace(/[.!?]$/, ""), 5);
}
