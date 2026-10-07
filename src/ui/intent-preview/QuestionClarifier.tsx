"use client";

import { useRef, useState } from "react";
import type { ClarificationAnswer } from "@/models/prison";
import { clarificationMessage } from "@/ui/lib/clarification-answers";
import styles from "./IntentPreview.module.css";

export function QuestionClarifier({ questions, busy, onSubmit }: {
  questions: string[];
  busy: boolean;
  onSubmit: (clarifications: ClarificationAnswer[]) => Promise<boolean>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const sending = useRef(false);
  const result = clarificationMessage(questions, answers);
  return (
    <form className={styles.answerForm} onSubmit={async (event) => {
      event.preventDefault();
      if (busy || sending.current || !result.answered || result.tooLong) return;
      sending.current = true;
      try { if (await onSubmit(result.clarifications)) setAnswers({}); }
      finally { sending.current = false; }
    }}>
      <p className={styles.planHint}>Önce sonucu en çok etkileyen bilgileri netleştirelim. Bildiklerini yanıtla; diğerlerini boş bırakabilirsin.</p>
      {questions.map((question, index) => (
        <label className={styles.answerField} key={question}>
          <span>{index + 1}. {question}</span>
          <textarea rows={2} maxLength={1000} disabled={busy} placeholder="Yanıtını yaz…"
            value={Object.hasOwn(answers, question) ? answers[question] : ""}
            onChange={(event) => setAnswers((previous) => ({ ...previous, [question]: event.target.value }))} />
        </label>
      ))}
      {result.tooLong ? <p role="alert" className={styles.planHint}>Yanıtların çok uzun; biraz kısaltarak gönder.</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy || !result.answered || result.tooLong}>
        {busy ? "İşlem sürüyor…" : "Yanıtları işle ve planı güncelle"}
      </button>
      <p className={styles.planHint}>Yanıtların bu görevin hafızasına işlenir. Kalan önemli sorular güncel plana göre sorulur.</p>
    </form>
  );
}
