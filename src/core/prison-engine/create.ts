import type { Language, TargetAI } from "@/models/common";
import { DEFAULT_COMPILE_OPTIONS } from "@/models/options";
import type { Prison } from "@/models/prison";
import { newPrisonId } from "./ids";

export interface NewPrisonInput {
  rawRequest: string;
  language: Language;
  targetAI: TargetAI;
  now?: Date;
}

/** A fresh, empty prison in RAW_REQUEST. It owns nothing but the raw request until the intent is parsed. */
export function initPrison({ rawRequest, language, targetAI, now = new Date() }: NewPrisonInput): Prison {
  const at = now.toISOString();
  return {
    id: newPrisonId(),
    title: "",
    createdAt: at,
    updatedAt: at,
    status: "RAW_REQUEST",
    language,
    rawRequest,
    targetAI,
    executionMode: "prompt_generation",
    engine: { mode: "local", provider: "local", model: null },
    intent: null,
    spec: null,
    compileOptions: { ...DEFAULT_COMPILE_OPTIONS },
    taskMemory: [],
    revisions: [],
    promptVersions: [],
    activeVersion: null,
    history: [{ at, from: null, to: "RAW_REQUEST", note: "" }],
    itemSeq: 0,
  };
}
