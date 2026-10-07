import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CouncilCheckpointSchema, type CouncilCheckpoint } from "@/models/council-checkpoint";
import { isPrisonId } from "@/core/prison-engine/ids";
import { AppError } from "@/services/errors";

export interface CouncilCheckpointRepository {
  get(prisonId: string): Promise<CouncilCheckpoint | null>;
  save(checkpoint: CouncilCheckpoint): Promise<void>;
  delete(prisonId: string): Promise<boolean>;
}

/** One private checkpoint per task. Caller supplies its private .council-checkpoints directory. */
export class FileCouncilCheckpointRepository implements CouncilCheckpointRepository {
  private readonly dir: string;
  constructor(dir: string) { this.dir = path.resolve(dir); }

  private file(prisonId: string): string {
    if (!isPrisonId(prisonId)) throw new AppError("not_found", "Görevin kontrol noktası bulunamadı.");
    return path.join(this.dir, `${prisonId}.json`);
  }

  async get(prisonId: string): Promise<CouncilCheckpoint | null> {
    const file = this.file(prisonId);
    let text: string;
    try { text = await fs.readFile(file, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new AppError("storage_error", "Konsey kontrol noktası okunamadı; mevcut görev korundu.");
    }
    try {
      const checkpoint = CouncilCheckpointSchema.parse(JSON.parse(text));
      if (checkpoint.prisonId !== prisonId) throw new Error("Task identity mismatch");
      return checkpoint;
    } catch { throw new AppError("storage_error", "Konsey kontrol noktası doğrulanamadı; mevcut görev korundu."); }
  }

  async save(checkpoint: CouncilCheckpoint): Promise<void> {
    let record: CouncilCheckpoint;
    try { record = CouncilCheckpointSchema.parse(checkpoint); }
    catch { throw new AppError("storage_error", "Konsey kontrol noktası doğrulanamadı; mevcut görev korundu."); }
    const file = this.file(record.prisonId);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      await fs.writeFile(temp, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temp, file); return; }
        catch (error) {
          if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        }
      }
    } catch {
      await fs.unlink(temp).catch(() => undefined);
      throw new AppError("storage_error", "Konsey kontrol noktası kaydedilemedi; mevcut görev korundu.");
    }
  }

  async delete(prisonId: string): Promise<boolean> {
    const file = this.file(prisonId);
    try { await fs.unlink(file); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new AppError("storage_error", "Konsey kontrol noktası silinemedi; mevcut görev korundu.");
    }
  }
}
