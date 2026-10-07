import { z } from "zod";
import type { EngineHealthResult } from "@/models/engine-health";
import type { EngineStatus } from "./config";
import { AIProviderError } from "./errors";
import { generateStructured } from "./structured";
import type { LLMProvider } from "./types";

const ConnectivitySchema = z.object({ ok: z.boolean() });

/** Verifies a tiny, task-neutral structured response without creating or changing a prison. */
export async function checkEngineConnection(engine: EngineStatus, provider: LLMProvider | null): Promise<EngineHealthResult> {
  const startedAt = performance.now();
  const result = (status: EngineHealthResult["status"], message: string): EngineHealthResult => ({
    status,
    provider: engine.provider,
    model: engine.model,
    checkedAt: new Date().toISOString(),
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    message,
  });

  if (engine.mode === "local") {
    return result("local", "Yerel motor hazır. API bağlantısı kullanılmıyor.");
  }

  try {
    if (!provider) throw new AIProviderError("configuration", "The selected AI engine has no provider.");
    await generateStructured(provider, {
      system: "You are checking an API connection. Return only the JSON object {\"ok\":true}.",
      user: "Confirm this connection check with {\"ok\":true}.",
      schema: ConnectivitySchema,
      schemaName: "engine_connection_check",
      effort: "low",
      maxTokens: 512,
      maxAttempts: 1,
      check: (value) => value.ok === true ? null : "Connection confirmation must be true.",
    });
    return result("connected", "API bağlantısı doğrulandı. Seçili model geçerli yanıt verdi.");
  } catch (error) {
    const kind = error instanceof AIProviderError ? error.kind : "unknown";
    // Use the fixed user message, never the raw provider response, SDK error or technical detail.
    const message = new AIProviderError(kind, "Connection check failed.").message;
    return { ...result("error", message), errorKind: kind };
  }
}

/** One in-flight probe per runtime: repeated clicks share the result and do not duplicate API calls. */
export function createEngineConnectionCheck(engine: EngineStatus, provider: LLMProvider | null): () => Promise<EngineHealthResult> {
  let inFlight: Promise<EngineHealthResult> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = checkEngineConnection(engine, provider).finally(() => { inFlight = null; });
    }
    return inFlight;
  };
}
