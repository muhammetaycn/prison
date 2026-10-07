import type { Prison } from "@/models/prison";
import type { PrisonOperation } from "@/models/operation";
import { ApiError, isRetryableApiError, type CouncilProgress } from "./api";

export type OperationWatchPhase = "discovering" | "running" | "refreshing" | "idle";

interface OperationWatchOptions {
  id: string;
  /** The local mutation waiter owns completion; the observer retains its durable evidence. */
  local: boolean;
  readOperation: (id: string, signal: AbortSignal) => Promise<{ operation: PrisonOperation | null }>;
  readPrison: (id: string, signal: AbortSignal) => Promise<{ prison: Prison }>;
  onPhase: (phase: OperationWatchPhase) => void;
  onProgress: (progress: CouncilProgress | null) => void;
  onOperation: (operation: PrisonOperation | null) => void;
  onCompleted: (prison: Prison) => void;
  onError?: (error: unknown) => void;
}

export interface OperationProgressWatch {
  canMutate: () => boolean;
  stop: () => void;
}

/** Recover a job after reload, including a finished result or a persisted failure. */
export function watchOperationProgress(options: OperationWatchOptions): OperationProgressWatch {
  const controller = new AbortController();
  let stopped = false;
  let seenId: string | null = null;
  let phase: OperationWatchPhase = "discovering";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 2000;
  let terminal: PrisonOperation | null = null;
  const setPhase = (next: OperationWatchPhase) => {
    phase = next;
    options.onPhase(next);
  };
  const schedule = (delay = 2000) => { timer = setTimeout(() => { timer = undefined; void poll(); }, delay); };

  const poll = async () => {
    try {
      const operation = terminal ?? (await options.readOperation(options.id, controller.signal)).operation;
      if (stopped) return;
      if (!operation && seenId) {
        // A previously observed job needs an explicit terminal state, never an empty read.
        schedule();
        return;
      }
      if (operation?.status !== "completed") retryDelay = 2000;
      const active = operation?.status === "queued" || operation?.status === "running";
      if (active) seenId = operation.id;
      // A previous finished job can be returned before a new local submission is accepted.
      if (options.local && !active && operation?.id !== seenId) {
        setPhase("running");
        schedule();
        return;
      }
      options.onOperation(operation);
      options.onProgress(operation?.progress ?? null);
      if (active || (!operation && options.local)) {
        setPhase("running");
        schedule();
        return;
      }
      if (operation?.status === "completed" && !options.local) {
        terminal = operation;
        setPhase("refreshing");
        const { prison } = await options.readPrison(options.id, controller.signal);
        if (stopped) return;
        options.onCompleted(prison);
        retryDelay = 2000;
      }
      // Failed/interrupted jobs stay visible through onOperation/onProgress. They are retryable.
      setPhase("idle");
    } catch (error) {
      if (stopped) return;
      if (error instanceof ApiError && error.code === "not_found") {
        options.onOperation(null);
        options.onProgress(null);
        options.onError?.(error);
        setPhase("idle");
      } else if (isRetryableApiError(error)) {
        // Keep discovery locked too: losing contact is not proof no job exists.
        schedule(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15_000);
      } else {
        options.onError?.(error);
        setPhase("idle");
      }
    }
  };

  options.onPhase(phase);
  void poll();
  return {
    canMutate: () => !stopped && phase === "idle",
    stop: () => {
      stopped = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
