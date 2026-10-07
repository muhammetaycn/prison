import type { Prison, PrisonSummary } from "@/models/prison";

/** Persistence boundary. Every call addresses exactly one prison by id (or lists summaries). */
export interface PrisonRepository {
  list(): Promise<PrisonSummary[]>;
  get(id: string): Promise<Prison | null>;
  save(prison: Prison): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_id" | "corrupt" | "io",
  ) {
    super(message);
    this.name = "StorageError";
  }
}
