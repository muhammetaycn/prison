import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProviderProfileSchema, ProviderSelectionSchema, ProviderCouncilSchema } from "@/models/provider-settings";
import { AppError } from "@/services/errors";
import { KeyedLock } from "./lock";

export const StoredProviderSettingsSchema = z.object({
  version: z.literal(1),
  revision: z.string().uuid(),
  providers: z.array(ProviderProfileSchema.extend({
    key: z.string().min(1).max(4096).nullable(),
    useEnvironmentKey: z.boolean(),
  })).max(12),
  primary: ProviderSelectionSchema.nullable(),
  council: ProviderCouncilSchema,
}).strict();
export type StoredProviderSettings = z.infer<typeof StoredProviderSettingsSchema>;

const LOCKS = Symbol.for("prison.provider-settings.locks.v1");
const registry = globalThis as typeof globalThis & { [LOCKS]?: KeyedLock };

/** Stored outside build files. Reads never log record contents; writes replace the complete file atomically. */
export class FileProviderSettingsRepository {
  readonly file: string;
  constructor(dataDir: string) { this.file = path.join(path.resolve(dataDir), ".provider-settings.json"); }

  loadSync(): StoredProviderSettings | null {
    try {
      return StoredProviderSettingsSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new AppError("storage_error", "API ayarları okunamadı. Mevcut ayar dosyası korundu.");
    }
  }

  async exclusive<T>(task: () => Promise<T>): Promise<T> {
    const key = process.platform === "win32" ? this.file.toLowerCase() : this.file;
    return (registry[LOCKS] ??= new KeyedLock()).run(key, task);
  }

  async save(settings: StoredProviderSettings): Promise<void> {
    const parsed = StoredProviderSettingsSchema.safeParse(settings);
    if (!parsed.success) throw new AppError("invalid_input", "API ayarları geçersiz.");
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(parsed.data), { encoding: "utf8", mode: 0o600, flag: "wx" });
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temporary, this.file); return; }
        catch (error) {
          if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
        }
      }
    } catch { throw new AppError("storage_error", "API ayarları kaydedilemedi. Önceki ayarlar korundu."); }
    finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
  }

  async reset(): Promise<void> {
    try { await fs.unlink(this.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AppError("storage_error", "Varsayılan API ayarlarına dönülemedi.");
    }
  }
}
