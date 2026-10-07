import type { Language, TargetAI } from "@/models/common";
import { ClarificationAnswerSchema, isResolved, type ClarificationAnswer, type Prison, type PrisonSummary, type ResolvedPrison } from "@/models/prison";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline, type PipelineDeps } from "@/core/pipeline/compile";
import { restoreVersion, runAdjustmentPipeline, runRevisionPipeline, type Adjustment } from "@/core/pipeline/revise";
import { isIdle, transition } from "@/core/prison-engine/state-machine";
import { AIProviderError } from "./ai/errors";
import type { LLMProvider } from "./ai/types";
import type { CouncilDeps } from "./ai/council-config";
import { CouncilModeSchema, ExecutionContextSchema, type CouncilMode, type ExecutionContext } from "@/models/options";
import type { OperationProgress, ProgressUpdate } from "@/models/operation-progress";
import type { CouncilEvent } from "@/models/council";
import { compactCouncilEvents } from "@/models/council-events";
import { AppError } from "./errors";
import { StorageError, type PrisonRepository } from "./storage/repository";
import { KeyedLock } from "./storage/lock";
import type { CouncilCheckpointRepository } from "./storage/council-checkpoint-repository";

export const REQUEST_LIMITS = { min: 3, max: 8000 } as const;
export const REVISION_LIMITS = { min: 2, max: 2000 } as const;

/** Process-local coordination only; providers and saved prison data do not belong here. */
export interface PrisonOperationState {
  lock: KeyedLock;
  progress: Map<string, OperationProgress>;
  progressObservers?: Map<string, Set<(progress: OperationProgress | null) => void>>;
}

export function createPrisonOperationState(): PrisonOperationState {
  return { lock: new KeyedLock(), progress: new Map() };
}

export interface AnalyzeInput {
  rawRequest: string;
  language: Language;
  targetAI: TargetAI;
  /** An explicit UI/API selection takes precedence over request-text detection. */
  jailbreakMode?: boolean;
  executionContext?: ExecutionContext;
  councilMode?: CouncilMode;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AIProviderError) return new AppError("ai_error", error.message, `${error.kind}: ${error.detail}`);
  if (error instanceof StorageError) {
    return error.code === "invalid_id"
      ? new AppError("not_found", "Prison bulunamadı.")
      : new AppError("storage_error", error.message);
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new AppError("storage_error", "Beklenmeyen bir hata oluştu.", detail);
}

/**
 * Application service: persistence, locking and input checks around the pure pipelines.
 * Each operation loads ONE prison, runs a pipeline on it and saves it. If a pipeline fails
 * (for example an AI call), nothing is saved and the prison keeps its last good state.
 */
export class PrisonService {
  private readonly lock: KeyedLock;
  private readonly progress: Map<string, OperationProgress>;
  private readonly progressObservers: NonNullable<PrisonOperationState["progressObservers"]>;

  constructor(
    private readonly repo: PrisonRepository,
    private readonly provider: LLMProvider | null,
    private readonly now: () => Date = () => new Date(),
    private readonly council: CouncilDeps | null = null,
    operationState: PrisonOperationState = createPrisonOperationState(),
    private readonly checkpoints?: CouncilCheckpointRepository,
    private readonly councilConfigurationError: string | null = null,
  ) {
    this.lock = operationState.lock;
    this.progress = operationState.progress;
    this.progressObservers = operationState.progressObservers ??= new Map();
  }

  /** Jobs retain the public timeline even after the service clears its live progress. */
  subscribeProgress(id: string, listener: (progress: OperationProgress | null) => void): () => void {
    const listeners = this.progressObservers.get(id) ?? new Set();
    listeners.add(listener);
    this.progressObservers.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.progressObservers.delete(id); };
  }

  hasActiveMutation(id: string): boolean { return this.lock.isLocked(id); }

  private assertCouncilConfiguration(mode: CouncilMode, language: Language): void {
    if (mode === "single" || !this.councilConfigurationError) return;
    const message = {
      tr: "Seçilen masa/kapışma yöntemi kullanılamıyor. API ayarlarını düzelt veya hızlı tek model yöntemini seç.",
      en: "The selected team mode is unavailable. Repair the API settings or select the fast single-model mode.",
      zh: "所选团队模式不可用。请修复 API 设置，或选择快速单模型模式。",
    }[language];
    throw new AppError("invalid_input", `${message} ${this.councilConfigurationError}`, this.councilConfigurationError);
  }

  private publishProgress(id: string, progress: OperationProgress | null) {
    if (progress) this.progress.set(id, progress); else this.progress.delete(id);
    for (const listener of this.progressObservers.get(id) ?? []) {
      try { listener(progress); } catch { /* An observer cannot cancel the actual task. */ }
    }
  }

  private depsFor(id: string): PipelineDeps {
    return { provider: this.provider, now: this.now, council: this.council, checkpoints: this.checkpoints, onProgress: (update: ProgressUpdate) => {
      const previous = this.progress.get(id);
      const startedAt = previous?.startedAt ?? this.now().toISOString();
      this.publishProgress(id, { ...update, startedAt, ...(previous?.events ? { events: previous.events } : {}) });
    }, onCouncilEvent: (event: CouncilEvent) => {
      // A repair run restarts the council's own numbering; the live feed keeps one increasing sequence.
      const previous = this.progress.get(id);
      if (!previous) return;
      const events = previous.events ?? [];
      const seq = (events.at(-1)?.seq ?? -1) + 1;
      this.publishProgress(id, { ...previous, events: compactCouncilEvents([...events, { ...event, seq }]) });
    } };
  }

  async getProgress(id: string): Promise<OperationProgress | null> {
    await this.get(id);
    return this.progress.get(id) ?? null;
  }

  async list(): Promise<PrisonSummary[]> {
    try {
      return await this.repo.list();
    } catch (error) {
      throw toAppError(error);
    }
  }

  async get(id: string): Promise<Prison> {
    let prison: Prison | null;
    try {
      prison = await this.repo.get(id);
    } catch (error) {
      throw toAppError(error);
    }
    if (!prison) throw new AppError("not_found", "Prison bulunamadı.");
    return prison;
  }

  async analyze(input: AnalyzeInput): Promise<Prison> {
    const rawRequest = input.rawRequest.trim();
    if (rawRequest.length < REQUEST_LIMITS.min) throw new AppError("invalid_input", "İstek çok kısa.");
    if (rawRequest.length > REQUEST_LIMITS.max) {
      throw new AppError("invalid_input", `İstek en fazla ${REQUEST_LIMITS.max} karakter olabilir.`);
    }
    this.assertCouncilConfiguration(input.councilMode ?? "single", input.language);
    try {
      const prison = await runAnalysisPipeline({ ...input, rawRequest }, this.provider, this.now);
      await this.repo.save(prison);
      return prison;
    } catch (error) {
      throw toAppError(error);
    }
  }

  /** First compile, or a full regeneration (with critic review) when a prompt already exists. */
  async compile(id: string, options: { executionContext?: ExecutionContext; councilMode?: CouncilMode } = {}): Promise<Prison> {
    if ((options.executionContext !== undefined && !ExecutionContextSchema.safeParse(options.executionContext).success)
      || (options.councilMode !== undefined && !CouncilModeSchema.safeParse(options.councilMode).success)) {
      throw new AppError("invalid_input", "Kullanım ortamı veya konsey yöntemi geçersiz.");
    }
    return this.mutate(id, async (prison) => {
      prison = { ...prison, compileOptions: { ...prison.compileOptions, ...options,
        ...(options.executionContext !== undefined ? { agentMode: options.executionContext === "agent" } : {}) } };
      this.assertCouncilConfiguration(prison.compileOptions.councilMode, prison.language);
      const first = prison.status === "READY_FOR_COMPILE";
      const ready = first ? prison : transition(prison, "READY_FOR_COMPILE", "regenerate", this.now());
      return runCompilePipeline(
        ready,
        { trigger: first && prison.promptVersions.length === 0 ? "initial" : "regenerate", note: "", llmReview: true },
        this.depsFor(id),
      );
    });
  }

  async adjust(id: string, adjustment: Adjustment): Promise<Prison> {
    return this.mutate(id, async (prison) => {
      if (prison.promptVersions.length === 0) throw new AppError("not_ready", "Önce promptu üret.");
      this.assertCouncilConfiguration(adjustment.kind === "council_mode" ? adjustment.councilMode : prison.compileOptions.councilMode, prison.language);
      return runAdjustmentPipeline(prison, adjustment, this.depsFor(id));
    });
  }

  async revise(id: string, message: string): Promise<Prison> {
    const text = message.trim();
    if (text.length < REVISION_LIMITS.min) throw new AppError("invalid_input", "Revizyon mesajı çok kısa.");
    if (text.length > REVISION_LIMITS.max) {
      throw new AppError("invalid_input", `Revizyon en fazla ${REVISION_LIMITS.max} karakter olabilir.`);
    }
    return this.mutate(id, (prison) => {
      this.assertCouncilConfiguration(prison.compileOptions.councilMode, prison.language);
      return runRevisionPipeline(prison, text, this.depsFor(id));
    });
  }

  /** Validate against the current task under its lock; generated questions never become owner instructions. */
  async clarify(id: string, clarifications: ClarificationAnswer[]): Promise<Prison> {
    if (!Array.isArray(clarifications) || !clarifications.length || clarifications.length > 3) {
      throw new AppError("invalid_input", "Bir turda en fazla üç soruya yanıt verebilirsin.");
    }
    const parsed = ClarificationAnswerSchema.array().safeParse(clarifications);
    if (!parsed.success) throw new AppError("invalid_input", "Soru ve yanıtlar boş olamaz; her biri en fazla 1000 karakter olabilir.");
    const answers = parsed.data;
    if (new Set(answers.map((entry) => entry.question)).size !== answers.length) {
      throw new AppError("invalid_input", "Aynı soru birden fazla kez yanıtlanamaz.");
    }
    const message = answers.map((entry) => entry.answer).join("\n\n");
    if (message.length > REVISION_LIMITS.max) {
      throw new AppError("invalid_input", `Yanıtlar toplamda en fazla ${REVISION_LIMITS.max} karakter olabilir.`);
    }
    return this.mutate(id, (prison) => {
      const currentQuestions = new Set([
        ...(prison.spec.taskPlan?.clarifyingQuestions ?? []),
        ...prison.spec.unknowns.map((entry) => entry.text),
      ].map((question) => question.trim()));
      if (answers.some((entry) => !currentQuestions.has(entry.question))) {
        throw new AppError("invalid_input", "Sorular güncel görevle eşleşmiyor; güncel soruları açıp yeniden yanıtla.");
      }
      this.assertCouncilConfiguration(prison.compileOptions.councilMode, prison.language);
      return runRevisionPipeline(prison, message, this.depsFor(id), answers);
    });
  }

  async restore(id: string, version: number): Promise<Prison> {
    return this.mutate(id, async (prison) => {
      const restored = restoreVersion(prison, version, this.now());
      if (!restored) throw new AppError("not_found", `v${version} bulunamadı.`);
      return restored;
    });
  }

  async remove(id: string): Promise<void> {
    await this.lock.run(id, async () => {
      let deleted: boolean;
      try {
        deleted = await this.repo.delete(id);
      } catch (error) {
        throw toAppError(error);
      } finally {
        this.publishProgress(id, null);
      }
      if (!deleted) throw new AppError("not_found", "Prison bulunamadı.");
      await this.clearCheckpoint(id);
    });
  }

  private async mutate(id: string, operation: (prison: ResolvedPrison) => Promise<ResolvedPrison>): Promise<Prison> {
    return this.lock.run(id, async () => {
      const prison = await this.get(id);
      if (!isResolved(prison)) throw new AppError("not_ready", "Bu prison henüz analiz edilmemiş.");
      if (!isIdle(prison.status)) throw new AppError("busy", "Bu prison üzerinde başka bir işlem sürüyor.");
      try {
        const next = await operation(prison);
        await this.repo.save(next);
        // Selected drafts survive storage failures; only a persisted task mutation retires them.
        await this.clearCheckpoint(id);
        return next;
      } catch (error) {
        throw toAppError(error);
      } finally {
        this.publishProgress(id, null);
      }
    });
  }

  private async clearCheckpoint(id: string): Promise<void> {
    try { await this.checkpoints?.delete(id); }
    catch { /* The persisted source/version fingerprint invalidates any leftover draft. */ }
  }
}
