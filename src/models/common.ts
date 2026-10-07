import { z } from "zod";

/** Language the prison state and the compiled prompt are written in: English, Turkish or Simplified Chinese. */
export const LANGUAGES = ["en", "tr", "zh"] as const;
export const LanguageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof LanguageSchema>;

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  tr: "Turkish",
  zh: "Simplified Chinese",
};

/** Target selector value. AUTO lets the adapter resolver pick the best prompt style. */
export const TARGET_AIS = ["auto", "gpt", "claude", "gemini", "codex"] as const;
export const TargetAISchema = z.enum(TARGET_AIS);
export type TargetAI = z.infer<typeof TargetAISchema>;

export const CONCRETE_TARGETS = ["gpt", "claude", "gemini", "codex"] as const;
export const ConcreteTargetSchema = z.enum(CONCRETE_TARGETS);
export type ConcreteTarget = z.infer<typeof ConcreteTargetSchema>;

/** A piece of template text available in every supported language. */
export type Localized = Record<Language, string>;
