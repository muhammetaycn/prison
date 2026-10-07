"use client";

import { useRef, useState } from "react";
import type { ClarificationAnswer } from "@/models/prison";
import { clarificationMessage } from "@/ui/lib/clarification-answers";
import { useI18n } from "@/ui/i18n";
import styles from "./IntentPreview.module.css";

export function QuestionClarifier({ questions, busy, onSubmit }: {
  questions: string[];
  busy: boolean;
  onSubmit: (clarifications: ClarificationAnswer[]) => Promise<boolean>;
}) {
  const { t } = useI18n();
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
      <p className={styles.planHint}>{t("Önce sonucu en çok etkileyen bilgileri netleştirelim. Bildiklerini yanıtla; diğerlerini boş bırakabilirsin.", "Let's clarify what matters most to the result. Answer what you know; you can leave the rest blank.", "先明确最影响结果的信息。回答你知道的部分，其他部分可以留空。")}</p>
      {questions.map((question, index) => (
        <label className={styles.answerField} key={question}>
          <span>{index + 1}. {question}</span>
          <textarea rows={2} maxLength={1000} disabled={busy} placeholder={t("Yanıtını yaz…", "Write your answer…", "输入你的回答…")}
            value={Object.hasOwn(answers, question) ? answers[question] : ""}
            onChange={(event) => setAnswers((previous) => ({ ...previous, [question]: event.target.value }))} />
        </label>
      ))}
      {result.tooLong ? <p role="alert" className={styles.planHint}>{t("Yanıtların çok uzun; biraz kısaltarak gönder.", "Your answers are too long; shorten them before sending.", "回答过长，请缩短后再提交。")}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={busy || !result.answered || result.tooLong}>
        {busy ? t("İşlem sürüyor…", "Working…", "正在处理…") : t("Yanıtları işle ve planı güncelle", "Apply answers and update the plan", "应用回答并更新方案")}
      </button>
      <p className={styles.planHint}>{t("Yanıtların bu görevin hafızasına işlenir. Kalan önemli sorular güncel plana göre sorulur.", "Your answers become part of this task. Remaining questions follow the updated plan.", "你的回答将保存在此任务中。后续问题将依据更新后的方案提出。")}</p>
    </form>
  );
}
