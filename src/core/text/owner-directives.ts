import { cleanText, fold } from "./normalize";

// A conservative lexical backstop for explicit prohibitions. Semantic review still handles
// synonyms and more complex scope; this prevents a clear negative instruction becoming positive.
const NEGATIVE = /\b(?:ekleme|eklemeyin|eklenmesin|yapma|yapmayin|yapilmasin|yapilmayacak|olmasin|olmayacak|istemiyorum|zorunlu degil|sart degil|dahil etme|izin verme|do not|don['’]t|never|not required|must not|without)\b/i;
const NEGATIVE_ZH = /不要|禁止|不得|不可|无需|不必|不用|不需要|不允许|不能|不要求|并非必须|不是必须/u;
// "Preserve the design without changing it" must not reject the positive protection
// "preserve the design". Limit automatic topic matching to rejected requirements.
const REJECTED_REQUIREMENT = /\b(?:(?:sart|sarti|sartini|kosul|kosulu|zorunlu)\b.*\b(?:ekleme|eklemeyin|eklenmesin|tutma|degil|istemiyorum)|(?:do not|don['’]t|never)\s+(?:require|impose)|not required)\b/i;
const REJECTED_REQUIREMENT_ZH = /无需|不必|不用|不需要|不要求|(?:不要|禁止|不得|不允许)(?:再)?(?:要求|强制|规定)|(?:不要|禁止|不得).{0,16}(?:添加|增加).{0,16}(?:要求|条件)|(?:不是|并非)(?:必需|必要|必须|强制)/u;
const FILLER = new Set("bir bu ve veya icin ile olarak gore mevcut sadece yalnizca sart sarti sartini zorunlu kosul kosulu ekleme eklemeyin eklenmesin yapma yapmayin yapilmasin yapilmayacak olmasin olmayacak istemiyorum dahil etme izin verme do not don t never required must without the a an to for and or is be add adding make impose require requirement mandatory condition".split(" "));
const CHINESE_FILLER = new Set("不要 禁止 不得 不可 无需 不必 不用 不 需要 要求 必须 强制 条件 规定 添加 增加 请 的 和 与 或 是 在 对 让 将 可以 再 现在 从 开始".split(" "));
const chineseWords = new Intl.Segmenter("zh", { granularity: "word" });

export function isExplicitNegativeDirective(text: string): boolean {
  return NEGATIVE.test(fold(text)) || NEGATIVE_ZH.test(text);
}

/** A critic may clarify a task, but cannot manufacture a grant of permission. */
export function isPermissionExpansionClaim(text: string): boolean {
  return /\b(?:yasaklanmamis|yasaklanmadigi|yasak degil|izin verilmis|izin verildi|izin verilir|serbesttir|yetki verilmis|yetki verildi|not forbidden|not prohibited|is allowed|are allowed|is permitted|are permitted|has been authorized|prior authorization)\b/u.test(fold(text))
    || /\b(?:can|may)\s+(?:publish|deploy|send|upload|execute|delete)\b/u.test(fold(text))
    || /\b(?:yayinlama|paylasim|deploy|gonderme|silme)\s+(?:yapilabilir|serbest|izinli)\b/u.test(fold(text))
    || /已(?:允许|许可|授权)|未被禁止|没有禁止|可以(?:发布|部署|发送|上传|执行|删除)/u.test(text);
}

function topics(text: string): Set<string> {
  const tokens = fold(text).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !FILLER.has(token));
  for (const word of chineseWords.segment(text)) {
    if (word.isWordLike && /\p{Script=Han}/u.test(word.segment) && word.segment.length >= 2 && !CHINESE_FILLER.has(word.segment)) tokens.push(word.segment);
  }
  return new Set(tokens);
}

function matchesTopic(left: Set<string>, right: Set<string>): boolean {
  const shared = [...left].filter((token) => right.has(token)).length;
  if (shared === 1 && left.size === 1 && right.size === 1 && [...left].every((token) => /\p{Script=Han}/u.test(token))) return true;
  return shared >= 2 && shared / Math.min(left.size, right.size) >= 0.75;
}

// A header excluded from the data-row count is still a header. Only guard the
// explicit Markdown/table case; a ban on extra section headings is unrelated.
const TABLE_CONTEXT = /\b(?:markdown|tablo\w*|table)\b|表格/u;
const HEADER_BAN = /\bbaslik(?: satiri)? (?:olma(?:mak|sin|yacak|dan)|bulunma(?:sin|yacak)|icermeyecek)\b|\bbasliksiz (?:markdown )?tablo\w*\b|\b(?:no|without) (?:a |the )?(?:table |column )?headers?\b|\bheaders?(?: row)? (?:must |should |will )?not (?:be )?(?:included|present|added)\b/;
// Removal must name the table's header or begin a clause, rather than target a section/document title.
const HEADER_REMOVAL = /(?:^|[.,;:]\s*|\btablo\w*\s+)(?:basligi(?:ni)?|baslik satirini) (?:atla|kaldir)\b/;
const HEADER_BAN_ZH = /(?:不要|禁止|不得|不含|不包含|没有|删除|去掉|移除|无)(?:添加|包含|保留)?(?:表格的?)?(?:表头|标题行)|(?:表头|标题行)(?:不要|不需要|删除|去掉)/u;
const hasHeaderBan = (text: string): boolean => HEADER_BAN.test(text) || HEADER_REMOVAL.test(text) || HEADER_BAN_ZH.test(text);
const HEADER_EXCLUDED_FROM_COUNT = /\bbaslik(?: satiri)? (?:haric|disinda)\b|\b(?:excluding|excepting|not counting)(?: the)? (?:table |column )?header(?: row)?\b|除(?:表头|标题行)(?:以)?外|不(?:包括|计|算)(?:表头|标题行)/u;

function conflictingTableHeaderQuote(text: string, clauses: readonly string[]): string | null {
  const candidate = fold(text);
  if (!TABLE_CONTEXT.test(candidate) && !/\b(?:baslik satiri(?:ni)?|header row)\b|表头|标题行/u.test(candidate)) return null;
  if (!hasHeaderBan(candidate)) return null;
  for (let index = clauses.length - 1; index >= 0; index--) {
    const quote = clauses[index]!;
    const owner = fold(quote);
    // A newer explicit header ban is a real change of the owner's preference.
    if (hasHeaderBan(owner)) return null;
    // A newer explicit format change ends this Markdown-specific guard.
    if (/(?:\b(?:cikti|output|return|format)\b|输出|返回|格式).*\b(?:json|csv)\b/u.test(owner)) return null;
    if (/\bmarkdown\b/.test(owner) && /\b(?:tablo\w*|table)\b|表格/u.test(owner) && HEADER_EXCLUDED_FROM_COUNT.test(owner)) return quote;
  }
  return null;
}

/** Only near-identical topics with an unambiguous owner prohibition qualify. */
export function conflictingOwnerQuote(text: string, ownerTexts: readonly string[]): string | null {
  const clauses = ownerTexts.flatMap((text) => text.split(/(?<=[。！？；])|(?<=[.!?;])\s+|\n+/u)).map(cleanText);
  const headerConflict = conflictingTableHeaderQuote(text, clauses);
  if (headerConflict) return headerConflict;
  if (isExplicitNegativeDirective(text)) return null;
  const candidate = topics(text);
  for (let index = clauses.length - 1; index >= 0; index--) {
    const quote = clauses[index]!;
    if (!isExplicitNegativeDirective(quote)) continue;
    if (!REJECTED_REQUIREMENT.test(fold(quote)) && !REJECTED_REQUIREMENT_ZH.test(quote)) continue;
    const forbidden = topics(quote);
    const explicitlySuperseded = clauses.slice(index + 1).some((later) => !isExplicitNegativeDirective(later)
      && /\b(?:zorunlu|sart|require|impose|mandatory|must)\b|要求|必须|强制/u.test(fold(later)) && matchesTopic(forbidden, topics(later)));
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
