import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrisonOperationSchema, type PrisonOperation } from "@/models/operation";
import { isPrisonId } from "@/core/prison-engine/ids";
import { AppError } from "@/services/errors";

export interface OperationRepository {
  get(id: string): Promise<PrisonOperation | null>;
  latest(prisonId: string): Promise<PrisonOperation | null>;
  save(operation: PrisonOperation): Promise<void>;
}

/** Atomic task-specific records with validated user-action retry input, never provider credentials or private reasoning. */
export class FileOperationRepository implements OperationRepository {
  constructor(private readonly dir: string) {}
  private file(id: string) {
    if (!/^op_[a-f0-9]{32}$/.test(id)) throw new AppError("not_found", "İşlem bulunamadı.");
    return path.join(this.dir, `${id}.json`);
  }
  private index(prisonId: string) {
    if (!isPrisonId(prisonId)) throw new AppError("not_found", "Prison bulunamadı.");
    return path.join(this.dir, `${prisonId}.latest.json`);
  }
  private async read(file: string): Promise<unknown | null> {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new AppError("storage_error", "İşlem kaydı okunamadı; mevcut görev korundu.");
    }
  }
  async get(id: string) {
    const raw = await this.read(this.file(id));
    if (raw === null) return null;
    const result = PrisonOperationSchema.safeParse(raw);
    if (!result.success || result.data.id !== id) throw new AppError("storage_error", "İşlem kaydı doğrulanamadı.");
    return result.data;
  }
  async latest(prisonId: string) {
    const index = await this.read(this.index(prisonId));
    if (index === null) return null;
    if (typeof index !== "string" || !/^op_[a-f0-9]{32}$/.test(index)) throw new AppError("storage_error", "İşlem dizini doğrulanamadı.");
    const operation = await this.get(index);
    if (operation && operation.prisonId !== prisonId) throw new AppError("storage_error", "İşlem başka bir göreve ait.");
    return operation;
  }
  private async atomic(file: string, text: string) {
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, text, "utf8");
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temp, file); return; }
      catch (error) {
        if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
  }
  async save(operation: PrisonOperation) {
    const record = PrisonOperationSchema.parse(operation);
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await this.atomic(this.file(record.id), JSON.stringify(record));
      // Only a newly queued job establishes the task's latest operation. Old completions cannot replace it.
      if (record.status === "queued") await this.atomic(this.index(record.prisonId), JSON.stringify(record.id));
    } catch { throw new AppError("storage_error", "İşlem ilerlemesi kaydedilemedi; mevcut görev korundu."); }
  }
}
