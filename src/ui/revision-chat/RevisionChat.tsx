"use client";

import { useEffect, useRef, useState } from "react";
import type { RevisionRecord } from "@/models/prison";
import { cx, relativeTime } from "@/ui/lib/format";
import styles from "./RevisionChat.module.css";

const SUGGESTIONS = [
  "Bunu daha katı yap.",
  "Canlı deploy yapmasına izin verme.",
  "Claude için üret.",
  "Mevcut mimariyi değiştirmesin.",
];

const MAX_LENGTH = 2000;

interface RevisionChatProps {
  revisions: RevisionRecord[];
  busy: boolean;
  onSubmit: (message: string) => Promise<boolean>;
  onViewVersion: (version: number) => void;
  hasPrompt?: boolean;
}

export function RevisionChat({ revisions, busy, onSubmit, onViewVersion, hasPrompt = true }: RevisionChatProps) {
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
    <section className={styles.root} aria-label="Revizyon">
      <header className={styles.header}>
        <span className="label">{hasPrompt ? "Revizyon" : "Bilgileri netleştir"}</span>
        <span className={styles.hint}>{hasPrompt ? "İsteğini ve promptu güncelle." : "Soruları yanıtla ya da görevi düzelt."}</span>
      </header>

      {userRevisions.length ? (
        <ol className={styles.thread} ref={listRef}>
          {userRevisions.map((revision) => (
            <li key={revision.id} className={styles.entry}>
              <div className={styles.message}>{revision.clarifications?.length ? revision.clarifications.map((entry, index) => (
                <div key={`${index}:${entry.question}`}>
                  <p>Sistem sorusu: {entry.question}</p>
                  <p><strong>Yanıtın:</strong> {entry.answer}</p>
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
                  {revision.engine === "local" ? "yerel motor · " : ""}
                  {relativeTime(revision.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.suggestions}>
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={cx("chip", styles.suggestion)}
            onClick={() => void send(suggestion)}
            disabled={busy}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          value={draft}
          maxLength={MAX_LENGTH}
          rows={2}
          placeholder={hasPrompt ? "Promptu nasıl değiştireyim? (ör. 'Testleri zorunlu kıl.')" : "Eksik bilgileri ya da istek düzeltmesini yaz."}
          aria-label="Revizyon mesajı"
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
          {hasPrompt ? "Uygula" : "Bilgileri güncelle"}
        </button>
      </div>
    </section>
  );
}
