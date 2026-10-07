import { z } from "zod";
import { LanguageSchema, TargetAISchema, type Language, type TargetAI } from "@/models/common";
import { CouncilModeSchema, ExecutionContextSchema, type CouncilMode, type ExecutionContext } from "@/models/options";

export const COMPOSER_DRAFT_KEY = "prison:composer-draft:v1";
export const COMPOSER_TEXT_LIMIT = 8000;
export const PROMPT_MODES = ["auto", "standard", "jb"] as const;
export type PromptMode = (typeof PROMPT_MODES)[number];

const ComposerDraftSchema = z.object({
  text: z.string().max(COMPOSER_TEXT_LIMIT),
  target: TargetAISchema,
  language: LanguageSchema,
  mode: z.enum(PROMPT_MODES),
  executionContext: ExecutionContextSchema.default("chat"),
  councilMode: CouncilModeSchema.default("competition"),
}).strict();
export type ComposerDraft = z.infer<typeof ComposerDraftSchema>;

export const DEFAULT_COMPOSER_DRAFT: Readonly<ComposerDraft> = {
  text: "",
  target: "auto",
  language: "tr",
  mode: "auto",
  executionContext: "chat",
  councilMode: "competition",
};

export interface ComposerInput {
  rawRequest: string;
  targetAI: TargetAI;
  language: Language;
  jailbreakMode?: boolean;
  executionContext?: ExecutionContext;
  councilMode?: CouncilMode;
}

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function toComposerInput(draft: ComposerDraft): ComposerInput {
  return {
    rawRequest: draft.text.trim(),
    targetAI: draft.target,
    language: draft.language,
    executionContext: draft.executionContext,
    councilMode: draft.councilMode,
    ...(draft.mode === "auto" ? {} : { jailbreakMode: draft.mode === "jb" }),
  };
}

/** Acquiring browser storage can itself fail when storage is blocked. */
export function getComposerDraftStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readComposerDraft(storage: DraftStorage | null): ComposerDraft {
  try {
    const raw = storage?.getItem(COMPOSER_DRAFT_KEY);
    if (raw) {
      const parsed = ComposerDraftSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // An unreadable or malformed draft must never block the composer.
  }
  return { ...DEFAULT_COMPOSER_DRAFT };
}

export function saveComposerDraft(storage: DraftStorage | null, draft: ComposerDraft): boolean {
  if (!storage) return false;
  const validated = ComposerDraftSchema.safeParse(draft);
  if (!validated.success) return false;
  try {
    storage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify(validated.data));
    return true;
  } catch {
    return false;
  }
}

/** Called only after the server has successfully saved the analyzed request. */
export function clearComposerDraft(storage: DraftStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(COMPOSER_DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}
