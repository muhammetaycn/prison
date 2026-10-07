import type { TargetAI } from "@/models/common";
import type { ComposerInput } from "@/ui/lib/composer-draft";
import type { EngineHealthResult } from "@/models/engine-health";
import type { CompileOptions, CouncilMode, ExecutionContext, ModifierAction } from "@/models/options";
import type { ClarificationAnswer, Prison, PrisonSummary } from "@/models/prison";
import type { EngineStatus } from "@/services/ai/config";
import type { CouncilMetadata } from "@/services/ai/council-config";
import type { PrisonOperation } from "@/models/operation";
import type { OperationProgress } from "@/models/operation-progress";

export type CouncilProgress = OperationProgress;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: { status?: number; operation?: PrisonOperation },
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isRetryableApiError(error: unknown): boolean {
  return error instanceof ApiError && (
    error.code === "network" || error.code === "request_timeout" ||
    error.details?.status === 408 || error.details?.status === 429 ||
    (error.details?.status !== undefined && error.details.status >= 500)
  );
}

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const controller = timeoutMs ? new AbortController() : null;
  let timedOut = false;
  const abort = () => controller?.abort();
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs ? setTimeout(() => { timedOut = true; controller!.abort(); }, timeoutMs) : undefined;
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch {
      throw new ApiError(timedOut ? "request_timeout" : "network", "Sunucuya şu anda ulaşılamıyor.");
    }
    const body = (await response.json().catch(() => null)) as
      | (T & { error?: undefined })
      | { error?: { code: string; message: string } }
      | null;
    if (!response.ok) {
      const error = body && "error" in body ? body.error : undefined;
      throw new ApiError(error?.code ?? "http_error", error?.message ?? `İstek başarısız oldu (${response.status}).`, { status: response.status });
    }
    if (!body) throw new ApiError(timedOut ? "request_timeout" : "network", "Sunucu yanıtı alınamadı.");
    return body as T;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const cancelled = () => new ApiError("cancelled", "İşlem takibi kapatıldı.");
  if (signal?.aborted) { reject(cancelled()); return; }
  const abort = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    reject(cancelled());
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", abort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", abort, { once: true });
});
export const OPERATION_POLL_TIMEOUT_MS = 15_000;

/** A temporary offline start must not discard the task URL needed for job recovery. */
export async function getPrisonWithRetry(id: string, signal?: AbortSignal): Promise<{ prison: Prison }> {
  let retryDelay = 2000;
  while (true) {
    try {
      if (signal?.aborted) throw new ApiError("cancelled", "İşlem takibi kapatıldı.");
      return await request<{ prison: Prison }>(`/api/prisons/${id}`, { signal }, OPERATION_POLL_TIMEOUT_MS);
    } catch (error) {
      if (signal?.aborted) throw new ApiError("cancelled", "İşlem takibi kapatıldı.");
      if (!isRetryableApiError(error)) throw error;
      await delay(retryDelay, signal);
      retryDelay = Math.min(retryDelay * 2, 15_000);
    }
  }
}

/** Wait for the durable job, rather than keeping one generation HTTP connection open. */
export async function waitForOperation(initial: PrisonOperation): Promise<{ prison: Prison }> {
  let operation = initial;
  let retryDelay = 2000;
  while (true) {
    if (operation.status === "failed" || operation.status === "interrupted") {
      throw new ApiError(operation.error?.code ?? operation.status, operation.error?.message ?? "İşlem tamamlanamadı. Kaydedilen tartışmayı inceleyip tekrar deneyebilirsin.", { operation });
    }
    try {
      if (operation.status === "completed") {
        return await request<{ prison: Prison }>(`/api/prisons/${operation.prisonId}`, undefined, OPERATION_POLL_TIMEOUT_MS);
      }
      await delay(2000);
      operation = (await request<{ operation: PrisonOperation }>(`/api/operations/${operation.id}`, undefined, OPERATION_POLL_TIMEOUT_MS)).operation;
      retryDelay = 2000;
    } catch (error) {
      if (!isRetryableApiError(error)) throw error;
      // A missing poll response does not mean the server stopped the job.
      await delay(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15_000);
    }
  }
}

type OperationResponse = { prison: Prison } | { accepted: true; operation: PrisonOperation };
async function submitOperation(path: string, body?: unknown): Promise<{ prison: Prison }> {
  const result = await post<OperationResponse>(path, body);
  return "prison" in result ? result : waitForOperation(result.operation);
}

export const api = {
  engine: () => request<{ engine: EngineStatus; council?: CouncilMetadata }>("/api/engine"),
  checkEngine: () => post<{ health: EngineHealthResult }>("/api/engine/check"),
  list: () => request<{ prisons: PrisonSummary[] }>("/api/prisons"),
  get: (id: string, signal?: AbortSignal) => request<{ prison: Prison }>(`/api/prisons/${id}`, { signal }, OPERATION_POLL_TIMEOUT_MS),
  getWithRetry: getPrisonWithRetry,
  operation: (id: string, signal?: AbortSignal) => request<{ operation: PrisonOperation }>(`/api/operations/${id}`, { signal }, OPERATION_POLL_TIMEOUT_MS),
  latestOperation: (id: string, signal?: AbortSignal) => request<{ operation: PrisonOperation | null }>(`/api/prisons/${id}/operation`, { signal }, OPERATION_POLL_TIMEOUT_MS),
  retryOperation: (operationId: string) => submitOperation(`/api/operations/${operationId}/retry`),
  progress: (id: string, signal?: AbortSignal) => request<{ progress: CouncilProgress | null }>(`/api/prisons/${id}/progress`, { signal }),
  create: (input: ComposerInput) =>
    post<{ prison: Prison }>("/api/prisons", input),
  compile: (id: string, options?: Pick<CompileOptions, "executionContext" | "councilMode">) => submitOperation(`/api/prisons/${id}/compile`, options),
  modify: (id: string, action: ModifierAction) => submitOperation(`/api/prisons/${id}/adjust`, { action }),
  retarget: (id: string, target: TargetAI) => submitOperation(`/api/prisons/${id}/adjust`, { target }),
  executionContext: (id: string, executionContext: ExecutionContext) => submitOperation(`/api/prisons/${id}/adjust`, { executionContext }),
  councilMode: (id: string, councilMode: CouncilMode) => submitOperation(`/api/prisons/${id}/adjust`, { councilMode }),
  revise: (id: string, message: string) => submitOperation(`/api/prisons/${id}/revise`, { message }),
  clarify: (id: string, clarifications: ClarificationAnswer[]) => submitOperation(`/api/prisons/${id}/revise`, { clarifications }),
  restore: (id: string, version: number) => post<{ prison: Prison }>(`/api/prisons/${id}/restore`, { version }),
  remove: (id: string) => request<{ ok: true }>(`/api/prisons/${id}`, { method: "DELETE" }),
};
