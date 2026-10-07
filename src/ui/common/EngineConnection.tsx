"use client";

import type { EngineHealthResult } from "@/models/engine-health";
import type { EngineStatus } from "@/services/ai/config";
import type { CouncilMetadata } from "@/services/ai/council-config";
import type { AIErrorKind } from "@/services/ai/errors";
import { cx } from "@/ui/lib/format";
import { useI18n, type Translate } from "@/ui/i18n";
import { useVocabulary } from "@/ui/i18n/vocabulary";
import styles from "./EngineConnection.module.css";

const PROVIDER_LABELS: Record<string, string> = {
  nvidia: "NVIDIA",
  deepseek: "DeepSeek",
  anthropic: "Claude",
  openai: "OpenAI",
  local: "Yerel motor",
};

interface EngineConnectionProps {
  engine: EngineStatus | null;
  council?: CouncilMetadata | null;
  loading: boolean;
  health: EngineHealthResult | null;
  checking: boolean;
  disabled: boolean;
  onCheck: () => void;
}

export function EngineConnection({ engine, council, loading, health, checking, disabled, onCheck }: EngineConnectionProps) {
  const { locale, t } = useI18n();
  const vocabulary = useVocabulary();
  const connected = health?.status === "connected";
  const failed = health?.status === "error";
  const local = engine?.mode === "local";
  const label = engine ? engine.provider === "local" ? t("Yerel motor", "Local engine", "本地引擎") : PROVIDER_LABELS[engine.provider] ?? engine.provider : loading ? t("Motor yükleniyor", "Loading engine", "正在加载引擎") : t("Motor bilgisi alınamadı", "Engine information unavailable", "无法获取引擎信息");
  const message = checking
    ? t("Bağlantı kontrol ediliyor…", "Checking the connection…", "正在检查连接…")
    : health ? connectionHealthMessage(health, t) : local ? t("Bu cihazda çalışıyor", "Running on this device", "在此设备上运行") : engine ? t("Bağlantı henüz sınanmadı", "Connection not yet tested", "尚未测试连接") : "";

  return (
    <section className={styles.root} aria-label={t("AI bağlantısı", "AI connection", "AI 连接")}>
      <div className={styles.heading}>
        <span className={cx(styles.dot, connected && styles.connected, failed && styles.failed, local && styles.local)} aria-hidden />
        <strong>{label}</strong>
      </div>
      {engine?.model ? <span className={styles.model} title={engine.model}>{engine.model}</span> : null}
      {council?.enabled ? (
        <details className={styles.council}>
          <summary>{t(`${council.models.length} modelli AI masası`, `AI table with ${council.models.length} models`, `${council.models.length} 个模型的 AI 讨论桌`)}</summary>
          <p>{t("Yapılandırılan modeller; her üretimde yanıt durumları ayrıca kaydedilir.", "Configured models; response availability is recorded for each generation.", "已配置的模型；每次生成时会分别记录响应情况。")}</p>
          <ul>{council.models.map((member) => <li key={member.id}><span>{member.model ?? member.provider}</span><small>{vocabulary(member.role)}</small></li>)}</ul>
        </details>
      ) : null}
      {council?.configurationError ? <p className={cx(styles.message, styles.error)} role="status">{t("Masa ayarı düzeltilmeli. Hızlı tek model kullanılabilir; API ayarlarından masayı düzenle.", "The table needs configuration repair. Quick single-model mode is available; update the table in API settings.", "讨论桌配置需要修复。仍可使用快速单模型模式；请在 API 设置中修改讨论桌。")}{" "}{council.configurationError}</p> : null}
      <p className={cx(styles.message, failed && styles.error)} role="status" aria-live="polite">{message}</p>
      {health && !checking ? (
        <span className={styles.checked}>
          {t("Son kontrol", "Last checked", "上次检查")} {new Date(health.checkedAt).toLocaleTimeString(locale === "tr" ? "tr-TR" : locale === "en" ? "en-GB" : "zh-CN", { hour: "2-digit", minute: "2-digit" })}
          {connected ? ` · ${(health.latencyMs / 1000).toFixed(1)} ${t("sn", "s", "秒")}` : ""}
        </span>
      ) : null}
      {engine?.mode === "ai" ? (
        <button type="button" className={`btn ${styles.check}`} onClick={onCheck} disabled={disabled || checking}>
          {checking ? <span className="spinner" aria-hidden /> : null}
          {checking ? t("Kontrol ediliyor", "Checking", "检查中") : council?.enabled ? t("Analiz motorunu kontrol et", "Check analysis engine", "检查分析引擎") : connected ? t("Yeniden kontrol et", "Check again", "再次检查") : t("Bağlantıyı kontrol et", "Check connection", "检查连接")}
        </button>
      ) : null}
    </section>
  );
}

const ERROR_MESSAGES: Record<AIErrorKind, [string, string]> = {
  configuration: ["AI configuration is missing or invalid. Check the provider, model and key in API settings.", "AI 配置缺失或无效。请检查 API 设置中的提供商、模型和密钥。"],
  auth: ["The AI provider rejected authentication. Check your API key in settings.", "AI 提供商拒绝了身份验证。请检查设置中的 API 密钥。"],
  rate_limit: ["The AI provider's rate limit was reached. Wait a little and retry.", "已达到 AI 提供商的速率限制。请稍后重试。"],
  network: ["Could not connect to the AI provider. Check your internet connection and retry.", "无法连接 AI 提供商。请检查网络连接后重试。"],
  timeout: ["The AI response timed out. Your task was preserved; retry shortly.", "AI 响应超时。任务已保留，请稍后重试。"],
  unavailable: ["The AI provider is unavailable due to server trouble or demand. Retry shortly.", "AI 提供商因服务器问题或繁忙而暂时不可用。请稍后重试。"],
  bad_request: ["The AI provider rejected the request as invalid. The model name or configuration may be incorrect.", "AI 提供商认为请求无效。模型名称或配置可能有误。"],
  refusal: ["The AI provider did not process this request under its own safety policy.", "AI 提供商根据其安全政策未处理此请求。"],
  truncated: ["The AI response was cut short. Retry or shorten the request.", "AI 响应被截断。请重试或缩短请求。"],
  invalid_output: ["The AI could not produce valid structured output. Retry.", "AI 未能生成有效的结构化输出。请重试。"],
  unknown: ["The AI call failed with an unexpected error.", "AI 调用出现意外错误。"],
};

/** These are service-generated connection results, never task text or model excerpts. */
export function connectionHealthMessage(health: EngineHealthResult, t: Translate): string {
  const failure = health.errorKind ? ERROR_MESSAGES[health.errorKind] : undefined;
  if (health.status === "error" && failure) return t(health.message, ...failure);
  if (health.message === "API bağlantısı doğrulandı. Seçili model geçerli yanıt verdi.") {
    return t(health.message, "API connection verified. The selected model returned a valid response.", "API 连接已验证，所选模型返回了有效响应。");
  }
  if (health.message === "Yerel motor hazır. API bağlantısı kullanılmıyor.") {
    return t(health.message, "The local engine is ready. No API connection is used.", "本地引擎已就绪，不使用 API 连接。");
  }
  return health.message;
}
