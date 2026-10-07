import type { ResolvedPrison } from "@/models/prison";
import { analyzeIntent, type IntentInput } from "@/core/intent-engine";
import { titleFromGoal } from "@/core/intent-engine/local/goal";
import { initPrison } from "@/core/prison-engine/create";
import { transition } from "@/core/prison-engine/state-machine";
import { resolveRequirements } from "@/core/requirement-resolver";
import { readJailbreakModeRequest } from "@/core/prison-engine/jailbreak-mode";
import type { LLMProvider } from "@/services/ai/types";
import type { CouncilMode, ExecutionContext } from "@/models/options";

export interface AnalysisInput extends IntentInput {
  jailbreakMode?: boolean;
  executionContext?: ExecutionContext;
  councilMode?: CouncilMode;
}

/**
 * RAW_REQUEST → INTENT_PARSED → PRISON_CREATED → REQUIREMENTS_RESOLVED → READY_FOR_COMPILE
 *
 * Creates a brand-new, isolated prison for one request. Nothing from other prisons is read.
 */
export async function runAnalysisPipeline(
  input: AnalysisInput,
  provider: LLMProvider | null,
  now: () => Date = () => new Date(),
): Promise<ResolvedPrison> {
  let prison = initPrison({ ...input, now: now() });

  const { intent, engine } = await analyzeIntent(input, provider);

  prison = {
    ...prison,
    compileOptions: {
      ...prison.compileOptions,
      jailbreakMode: input.jailbreakMode ?? readJailbreakModeRequest(input.rawRequest) ?? false,
      executionContext: input.executionContext ?? "chat",
      agentMode: input.executionContext === "agent",
      councilMode: input.councilMode ?? "competition",
    },
  };

  prison = transition(
    { ...prison, intent, engine },
    "INTENT_PARSED",
    engine.mode === "ai" ? `${engine.provider}/${engine.model}` : "local",
    now(),
  );
  prison = transition(prison, "PRISON_CREATED", prison.id, now());

  const { spec, itemSeq } = resolveRequirements({ intent, language: input.language, itemSeq: prison.itemSeq });
  prison = transition(
    { ...prison, spec, itemSeq, title: intent.title || titleFromGoal(spec.primaryGoal) },
    "REQUIREMENTS_RESOLVED",
    "",
    now(),
  );
  prison = transition(prison, "READY_FOR_COMPILE", "", now());
  return prison as ResolvedPrison;
}
