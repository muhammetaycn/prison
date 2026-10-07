"use client";

import { useEffect, useRef, useState } from "react";
import type { ConcreteTarget } from "@/models/common";
import type { ExecutionContext } from "@/models/options";
import { TARGET_LABELS } from "@/templates/ui-labels";
import { useI18n } from "@/ui/i18n";
import { ExecutionGuide } from "./ExecutionGuide";
import { useHandoffTask } from "./HandoffTaskContext";
import { copyPrompt, downloadPrompt } from "./prompt-transfer";
import styles from "./PromptHandoff.module.css";

interface PromptHandoffProps {
  text: string;
  version: number;
  target: ConcreteTarget;
  context: ExecutionContext;
  active: boolean;
  busy: boolean;
  onRevise?: (feedback: string) => Promise<boolean>;
  goal?: string;
  rawRequest?: string;
  taskType?: string;
  deliverables?: string[];
  successCriteria?: string[];
}

export function PromptHandoff({ text, version, target, context, active, busy, onRevise, goal, rawRequest, taskType, deliverables, successCriteria }: PromptHandoffProps) {
  const { t } = useI18n();
  const task = useHandoffTask();
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
    <section className={styles.root} aria-label={t("Promptu kullan ve geliştir", "Use and improve your prompt", "使用并完善提示词")}>
      <div className={styles.heading}>
        <div><span className={styles.eyebrow}>{t("Sıradaki adım sende", "Your next step", "下一步由你开始")}</span><h3>{t(`v${version} promptunu ${TARGET_LABELS[target]} ile dene`, `Try the v${version} prompt with ${TARGET_LABELS[target]}`, `在 ${TARGET_LABELS[target]} 中尝试 v${version} 提示词`)}</h3></div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary" disabled={copyStatus === "copying" || !text} onClick={() => void copy()}>{copyStatus === "copied" ? t("Kopyalandı", "Copied", "已复制") : copyStatus === "copying" ? t("Kopyalanıyor", "Copying", "正在复制") : t("Tam promptu kopyala", "Copy full prompt", "复制完整提示词")}</button>
          <button type="button" className="btn" disabled={!text} onClick={() => setExportStatus(downloadPrompt(text, version, target) ? "started" : "failed")}>{t(".txt indir", "Download .txt", "下载 .txt")}</button>
        </div>
      </div>
      <p className={styles.instruction}>{t("Kopyaladığın promptun tamamını tek mesaj olarak yapıştır. Görevin için gereken dosya veya bağlamı ekle. Aşağıdaki rehber, seçtiğin araçta sonraki adımı gösterir.", "Paste the entire copied prompt as one message and add the files or context your task needs. The guide below shows the next step in your selected tool.", "将完整提示词作为一条消息粘贴，并添加任务所需的文件或背景。下方指南展示所选工具中的下一步。")}</p>
      <p className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {copyStatus === "failed" ? t("Kopyalanamadı. Prompt metnini seçerek elle kopyalayabilirsin.", "Copy failed. You can select the prompt text and copy it manually.", "复制失败。可以选中提示词文本后手动复制。") : copyStatus === "copied" ? t(`v${version} promptunun tamamı panoya kopyalandı.`, `The full v${version} prompt was copied to the clipboard.`, `v${version} 完整提示词已复制到剪贴板。`) : ""}
        {exportStatus === "started" ? t(" İndirme başlatıldı.", " Download started.", " 已开始下载。") : exportStatus === "failed" ? t(" İndirme başlatılamadı; kopyalama seçeneğini kullanabilirsin.", " Download could not start; you can use the copy option.", " 无法开始下载；可以使用复制功能。") : ""}
      </p>
      <ExecutionGuide key={`${version}:${target}:${context}`} target={target} context={context} goal={goal ?? task?.goal} rawRequest={rawRequest ?? task?.rawRequest} taskType={taskType ?? task?.taskType} deliverables={deliverables ?? task?.deliverables} successCriteria={successCriteria ?? task?.successCriteria} />
      <details className={styles.feedback}>
        <summary>{t("Denedin mi? Sonucu birlikte iyileştirelim", "Tried it? Improve the result together", "试过了吗？一起改进结果")}</summary>
        <p>{t("Hangi kısmı işe yaradı, nerede hedefinden saptı? İstediğin değişikliği yaz. Bu, sonraki promptun gerçek talimatı olur.", "What worked, and where did it miss your goal? Describe the change you want; it becomes an actual instruction for the next prompt.", "哪些部分有效，哪里偏离了目标？描述希望的修改，它将成为下一个提示词的实际指令。")}</p>
        {onRevise ? <>
          <label className={styles.feedbackLabel}>{t("Sonraki sürüm için geri bildirimin", "Your feedback for the next version", "对下一版本的反馈")}
            <textarea value={feedback} maxLength={2000} onChange={(event) => { setFeedback(event.target.value); setRevisionStatus("idle"); }} placeholder={t("Örnek: Yanıt çok genel kaldı. Benim verdiğim verilerden 3 somut öneri çıkarmasını iste.", "Example: The answer was too general. Ask for 3 concrete recommendations based on my data.", "例如：回答太笼统。要求根据我提供的数据给出 3 条具体建议。")} disabled={busy || revisionStatus === "sending" || !active} />
          </label>
          {!active ? <p>{t("Önce bu sürüme dön veya aktif promptu seç; geri bildirimin aktif sürümü değiştirecek.", "Restore this version or select the active prompt first; feedback changes the active version.", "请先恢复此版本或选择当前提示词；反馈将修改当前版本。")}</p> : null}
          <div className={styles.feedbackFoot}>
            <span>{feedback.length}/2000</span>
            <button type="button" className="btn" onClick={() => void revise()} disabled={!active || busy || revisionStatus === "sending" || feedback.trim().length < 2}>{revisionStatus === "sending" ? t("Yeni sürüm hazırlanıyor", "Preparing the new version", "正在准备新版本") : t("Geri bildirimle yeni sürüm üret", "Generate a new version with feedback", "根据反馈生成新版本")}</button>
          </div>
          <p role="status" aria-live="polite">{revisionStatus === "sent" ? t("Geri bildirimin uygulandı; yeni sürümü inceleyebilirsin.", "Your feedback was applied; you can review the new version.", "反馈已应用，可以检查新版本。") : revisionStatus === "failed" ? t("Geri bildirim uygulanamadı. Yazdıkların korundu; tekrar deneyebilirsin.", "Feedback could not be applied. Your text is preserved; you can retry.", "无法应用反馈。已保留输入，可以重试。") : ""}</p>
        </> : <p>{t("Aşağıdaki revizyon alanına istediğin değişikliği yazabilir veya prompt ayarlarını değiştirebilirsin.", "Use the revision area below to describe the change or adjust the prompt settings.", "可以在下方修订区说明改动，或调整提示词设置。")}</p>}
      </details>
    </section>
  );
}
