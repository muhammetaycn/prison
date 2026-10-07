"use client";

import type { EngineHealthResult } from "@/models/engine-health";
import type { EngineStatus } from "@/services/ai/config";
import type { CouncilMetadata } from "@/services/ai/council-config";
import { cx } from "@/ui/lib/format";
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
  const connected = health?.status === "connected";
  const failed = health?.status === "error";
  const local = engine?.mode === "local";
  const label = engine ? PROVIDER_LABELS[engine.provider] ?? engine.provider : loading ? "Motor yükleniyor" : "Motor bilgisi alınamadı";
  const message = checking
    ? "Bağlantı kontrol ediliyor…"
    : health?.message ?? (local ? "Bu cihazda çalışıyor" : engine ? "Bağlantı henüz sınanmadı" : "");

  return (
    <section className={styles.root} aria-label="AI bağlantısı">
      <div className={styles.heading}>
        <span className={cx(styles.dot, connected && styles.connected, failed && styles.failed, local && styles.local)} aria-hidden />
        <strong>{label}</strong>
      </div>
      {engine?.model ? <span className={styles.model} title={engine.model}>{engine.model}</span> : null}
      {council?.enabled ? (
        <details className={styles.council}>
          <summary>{council.models.length} modelli AI masası</summary>
          <p>Yapılandırılan modeller; her üretimde yanıt durumları ayrıca kaydedilir.</p>
          <ul>{council.models.map((member) => <li key={member.id}><span>{member.model ?? member.provider}</span><small>{member.role}</small></li>)}</ul>
        </details>
      ) : null}
      <p className={cx(styles.message, failed && styles.error)} role="status" aria-live="polite">{message}</p>
      {health && !checking ? (
        <span className={styles.checked}>
          Son kontrol {new Date(health.checkedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
          {connected ? ` · ${(health.latencyMs / 1000).toFixed(1)} sn` : ""}
        </span>
      ) : null}
      {engine?.mode === "ai" ? (
        <button type="button" className={`btn ${styles.check}`} onClick={onCheck} disabled={disabled || checking}>
          {checking ? <span className="spinner" aria-hidden /> : null}
          {checking ? "Kontrol ediliyor" : council?.enabled ? "Analiz motorunu kontrol et" : connected ? "Yeniden kontrol et" : "Bağlantıyı kontrol et"}
        </button>
      ) : null}
    </section>
  );
}
