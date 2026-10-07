export const AI_ERROR_KINDS = [
  "configuration",
  "auth",
  "rate_limit",
  "network",
  "timeout",
  "unavailable",
  "bad_request",
  "refusal",
  "truncated",
  "invalid_output",
  "unknown",
] as const;
export type AIErrorKind = (typeof AI_ERROR_KINDS)[number];

const USER_MESSAGES: Record<AIErrorKind, string> = {
  configuration: "AI yapılandırması eksik veya geçersiz. API ayarlarındaki sağlayıcı, model ve anahtar bilgilerini kontrol et.",
  auth: "AI sağlayıcısı kimlik doğrulamayı reddetti. API ayarlarındaki anahtarı kontrol et.",
  rate_limit: "AI sağlayıcısının hız sınırına takıldı. Biraz bekleyip tekrar dene.",
  network: "AI sağlayıcısına bağlanılamadı. İnternet bağlantını kontrol edip tekrar dene.",
  timeout: "AI sağlayıcısının yanıt süresi doldu. Mevcut görev korundu; biraz sonra tekrar dene.",
  unavailable: "AI sağlayıcısı şu an yanıt veremiyor (sunucu hatası veya yoğunluk). Biraz sonra tekrar dene.",
  bad_request: "AI sağlayıcısı isteği geçersiz buldu. Model adı veya yapılandırma hatalı olabilir.",
  refusal: "AI sağlayıcısı bu isteği kendi güvenlik politikası gereği işlemedi.",
  truncated: "AI yanıtı yarıda kesildi. Tekrar dene ya da isteği kısalt.",
  invalid_output: "AI geçerli bir yapılandırılmış çıktı üretemedi. Tekrar dene.",
  unknown: "AI çağrısı beklenmeyen bir hatayla başarısız oldu.",
};

const RETRYABLE: ReadonlySet<AIErrorKind> = new Set(["rate_limit", "network", "unavailable", "truncated", "invalid_output"]);

/** Provider-agnostic AI failure. Carries a Turkish user-facing message and the technical detail separately. */
export class AIProviderError extends Error {
  readonly kind: AIErrorKind;
  readonly detail: string;

  constructor(kind: AIErrorKind, detail: string) {
    super(USER_MESSAGES[kind]);
    this.name = "AIProviderError";
    this.kind = kind;
    this.detail = detail;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

/** Maps an HTTP status from any provider SDK to an error kind. */
export function kindFromStatus(status: number | undefined): AIErrorKind {
  if (status === undefined) return "network";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 400 || status === 404 || status === 413 || status === 422) return "bad_request";
  if (status >= 500) return "unavailable";
  return "unknown";
}
