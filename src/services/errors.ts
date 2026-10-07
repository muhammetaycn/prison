export type AppErrorCode = "not_found" | "invalid_input" | "validation_error" | "busy" | "not_ready" | "ai_error" | "storage_error";

const STATUS: Record<AppErrorCode, number> = {
  not_found: 404,
  invalid_input: 400,
  validation_error: 422,
  busy: 409,
  not_ready: 409,
  ai_error: 502,
  storage_error: 500,
};

/** Application-level error with a user-facing (Turkish) message and an HTTP status. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}
