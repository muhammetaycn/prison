"use client";

import { useEffect, useRef, useState } from "react";
import type { ConcreteTarget } from "@/models/common";
import type { ExecutionContext } from "@/models/options";
import { TARGET_LABELS } from "@/templates/ui-labels";
import { copyPrompt, downloadPrompt, promptUseInstruction } from "./prompt-transfer";
import styles from "./PromptHandoff.module.css";

interface PromptHandoffProps {
  text: string;
  version: number;
  target: ConcreteTarget;
  context: ExecutionContext;
  active: boolean;
  busy: boolean;
  onRevise?: (feedback: string) => Promise<boolean>;
}

export function PromptHandoff({ text, version, target, context, active, busy, onRevise }: PromptHandoffProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [exportStatus, setExportStatus] = useState<"idle" | "started" | "failed">("idle");
  const [feedback, setFeedback] = useState("");
  const [revisionStatus, setRevisionStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const operationRef = useRef(0);
  const revisionPending = useRef(false);

  useEffect(() => {
    operationRef.current += 1;
    setCopyStatus("idle");
    setExportStatus("idle");
    setRevisionStatus("idle");
  }, [text, version]);
  useEffect(() => () => { operationRef.current += 1; }, []);

  const copy = async () => {
    const operation = ++operationRef.current;
    setCopyStatus("copying");
    const success = await copyPrompt(text);
    if (operation === operationRef.current) setCopyStatus(success ? "copied" : "failed");
  };
  const revise = async () => {
    const message = feedback.trim();
    if (!onRevise || !active || busy || revisionPending.current || message.length < 2) return;
    revisionPending.current = true;
    setRevisionStatus("sending");
    try {
      const success = await onRevise(message);
      setRevisionStatus(success ? "sent" : "failed");
      if (success) setFeedback("");
    } catch {
      setRevisionStatus("failed");
    } finally {
      revisionPending.current = false;
    }
  };

  return (
    <section className={styles.root} aria-label="Promptu kullan ve geliştir">
      <div className={styles.heading}>
        <div><span className={styles.eyebrow}>Sıradaki adım sende</span><h3>v{version} promptunu {TARGET_LABELS[target]} ile dene</h3></div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary" disabled={copyStatus === "copying" || !text} onClick={() => void copy()}>{copyStatus === "copied" ? "Kopyalandı" : copyStatus === "copying" ? "Kopyalanıyor" : "Tam promptu kopyala"}</button>
          <button type="button" className="btn" disabled={!text} onClick={() => setExportStatus(downloadPrompt(text, version, target) ? "started" : "failed")}>.txt indir</button>
        </div>
      </div>
      <p className={styles.instruction}>{promptUseInstruction(TARGET_LABELS[target], context)}</p>
      <p className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {copyStatus === "failed" ? "Kopyalanamadı. Prompt metnini seçerek elle kopyalayabilirsin." : copyStatus === "copied" ? `v${version} promptunun tamamı panoya kopyalandı.` : ""}
        {exportStatus === "started" ? " İndirme başlatıldı." : exportStatus === "failed" ? " İndirme başlatılamadı; kopyalama seçeneğini kullanabilirsin." : ""}
      </p>
      <details className={styles.feedback}>
        <summary>Denedin mi? Sonucu birlikte iyileştirelim</summary>
        <p>Hangi kısmı işe yaradı, nerede hedefinden saptı? İstediğin değişikliği yaz. Bu, sonraki promptun gerçek talimatı olur.</p>
        {onRevise ? <>
          <label className={styles.feedbackLabel}>Sonraki sürüm için geri bildirimin
            <textarea value={feedback} maxLength={2000} onChange={(event) => { setFeedback(event.target.value); setRevisionStatus("idle"); }} placeholder="Örnek: Yanıt çok genel kaldı. Benim verdiğim verilerden 3 somut öneri çıkarmasını iste." disabled={busy || revisionStatus === "sending" || !active} />
          </label>
          {!active ? <p>Önce bu sürüme dön veya aktif promptu seç; geri bildirimin aktif sürümü değiştirecek.</p> : null}
          <div className={styles.feedbackFoot}>
            <span>{feedback.length}/2000</span>
            <button type="button" className="btn" onClick={() => void revise()} disabled={!active || busy || revisionStatus === "sending" || feedback.trim().length < 2}>{revisionStatus === "sending" ? "Yeni sürüm hazırlanıyor" : "Geri bildirimle yeni sürüm üret"}</button>
          </div>
          <p role="status" aria-live="polite">{revisionStatus === "sent" ? "Geri bildirimin uygulandı; yeni sürümü inceleyebilirsin." : revisionStatus === "failed" ? "Geri bildirim uygulanamadı. Yazdıkların korundu; tekrar deneyebilirsin." : ""}</p>
        </> : <p>Aşağıdaki revizyon alanına istediğin değişikliği yazabilir veya prompt ayarlarını değiştirebilirsin.</p>}
      </details>
    </section>
  );
}
