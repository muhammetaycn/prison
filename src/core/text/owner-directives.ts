import { cleanText, fold } from "./normalize";

// A conservative lexical backstop for explicit prohibitions. Semantic review still handles
// synonyms and more complex scope; this prevents a clear negative instruction becoming positive.
const NEGATIVE = /\b(?:ekleme|eklemeyin|eklenmesin|yapma|yapmayin|yapilmasin|yapilmayacak|olmasin|olmayacak|istemiyorum|zorunlu degil|sart degil|dahil etme|izin verme|do not|don['’]t|never|not required|must not|without)\b/i;
// "Preserve the design without changing it" must not reject the positive protection
// "preserve the design". Limit automatic topic matching to rejected requirements.
const REJECTED_REQUIREMENT = /\b(?:(?:sart|sarti|sartini|kosul|kosulu|zorunlu)\b.*\b(?:ekleme|eklemeyin|eklenmesin|tutma|degil|istemiyorum)|(?:do not|don['’]t|never)\s+(?:require|impose)|not required)\b/i;
const FILLER = new Set("bir bu ve veya icin ile olarak gore mevcut sadece yalnizca sart sarti sartini zorunlu kosul kosulu ekleme eklemeyin eklenmesin yapma yapmayin yapilmasin yapilmayacak olmasin olmayacak istemiyorum dahil etme izin verme do not don t never required must without the a an to for and or is be add adding make impose require requirement mandatory condition".split(" "));

export function isExplicitNegativeDirective(text: string): boolean {
  return NEGATIVE.test(fold(text));
}

/** A critic may clarify a task, but cannot manufacture a grant of permission. */
export function isPermissionExpansionClaim(text: string): boolean {
  return /\b(?:yasaklanmamis|yasaklanmadigi|yasak degil|izin verilmis|izin verildi|izin verilir|serbesttir|yetki verilmis|yetki verildi|not forbidden|not prohibited|is allowed|are allowed|is permitted|are permitted|has been authorized|prior authorization)\b/u.test(fold(text))
    || /\b(?:can|may)\s+(?:publish|deploy|send|upload|execute|delete)\b/u.test(fold(text))
    || /\b(?:yayinlama|paylasim|deploy|gonderme|silme)\s+(?:yapilabilir|serbest|izinli)\b/u.test(fold(text));
}

function topics(text: string): Set<string> {
  return new Set(fold(text).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !FILLER.has(token)));
}

function matchesTopic(left: Set<string>, right: Set<string>): boolean {
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared >= 2 && shared / Math.min(left.size, right.size) >= 0.75;
}

// A header excluded from the data-row count is still a header. Only guard the
// explicit Markdown/table case; a ban on extra section headings is unrelated.
const TABLE_CONTEXT = /\b(?:markdown|tablo\w*|table)\b/;
const HEADER_BAN = /\bbaslik(?: satiri)? (?:olma(?:mak|sin|yacak|dan)|bulunma(?:sin|yacak)|icermeyecek)\b|\bbasliksiz (?:markdown )?tablo\w*\b|\b(?:no|without) (?:a |the )?(?:table |column )?headers?\b|\bheaders?(?: row)? (?:must |should |will )?not (?:be )?(?:included|present|added)\b/;
// Removal must name the table's header or begin a clause, rather than target a section/document title.
const HEADER_REMOVAL = /(?:^|[.,;:]\s*|\btablo\w*\s+)(?:basligi(?:ni)?|baslik satirini) (?:atla|kaldir)\b/;
const hasHeaderBan = (text: string): boolean => HEADER_BAN.test(text) || HEADER_REMOVAL.test(text);
const HEADER_EXCLUDED_FROM_COUNT = /\bbaslik(?: satiri)? (?:haric|disinda)\b|\b(?:excluding|excepting|not counting)(?: the)? (?:table |column )?header(?: row)?\b/;

function conflictingTableHeaderQuote(text: string, clauses: readonly string[]): string | null {
  const candidate = fold(text);
  if (!TABLE_CONTEXT.test(candidate) && !/\b(?:baslik satiri(?:ni)?|header row)\b/.test(candidate)) return null;
  if (!hasHeaderBan(candidate)) return null;
  for (let index = clauses.length - 1; index >= 0; index--) {
    const quote = clauses[index]!;
    const owner = fold(quote);
    // A newer explicit header ban is a real change of the owner's preference.
    if (hasHeaderBan(owner)) return null;
    // A newer explicit format change ends this Markdown-specific guard.
    if (/\b(?:cikti|output|return|format)\b.*\b(?:json|csv)\b/.test(owner)) return null;
    if (/\bmarkdown\b/.test(owner) && /\b(?:tablo\w*|table)\b/.test(owner) && HEADER_EXCLUDED_FROM_COUNT.test(owner)) return quote;
  }
  return null;
}

/** Only near-identical topics with an unambiguous owner prohibition qualify. */
export function conflictingOwnerQuote(text: string, ownerTexts: readonly string[]): string | null {
  const clauses = ownerTexts.flatMap((text) => text.split(/(?<=[.!?;])\s+|\n+/u)).map(cleanText);
  const headerConflict = conflictingTableHeaderQuote(text, clauses);
  if (headerConflict) return headerConflict;
  if (isExplicitNegativeDirective(text)) return null;
  const candidate = topics(text);
  for (let index = clauses.length - 1; index >= 0; index--) {
    const quote = clauses[index]!;
    if (!isExplicitNegativeDirective(quote)) continue;
    if (!REJECTED_REQUIREMENT.test(fold(quote))) continue;
    const forbidden = topics(quote);
    const explicitlySuperseded = clauses.slice(index + 1).some((later) => !isExplicitNegativeDirective(later)
      && /\b(?:zorunlu|sart|require|impose|mandatory|must)\b/.test(fold(later)) && matchesTopic(forbidden, topics(later)));
    if (!explicitlySuperseded && matchesTopic(forbidden, candidate)) return quote;
  }
  return null;
}

export function checkOwnerPolarity(texts: readonly string[], ownerTexts: readonly string[]): string | null {
  for (const text of texts) {
    const quote = conflictingOwnerQuote(text, ownerTexts);
    if (quote) return `Respect the owner's actual instruction: ${quote} Do not impose a conflicting requirement, fact, step or success criterion: ${text}`;
  }
  return null;
}
