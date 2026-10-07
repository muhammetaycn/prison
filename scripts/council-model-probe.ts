import { z } from "zod";
import { createProvider } from "@/services/ai/config";
import { DEFAULT_NVIDIA_BASE_URL } from "@/services/ai/deepseek";
import { AIProviderError, kindFromStatus, type AIErrorKind } from "@/services/ai/errors";
import { generateStructured } from "@/services/ai/structured";
import type { LLMProvider } from "@/services/ai/types";

export { DEFAULT_COUNCIL_MODELS } from "@/services/ai/council-config";

type Env = Record<string, string | undefined>;
type ProviderFactory = (model: string, env: Env) => LLMProvider;
export interface ModelProbeResult {
  model: string;
  ok: boolean;
  result: string;
  seconds: number;
}

/** Explicit diagnostics evaluate only the selected endpoints; a configured council needs its quorum. */
export function modelDiagnosticStatus(results: Array<Pick<ModelProbeResult, "ok">>, mode: "catalog" | "explicit" | "council") {
  const ok = results.filter((entry) => entry.ok).length;
  const quorumFailed = mode === "council" && ok < 3;
  return { ok, quorumFailed, exitCode: quorumFailed || (mode === "explicit" && ok < results.length) ? 1 : 0 };
}

const ConnectionSchema = z.object({ ok: z.boolean() });
const CatalogSchema = z.object({ data: z.array(z.object({ id: z.string().trim().min(1).max(160) })).max(5000) });
const FAILURE_LABELS: Record<AIErrorKind, string> = {
  configuration: "yapılandırma geçersiz", auth: "erişim reddedildi", rate_limit: "hız sınırı",
  network: "bağlantı hatası", timeout: "zaman aşımı", unavailable: "sağlayıcı yanıt veremedi",
  bad_request: "model veya istek desteklenmiyor", refusal: "istek reddedildi", truncated: "yanıt yarıda kesildi",
  invalid_output: "tam ve geçerli JSON yanıtı alınamadı", unknown: "kontrol tamamlanamadı",
};

/** Fixed labels only: SDK details, response bodies, endpoints and credentials never become output. */
export function probeFailureLabel(error: unknown): string {
  return FAILURE_LABELS[error instanceof AIProviderError ? error.kind : "unknown"];
}

/** Uses the same provider, model controls, whole-response deadline and validation as council preflight. */
export async function probeCouncilModel(
  model: string, env: Env, timeoutMs: number,
  providerFactory: ProviderFactory = (id, settings) => createProvider({ mode: "ai", provider: "nvidia", model: id }, settings)!,
): Promise<ModelProbeResult> {
  const started = Date.now();
  let ok = false;
  let result: string;
  try {
    const provider = providerFactory(model, env);
    await generateStructured({
      info: provider.info,
      generateJson: (request) => provider.generateJson({ ...request, timeoutMs }),
    }, {
      system: 'You are checking an API connection. Return only the JSON object {"ok":true}.',
      user: 'Confirm this connection check with {"ok":true}.',
      schema: ConnectionSchema, schemaName: "council_preflight", effort: "low", maxTokens: 1024, maxAttempts: 1,
      check: (value) => value.ok === true ? null : "Connection confirmation must be true.",
    });
    ok = true;
    result = "OK — JSON doğrulandı";
  } catch (error) {
    result = probeFailureLabel(error);
  }
  // Includes receiving and validating the complete body or stream, rather than only HTTP headers.
  return { model, ok, result, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
}

/** The deadline covers opening the connection and reading/validating the catalog body. */
export async function listCouncilCatalog(env: Env, timeoutMs = 20000, fetchCatalog: typeof fetch = fetch): Promise<string[]> {
  const key = env.NVIDIA_API_KEY?.trim();
  if (!key) throw new AIProviderError("configuration", "NVIDIA API key is missing.");
  const baseURL = (env.NVIDIA_BASE_URL?.trim() || DEFAULT_NVIDIA_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AIProviderError("timeout", "Catalog deadline expired."));
    }, timeoutMs);
  });
  const readCatalog = async () => {
    const response = await fetchCatalog(`${baseURL}/models`, {
      headers: { authorization: `Bearer ${key}` }, signal: controller.signal,
    });
    if (!response.ok) throw new AIProviderError(kindFromStatus(response.status), "Catalog request failed.");
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new AIProviderError("invalid_output", "Catalog body is not complete JSON."); }
    const parsed = CatalogSchema.safeParse(body);
    if (!parsed.success) throw new AIProviderError("invalid_output", "Catalog schema is invalid.");
    return [...new Set(parsed.data.data.map(({ id }) => id))].sort();
  };
  try {
    return await Promise.race([readCatalog(), expired]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
