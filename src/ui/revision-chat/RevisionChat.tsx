"use client";

import { useEffect, useRef, useState } from "react";
import type { RevisionRecord } from "@/models/prison";
import { useI18n } from "@/ui/i18n";
import { cx, relativeTime } from "@/ui/lib/format";
import styles from "./RevisionChat.module.css";

const SUGGESTIONS = [
  ["Bunu daha katı yap.", "Make this stricter.", "让要求更严格。"],
  ["Canlı deploy yapmasına izin verme.", "Do not allow deployment to production.", "禁止部署到生产环境。"],
  ["Claude için üret.", "Generate this for Claude.", "为 Claude 生成。"],
  ["Mevcut mimariyi değiştirmesin.", "Keep the existing architecture.", "保留现有架构。"],
] as const;

const MAX_LENGTH = 2000;

interface RevisionChatProps {
  revisions: RevisionRecord[];
  busy: boolean;
  onSubmit: (message: string) => Promise<boolean>;
  onViewVersion: (version: number) => void;
  hasPrompt?: boolean;
}

export function RevisionChat({ revisions, busy, onSubmit, onViewVersion, hasPrompt = true }: RevisionChatProps) {
  const { locale, t } = useI18n();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const userRevisions = revisions.filter((r) => r.engine !== "modifier");

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [userRevisions.length]);

  const send = async (message: string) => {
    const text = message.trim();
    if (text.length < 2 || busy) return;
    if (await onSubmit(text)) setDraft("");
  };

  return (
    <section className={styles.root} aria-label={t("Revizyon", "Revision", "修订")}>
      <header className={styles.header}>
        <span className="label">{hasPrompt ? t("Revizyon", "Revision", "修订") : t("Bilgileri netleştir", "Clarify the details", "澄清信息")}</span>
        <span className={styles.hint}>{hasPrompt ? t("İsteğini ve promptu güncelle.", "Update your request and prompt.", "更新需求和提示词。") : t("Soruları yanıtla ya da görevi düzelt.", "Answer the questions or adjust your task.", "回答问题或调整任务。")}</span>
      </header>

      {userRevisions.length ? (
        <ol className={styles.thread} ref={listRef}>
          {userRevisions.map((revision) => (
            <li key={revision.id} className={styles.entry}>
              <div className={styles.message}>{revision.clarifications?.length ? revision.clarifications.map((entry, index) => (
                <div key={`${index}:${entry.question}`}>
                  <p>{t("Sistem sorusu:", "System question:", "系统问题：")} {entry.question}</p>
                  <p><strong>{t("Yanıtın:", "Your answer:", "你的回答：")}</strong> {entry.answer}</p>
                </div>
              )) : revision.message}</div>
              <div className={styles.reply}>
                <div className={styles.replyHead}>
                  <span className={styles.replyTitle}>{revision.summary}</span>
                  {revision.resultVersion ? (
                    <button
                      type="button"
                      className={styles.versionLink}
                      onClick={() => onViewVersion(revision.resultVersion!)}
                      aria-label={t(`Sürüm ${revision.resultVersion} göster`, `Show version ${revision.resultVersion}`, `查看版本 ${revision.resultVersion}`)}
                    >
                      → v{revision.resultVersion}
                    </button>
                  ) : null}
                </div>
                {revision.changes.length ? (
                  <ul className={styles.changes}>
                    {revision.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                ) : null}
                <span className={styles.time}>
                  {revision.engine === "local" ? t("yerel motor · ", "local engine · ", "本地引擎 · ") : ""}
                  {relativeTime(revision.createdAt, Date.now(), locale)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.suggestions}>
        {SUGGESTIONS.map((copy) => {
          const suggestion = t(copy[0], copy[1], copy[2]);
          return (
          <button
            key={suggestion}
            type="button"
            className={cx("chip", styles.suggestion)}
            onClick={() => void send(suggestion)}
            disabled={busy}
          >
            {suggestion}
          </button>
          );
        })}
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          value={draft}
          maxLength={MAX_LENGTH}
          rows={2}
          placeholder={hasPrompt ? t("Promptu nasıl değiştireyim? (ör. 'Testleri zorunlu kıl.')", "How should the prompt change? (e.g. 'Require tests.')", "如何修改提示词？（例如：必须执行测试。）") : t("Eksik bilgileri ya da istek düzeltmesini yaz.", "Add missing details or correct your request.", "补充缺失信息或修改需求。")}
          aria-label={t("Revizyon mesajı", "Revision message", "修订消息")}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <button
          type="button"
          className={`btn ${styles.send}`}
          onClick={() => void send(draft)}
          disabled={busy || draft.trim().length < 2}
        >
          {busy ? <span className="spinner" aria-hidden /> : null}
          {hasPrompt ? t("Uygula", "Apply", "应用") : t("Bilgileri güncelle", "Update details", "更新信息")}
        </button>
      </div>
    </section>
  );
}
