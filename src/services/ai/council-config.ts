import { createProvider, type EngineStatus } from "./config";
import { AIProviderError } from "./errors";
import type { LLMProvider } from "./types";

export interface CouncilMember {
  id: string;
  role: string;
  provider: LLMProvider;
}

export interface CouncilDeps {
  members: CouncilMember[];
  /** Review the owner-grounded task contract before any council deliberation. Production enables this. */
  verifySource?: boolean;
  /** Ordered stand-ins. When present, members are probed first and an unreachable one is replaced. */
  reserves?: LLMProvider[];
  /** Check user-selected members on a bounded call even when no substitute models are configured. */
  probeSelected?: boolean;
  /** How thoroughly the table deliberates; absent means the original single round. */
  depth?: CouncilDepth;
}

/**
 * Deliberation depth. Deep (the configured default) investigates first, fights at least three rounds,
 * lets table members learn from each other and polishes the shared prompt for at least two rounds.
 */
export interface CouncilDepth {
  /** Every member investigates the task from its specialty before anyone drafts; notes are shared. */
  research: boolean;
  minBattleRounds: number;
  maxBattleRounds: number;
  /** Round table: members improve their own proposals with the discussion before the scribe merges. */
  learning: boolean;
  minConsensusRounds: number;
  maxConsensusRounds: number;
  /** Keep improving while reviewers still report medium issues (up to the maximum rounds). */
  polish: boolean;
  /** Per-call budget. Deep prompts carry shared notes and take longer on busy hosted endpoints. */
  callTimeoutMs: number;
  /** Give members whose first draft hit a transient failure one more pass. */
  retryDrafts: boolean;
}

export const QUICK_DEPTH: CouncilDepth = {
  research: false, minBattleRounds: 1, maxBattleRounds: 1, learning: false, minConsensusRounds: 1, maxConsensusRounds: 3, polish: false,
  callTimeoutMs: 90000, retryDrafts: false,
};
export const DEEP_DEPTH: CouncilDepth = {
  research: true, minBattleRounds: 3, maxBattleRounds: 5, learning: true, minConsensusRounds: 2, maxConsensusRounds: 4, polish: true,
  callTimeoutMs: 150000, retryDrafts: true,
};

export interface CouncilMetadata {
  enabled: boolean;
  models: Array<{ id: string; provider: string; model: string | null; role: string }>;
  /** A valid primary can remain available while optional team configuration needs repair. */
  configurationError?: string;
}

/**
 * NVIDIA's distinct hosted model IDs; activation still requires explicit configuration.
 * Chosen from a live 2026-10-04 probe: GLM-5.3, DeepSeek v4.1, Kimi K3 and Gemma 4 timed out
 * repeatedly, and many catalog entries return 404 for ordinary accounts.
 */
export const DEFAULT_COUNCIL_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-super-120b-a12b",
  "openai/gpt-oss-20b",
  "meta/muse-glimmer-30b",
  "meta/llama-3.2-90b-vision-instruct",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
] as const;

/** Tried in order only when a member fails the pre-council probe; overlaps with members are skipped. */
export const DEFAULT_COUNCIL_RESERVE_MODELS = [
  "poolside/laguna-xs-2.1",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "deepseek-ai/deepseek-v4.1-flash",
  "z-ai/glm-5.3",
  "moonshotai/kimi-k3",
  "google/gemma-4-31b-it",
] as const;

const MEMBER_ROLES = [
  "Amaç ve kullanıcı sınırları uzmanı",
  "Uygulama planı uzmanı",
  "Prompt yapısı uzmanı",
  "Alternatif yaklaşım uzmanı",
  "Çıktı kalitesi uzmanı",
  "Bağımsız eleştirmen",
] as const;

type Env = Record<string, string | undefined>;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;

function configurationError(detail: string): never {
  throw new AIProviderError("configuration", detail);
}

/** Creates separate NVIDIA model clients using the existing credential/endpoint rules. */
export function createCouncil(engine: EngineStatus, env: Env = process.env): CouncilDeps | null {
  const mode = env.PRISON_COUNCIL_MODE?.trim().toLowerCase() || "off";
  if (mode !== "off" && mode !== "enabled") {
    configurationError("PRISON_COUNCIL_MODE must be off or enabled.");
  }
  if (mode === "off") return null;
  if (engine.mode !== "ai" || engine.provider !== "nvidia") {
    configurationError("An enabled council requires a configured NVIDIA engine.");
  }

  const configuredModels = env.PRISON_COUNCIL_MODELS?.trim();
  const models = configuredModels ? configuredModels.split(",").map((model) => model.trim()) : [...DEFAULT_COUNCIL_MODELS];
  if (models.length < 3 || models.length > 6) {
    configurationError("PRISON_COUNCIL_MODELS must contain 3 to 6 distinct NVIDIA model IDs.");
  }
  if (models.some((model) => model.length > 160 || !MODEL_ID.test(model))) {
    configurationError("Each council model must be a nonempty publisher/model ID.");
  }
  if (new Set(models.map((model) => model.toLowerCase())).size !== models.length) {
    configurationError("Council model IDs must be distinct; repeated personas do not count as different models.");
  }

  const reserves = reserveModels(env, models);
  const depth = env.PRISON_COUNCIL_DEPTH?.trim().toLowerCase() || "deep";
  if (depth !== "deep" && depth !== "quick") configurationError("PRISON_COUNCIL_DEPTH must be deep or quick.");
  return {
    verifySource: true,
    depth: depth === "deep" ? DEEP_DEPTH : QUICK_DEPTH,
    members: models.map((model, index) => ({
      id: `member_${index + 1}`,
      role: MEMBER_ROLES[index],
      provider: createProvider({ mode: "ai", provider: "nvidia", model }, env)!,
    })),
    reserves: reserves.map((model) => createProvider({ mode: "ai", provider: "nvidia", model }, env)!),
  };
}

/** "none" disables reserves (and the probe). An explicit list must not repeat itself or a member. */
function reserveModels(env: Env, members: string[]): string[] {
  const memberKeys = new Set(members.map((model) => model.toLowerCase()));
  const configured = env.PRISON_COUNCIL_RESERVE_MODELS?.trim();
  if (!configured) return DEFAULT_COUNCIL_RESERVE_MODELS.filter((model) => !memberKeys.has(model.toLowerCase()));
  if (configured.toLowerCase() === "none") return [];
  const reserves = configured.split(",").map((model) => model.trim());
  if (reserves.length > 6) configurationError("PRISON_COUNCIL_RESERVE_MODELS may contain at most 6 model IDs.");
  if (reserves.some((model) => model.length > 160 || !MODEL_ID.test(model))) {
    configurationError("Each council reserve must be a nonempty publisher/model ID.");
  }
  const keys = reserves.map((model) => model.toLowerCase());
  if (new Set(keys).size !== keys.length || keys.some((key) => memberKeys.has(key))) {
    configurationError("Council reserves must be distinct from each other and from the council models.");
  }
  return reserves;
}

/** Public status deliberately excludes provider instances, keys and endpoint details. */
export function describeCouncil(council: CouncilDeps | null | undefined, configurationError?: string | null): CouncilMetadata {
  return {
    enabled: Boolean(council),
    models: council?.members.map(({ id, role, provider }) => ({
      id, role, provider: provider.info.provider, model: provider.info.model,
    })) ?? [],
    ...(configurationError ? { configurationError } : {}),
  };
}
