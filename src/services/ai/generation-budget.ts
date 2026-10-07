import type { EngineInfo } from "@/models/intent";

type ProviderInfo = Pick<EngineInfo, "provider" | "model">;

export function isNvidiaUltra(info: ProviderInfo): boolean {
  return info.provider === "nvidia" && /^nvidia\/nemotron-3-ultra-/.test(info.model ?? "");
}

/** Normalize before generation and retry so truncation grows the budget actually sent. */
export function effectiveMaxTokens(info: ProviderInfo, requested: number): number {
  // This hosted endpoint exposes a 4096-token maximum, including reasoning and final JSON.
  if (info.provider === "nvidia" && info.model === "openai/gpt-oss-20b") return Math.min(requested, 4096);
  return isNvidiaUltra(info) ? Math.max(requested, 8000) : requested;
}
