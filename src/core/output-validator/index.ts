import type { CompiledPrompt } from "@/core/prompt-compiler";

export const MAX_PROMPT_CHARS = 40000;

/** Template placeholders the compiler fills. Any that survive into the output are a compiler bug. */
const UNRESOLVED_PLACEHOLDER = /\{(role|format|goal|tech|domain|language|catalog)\}/;
/** "[object Object]" anywhere, or a line / list item consisting only of undefined, null or NaN. */
const SERIALIZATION_ARTIFACT = /\[object Object\]|(^|\n)(- |\d+\. )?(undefined|null|NaN)[ \t]*(?=\n|$)/;

export interface OutputValidation {
  ok: boolean;
  problems: string[];
}

/** Structural validation of a compiled prompt, independent of the target model. */
export function validateOutput(compiled: CompiledPrompt): OutputValidation {
  const problems: string[] = [];
  const text = compiled.text;

  if (!text.trim()) problems.push("Derlenen prompt boş.");
  if (!compiled.blocks.some((b) => b.id === "OBJECTIVE")) problems.push("Promptta amaç (OBJECTIVE) bölümü yok.");
  if (text.length > MAX_PROMPT_CHARS) problems.push(`Prompt çok uzun (${text.length} karakter).`);
  if (UNRESOLVED_PLACEHOLDER.test(text)) problems.push("Promptta doldurulmamış şablon alanı kaldı.");
  if (SERIALIZATION_ARTIFACT.test(text)) problems.push("Promptta serileştirme artığı var (undefined/[object Object]).");
  for (const block of compiled.blocks) {
    if (block.items?.some((item) => !item.trim())) problems.push(`${block.id} bölümünde boş madde var.`);
  }
  return { ok: problems.length === 0, problems };
}
