import { promises as fs } from "node:fs";
import path from "node:path";
import { PrisonSchema, summarizePrison, type Prison, type PrisonSummary } from "@/models/prison";
import { isPrisonId } from "@/core/prison-engine/ids";
import { StorageError, type PrisonRepository } from "./repository";

/**
 * One JSON file per prison: <dir>/pr_xxxxxxxx.json. Writes are atomic (temp file + rename),
 * reads are schema-validated, and ids are pattern-checked so a path can never escape <dir>.
 */
export class FilePrisonRepository implements PrisonRepository {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!isPrisonId(id)) throw new StorageError(`Geçersiz prison id: ${id}`, "invalid_id");
    return path.join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private parse(raw: string, id: string): Prison {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new StorageError(`Prison kaydı okunamadı (bozuk JSON): ${id}`, "corrupt");
    }
    const result = PrisonSchema.safeParse(json);
    if (!result.success) throw new StorageError(`Prison kaydı şemaya uymuyor: ${id}`, "corrupt");
    return result.data;
  }

  async get(id: string): Promise<Prison | null> {
    const file = this.file(id);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new StorageError(`Prison okunamadı: ${id}`, "io");
    }
    return this.parse(raw, id);
  }

  async list(): Promise<PrisonSummary[]> {
    await this.ensureDir();
    const names = await fs.readdir(this.dir);
    const summaries: PrisonSummary[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, "");
      if (!name.endsWith(".json") || !isPrisonId(id)) continue;
      try {
        const prison = await this.get(id);
        if (prison) summaries.push(summarizePrison(prison));
      } catch (error) {
        console.warn(`[prison-storage] skipping ${name}:`, error instanceof Error ? error.message : error);
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(prison: Prison): Promise<void> {
    const file = this.file(prison.id);
    await this.ensureDir();
    const validated = PrisonSchema.parse(prison);
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await renameWithRetry(temp, file);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.file(id));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}

/** Windows can briefly lock a file (indexer/antivirus); retry the rename a few times. */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        await fs.rm(from, { force: true });
        throw new StorageError(`Prison kaydedilemedi: ${path.basename(to)}`, "io");
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
    }
  }
}
