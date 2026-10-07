import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import {
  DeepSeekProvider, NvidiaProvider, OpenAICompatibleProvider, DEFAULT_DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_NVIDIA_MODEL, DEFAULT_NVIDIA_BASE_URL,
} from "./deepseek";
import { AIProviderError } from "./errors";
import { DEFAULT_OPENAI_MODEL, OpenAIProvider } from "./openai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "./types";

export type ProviderName = "nvidia" | "deepseek" | "anthropic" | "openai" | "compatible";
export type EngineStatus =
  | { mode: "ai"; provider: ProviderName; model: string }
  | { mode: "local"; provider: "local"; model: null; reason: "no_key" | "forced" };

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function usesLegacyNvidiaConfig(env: Env): boolean {
  return Boolean(value(env, "PRISON_MODEL")?.startsWith("nvidia/") ||
    value(env, "DEEPSEEK_BASE_URL")?.includes("integrate.api.nvidia.com"));
}

export function providerKey(provider: ProviderName, env: Env): string | undefined {
  if (provider === "compatible") return undefined;
  if (provider === "nvidia") {
    return value(env, "NVIDIA_API_KEY") || (usesLegacyNvidiaConfig(env) ? value(env, "DEEPSEEK_API_KEY") : undefined);
  }
  if (provider === "deepseek") return value(env, "DEEPSEEK_API_KEY");
  if (provider === "anthropic") return value(env, "ANTHROPIC_API_KEY") || value(env, "ANTHROPIC_AUTH_TOKEN");
  return value(env, "OPENAI_API_KEY");
}

/** Explicit choices require a key. Without an override, prefer NVIDIA, DeepSeek, Claude, then OpenAI. */
export function resolveEngineStatus(env: Env = process.env): EngineStatus {
  const forced = value(env, "PRISON_PROVIDER")?.toLowerCase();
  const model = value(env, "PRISON_MODEL");
  if (forced === "local") return { mode: "local", provider: "local", model: null, reason: "forced" };
  if (forced && !["nvidia", "deepseek", "anthropic", "openai"].includes(forced)) {
    throw new AIProviderError("configuration", "PRISON_PROVIDER must be nvidia, deepseek, anthropic, openai or local.");
  }

  // Earlier PRISON versions named the NVIDIA adapter "deepseek"; keep those model/key settings working.
  const explicit = forced === "deepseek" && usesLegacyNvidiaConfig(env) ? "nvidia" : forced as ProviderName | undefined;
  const provider = explicit ?? (["nvidia", "deepseek", "anthropic", "openai"] as const).find((name) => providerKey(name, env));
  if (!provider) return { mode: "local", provider: "local", model: null, reason: "no_key" };
  if (!providerKey(provider, env)) throw new AIProviderError("configuration", `${provider} API key is missing.`);

  const defaults: Record<Exclude<ProviderName, "compatible">, string> = {
    nvidia: DEFAULT_NVIDIA_MODEL, deepseek: DEFAULT_DEEPSEEK_MODEL,
    anthropic: DEFAULT_ANTHROPIC_MODEL, openai: DEFAULT_OPENAI_MODEL,
  };
  return { mode: "ai", provider, model: model ?? defaults[provider as Exclude<ProviderName, "compatible">] };
}

export function createProvider(status: EngineStatus, env: Env = process.env): LLMProvider | null {
  if (status.mode === "local") return null;
  const apiKey = providerKey(status.provider, env);
  if (!apiKey) throw new AIProviderError("configuration", `${status.provider} API key is missing.`);
  if (status.provider === "nvidia") {
    const baseURL = value(env, "NVIDIA_BASE_URL") || (usesLegacyNvidiaConfig(env) ? value(env, "DEEPSEEK_BASE_URL") : undefined);
    return new NvidiaProvider(status.model, apiKey, baseURL ?? DEFAULT_NVIDIA_BASE_URL);
  }
  if (status.provider === "deepseek") {
    return new DeepSeekProvider(status.model, apiKey, value(env, "DEEPSEEK_BASE_URL") ?? DEFAULT_DEEPSEEK_BASE_URL);
  }
  if (status.provider === "anthropic") {
    const options = value(env, "ANTHROPIC_API_KEY") ? { apiKey, authToken: null } : { apiKey: null, authToken: apiKey };
    return new AnthropicProvider(status.model, new Anthropic({ ...options, baseURL: value(env, "ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com" }));
  }
  return new OpenAIProvider(status.model, new OpenAI({ apiKey, baseURL: value(env, "OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    organization: value(env, "OPENAI_ORG_ID") ?? null, project: value(env, "OPENAI_PROJECT_ID") ?? null }));
}

/** An immutable client for one saved profile; SDKs never fall back to another profile's environment key. */
export function createCredentialedProvider(provider: ProviderName, model: string, apiKey: string, baseURL: string): LLMProvider {
  if (!apiKey.trim()) throw new AIProviderError("configuration", "The selected profile has no credential.");
  if (provider === "nvidia") return new NvidiaProvider(model, apiKey, baseURL);
  if (provider === "deepseek") return new DeepSeekProvider(model, apiKey, baseURL);
  if (provider === "compatible") return new OpenAICompatibleProvider(model, apiKey, baseURL);
  if (provider === "anthropic") return new AnthropicProvider(model, new Anthropic({ apiKey, authToken: null, baseURL }));
  return new OpenAIProvider(model, new OpenAI({ apiKey, baseURL, organization: null, project: null }));
}
