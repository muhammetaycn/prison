import type { Language, TargetAI } from "@/models/common";
import type { EngineInfo, IntentAnalysis } from "@/models/intent";

export interface IntentInput {
  rawRequest: string;
  language: Language;
  targetAI: TargetAI;
}

export interface IntentResult {
  intent: IntentAnalysis;
  engine: EngineInfo;
}
