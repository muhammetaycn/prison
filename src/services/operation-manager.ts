import { createHash, randomUUID } from "node:crypto";
import { isResolved, type Prison } from "@/models/prison";
import { OperationRequestSchema, operationIsActive, type OperationRequest, type PrisonOperation } from "@/models/operation";
import type { OperationRepository } from "./storage/operation-repository";
import type { PrisonService } from "./prison-service";
import { AppError } from "./errors";
import { AIProviderError } from "./ai/errors";
import { isIdle } from "@/core/prison-engine/state-machine";

export interface OperationManagerState {
  byPrison: Map<string, string>;
  records: Map<string, PrisonOperation>;
  running: Map<string, Promise<void>>;
  latestByPrison: Map<string, string>;
}
export const createOperationManagerState = (): OperationManagerState => ({ byPrison: new Map(), records: new Map(), running: new Map(), latestByPrison: new Map() });

const publicError = (error: unknown): NonNullable<PrisonOperation["error"]> => error instanceof AppError
  ? { code: error.code, message: error.message }
  : error instanceof AIProviderError ? { code: "ai_error", message: error.message }
    : { code: "internal", message: "Üretim tamamlanamadı; mevcut görev ve tartışma kaydı korundu. Yeniden deneyebilirsin." };

// Failed pipelines leave the canonical task untouched. Any later persisted owner action invalidates a retry.
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const sourceFingerprint = (prison: Prison) => createHash("sha256").update(JSON.stringify(canonical({
  id: prison.id, rawRequest: prison.rawRequest, language: prison.language, targetAI: prison.targetAI,
  executionMode: prison.executionMode, intent: prison.intent, spec: prison.spec, compileOptions: prison.compileOptions,
  revisions: prison.revisions, inactiveOwnerRevisionIds: prison.inactiveOwnerRevisionIds ?? [], taskMemory: prison.taskMemory,
  promptVersions: prison.promptVersions, activeVersion: prison.activeVersion, itemSeq: prison.itemSeq,
}))).digest("hex");

/** Local persistent jobs. A browser connection never owns or cancels model work. */
export class OperationManager {
  constructor(private readonly repo: OperationRepository, private readonly service: PrisonService,
    private readonly state = createOperationManagerState(), private readonly now: () => Date = () => new Date()) {
    this.state.latestByPrison ??= new Map(); // Shared development state can predate a module update.
  }

  async assertIdle(prisonId: string) {
    if (this.state.byPrison.has(prisonId) || this.service.hasActiveMutation(prisonId)) throw new AppError("busy", "Bu görev için bir üretim zaten sürüyor; devam eden işlem izlenebilir.");
  }

  /** Atomic reservation for short restore/delete actions; they cannot race a newly accepted job. */
  async runIdle<T>(prisonId: string, execute: () => Promise<T>): Promise<T> {
    if (this.state.byPrison.has(prisonId) || this.service.hasActiveMutation(prisonId)) throw new AppError("busy", "Bu görevde bir işlem zaten sürüyor.");
    const reservation = `short_${randomUUID()}`;
    this.state.byPrison.set(prisonId, reservation);
    try { return await execute(); }
    finally { if (this.state.byPrison.get(prisonId) === reservation) this.state.byPrison.delete(prisonId); }
  }

  async start(prisonId: string, kind: PrisonOperation["kind"], execute: () => Promise<Prison>, request?: OperationRequest): Promise<PrisonOperation> {
    return this.enqueue(prisonId, kind, execute, request);
  }

  /** Replay the exact saved action only against the unchanged task and latest failed job. */
  async retry(id: string): Promise<PrisonOperation> {
    const previous = await this.get(id);
    if (previous.status !== "failed" && previous.status !== "interrupted") throw new AppError("busy", "Bu işlem yeniden denemeye hazır değil; devam eden işlem izlenebilir.");
    if (!previous.retry) throw new AppError("not_ready", "Eski işlemde gönderilen değişiklik kaydedilmemiş. Güncel görevden promptu yeniden üretebilirsin.");
    const request = previous.retry.request;
    const execute = () => {
      if (request.kind === "compile") return this.service.compile(previous.prisonId, request.input);
      if (request.kind === "revise") return this.service.revise(previous.prisonId, request.input.message);
      if (request.kind === "clarify") return this.service.clarify(previous.prisonId, request.input.clarifications);
      const input = request.input;
      const adjustment = "action" in input ? { kind: "modifier" as const, action: input.action }
        : "target" in input ? { kind: "target" as const, target: input.target }
          : "executionContext" in input ? { kind: "context" as const, executionContext: input.executionContext }
            : { kind: "council_mode" as const, councilMode: input.councilMode };
      return this.service.adjust(previous.prisonId, adjustment);
    };
    return this.enqueue(previous.prisonId, previous.kind, execute, request, { id: previous.id, fingerprint: previous.retry.sourceFingerprint });
  }

  private async enqueue(prisonId: string, kind: PrisonOperation["kind"], execute: () => Promise<Prison>, request?: OperationRequest,
    retryOf?: { id: string; fingerprint: string }): Promise<PrisonOperation> {
    // Reserve synchronously before any I/O so two submissions cannot both start model calls.
    if (this.state.byPrison.has(prisonId) || this.service.hasActiveMutation(prisonId)) throw new AppError("busy", "Bu görev için bir üretim zaten sürüyor; devam eden işlem izlenebilir.");
    const id = `op_${randomUUID().replaceAll("-", "")}`;
    this.state.byPrison.set(prisonId, id);
    try {
      const prison = await this.service.get(prisonId);
      if (!isResolved(prison) || !isIdle(prison.status)) throw new AppError("not_ready", "Bu görev şu anda üretime hazır değil.");
      // Retain/reconcile a previous interrupted job before establishing the next one.
      const latest = await this.latest(prisonId);
      if (retryOf && (latest?.id !== retryOf.id || sourceFingerprint(prison) !== retryOf.fingerprint)) {
        throw new AppError("not_ready", "Görev veya son işlem değişmiş. Güncel isteği inceleyip yeni bir işlem başlat.");
      }
      const parsed = request ? OperationRequestSchema.safeParse(request) : null;
      if (parsed && (!parsed.success || parsed.data.kind !== kind)) throw new AppError("invalid_input", "İşlem girdisi geçersiz.");
      const at = this.now().toISOString();
      const record: PrisonOperation = { id, prisonId, kind, status: "queued", startedAt: at, updatedAt: at,
        progress: null, error: null, resultVersion: null,
        ...(parsed?.success ? { retry: { request: parsed.data, sourceFingerprint: sourceFingerprint(prison) } } : {}) };
      await this.repo.save(record);
      this.state.records.set(id, record);
      this.state.latestByPrison.set(prisonId, id);
      const running = this.run(record, execute);
      this.state.running.set(id, running);
      // Always observe the task; persistence errors must not become unhandled promise rejections.
      void running.catch(() => undefined);
      return structuredClone(record);
    } catch (error) {
      if (this.state.byPrison.get(prisonId) === id) this.state.byPrison.delete(prisonId);
      this.state.records.delete(id);
      throw error;
    }
  }

  /** Route handlers register this promise with Next's after(), then return HTTP 202 immediately. */
  wait(id: string): Promise<void> { return this.state.running.get(id) ?? Promise.resolve(); }

  private async run(record: PrisonOperation, execute: () => Promise<Prison>) {
    let writes = Promise.resolve();
    let storageFailure: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      const snapshot = structuredClone(record);
      writes = writes.then(() => this.repo.save(snapshot)).catch(error => { storageFailure = error; });
    };
    const unsubscribe = this.service.subscribeProgress(record.prisonId, progress => {
      if (!progress) return; // A finished/failed operation keeps its last public timeline.
      record.progress = structuredClone(progress);
      record.updatedAt = this.now().toISOString();
      if (timer === undefined) timer = setTimeout(() => { timer = undefined; persist(); }, 200);
    });
    try {
      record.status = "running";
      record.updatedAt = this.now().toISOString();
      await this.repo.save(structuredClone(record));
      const prison = await execute();
      record.status = "completed";
      record.resultVersion = prison.activeVersion;
      record.error = null;
    } catch (error) {
      record.status = "failed";
      record.error = publicError(error);
    } finally {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      await writes;
      // Terminal writes follow every progress write; an old snapshot cannot erase completion.
      record.updatedAt = this.now().toISOString();
      try { await this.repo.save(structuredClone(record)); }
      catch (error) { storageFailure = error; }
      this.state.running.delete(record.id);
      if (this.state.byPrison.get(record.prisonId) === record.id) this.state.byPrison.delete(record.prisonId);
      // Keep the terminal snapshot in memory as a fallback when the disk itself is unavailable.
      if (storageFailure) { record.error ??= publicError(storageFailure); }
    }
  }

  private async reconcile(record: PrisonOperation | null): Promise<PrisonOperation | null> {
    if (!record) return null;
    if (operationIsActive(record) && !this.state.running.has(record.id) && !this.state.records.has(record.id)
      && this.state.byPrison.get(record.prisonId) !== record.id) {
      record = { ...record, status: "interrupted", updatedAt: this.now().toISOString(),
        error: { code: "interrupted", message: "Sunucu yeniden başladığı için önceki üretim yarıda kaldı. Tartışma ve son geçerli prompt korundu; yeniden deneyebilirsin." } };
      await this.repo.save(record);
    }
    return structuredClone(record);
  }

  async get(id: string): Promise<PrisonOperation> {
    const record = this.state.records.get(id) ?? await this.repo.get(id);
    if (!record) throw new AppError("not_found", "İşlem bulunamadı.");
    await this.service.get(record.prisonId);
    return (await this.reconcile(record))!;
  }

  async latest(prisonId: string): Promise<PrisonOperation | null> {
    await this.service.get(prisonId);
    const id = this.state.byPrison.get(prisonId) ?? this.state.latestByPrison.get(prisonId);
    if (id && this.state.records.has(id)) return this.reconcile(this.state.records.get(id)!);
    return this.reconcile(await this.repo.latest(prisonId));
  }
}
