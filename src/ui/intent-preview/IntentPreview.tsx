"use client";

import type { ClarificationAnswer, ResolvedPrison } from "@/models/prison";
import type { ItemListKey, SpecItem } from "@/models/spec";
import { getTaskType } from "@/core/task-types/registry";
import {
  DEPLOYMENT_LABELS,
  LIST_LABELS,
  MEMORY_KIND_LABELS,
  OPERATION_LABELS,
  SOURCE_LABELS,
  TARGET_LABELS,
} from "@/templates/ui-labels";
import { cx } from "@/ui/lib/format";
import { previewTarget } from "@/ui/lib/target";
import styles from "./IntentPreview.module.css";
import { QuestionClarifier } from "./QuestionClarifier";

/** Order of the list sections in "Seni şöyle anladım". */
const SECTIONS: Array<{ list: ItemListKey; tone?: "warn" | "danger" }> = [
  { list: "protectedElements" },
  { list: "requiredActions" },
  { list: "requirements" },
  { list: "constraints" },
  { list: "disallowedOperations" },
  { list: "allowedOperations" },
  { list: "assumptions", tone: "warn" },
  { list: "unknowns", tone: "warn" },
  { list: "conflicts", tone: "danger" },
  { list: "successCriteria" },
  { list: "contextFacts" },
];

interface PlanStep {
  action: string;
  purpose: string;
  verification: string;
}

function PlanSteps({ steps, start = 1 }: { steps: PlanStep[]; start?: number }) {
  return (
    <ol className={styles.planSteps} start={start}>
      {steps.map((step, i) => (
        <li key={`${start + i}:${step.action}`}>
          <strong>{step.action}</strong>
          {step.purpose ? <p>{step.purpose}</p> : null}
          {step.verification ? <span className={styles.stepCheck}>Kontrol: {step.verification}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function ItemList({ items }: { items: SpecItem[] }) {
  return (
    <ul className={styles.items}>
      {items.map((item) => (
        <li key={item.id} className={styles.item}>
          <span className={styles.itemText}>{item.text}</span>
          {item.source !== "explicit" ? (
            <span className={cx(styles.source, styles[`source_${item.source}`])}>{SOURCE_LABELS[item.source]}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface IntentPreviewProps {
  prison: ResolvedPrison;
  busy?: boolean;
  onClarify?: (clarifications: ClarificationAnswer[]) => Promise<boolean>;
}

export function IntentPreview({ prison, busy = false, onClarify }: IntentPreviewProps) {
  const { spec } = prison;
  const taskType = getTaskType(spec.taskType);
  const target = previewTarget(prison);
  const plan = spec.taskPlan;
  const steps = plan?.steps.length ? plan.steps : spec.requiredActions.map((item) => ({ action: item.text, purpose: "", verification: "" }));
  const questions = [...new Set(plan ? plan.clarifyingQuestions : spec.unknowns.map((item) => item.text))];
  const targetExplanation = target.reason === "user_selected"
    ? "Prompt, seçtiğin AI için hazırlanacak."
    : target.reason === "request_mentioned"
    ? "İsteğinde belirttiğin AI esas alındı."
    : target.reason === "coding_existing"
    ? "Mevcut proje üzerinde kod çalışması gerektiği için Codex seçildi."
    : target.reason === "ai_recommendation"
    ? "Görev planındaki AI önerisi esas alındı."
    : `${taskType.label.tr} görevinin özelliklerine göre seçildi.`;
  const memory = prison.taskMemory.filter((m) => m.active);
  const flags = [
    spec.flags.existingSystem && "Mevcut sistem",
    spec.flags.newSystem && "Yeni sistem",
    spec.flags.preserveArchitecture && "Mimari korunmalı",
    spec.flags.codingRequired && "Kod gerekiyor",
    spec.flags.researchRequired && "Araştırma",
    spec.flags.adviceOnly && "Yalnızca öneri",
    spec.flags.visualGenerationRequired && "Görsel üretim",
    `Deploy: ${DEPLOYMENT_LABELS[spec.deploymentPermission]}`,
  ].filter((f): f is string => Boolean(f));

  return (
    <section className={styles.root} aria-labelledby="understanding-title">
      <header className={styles.header}>
        <span className="label">İstek analizi</span>
        <h2 id="understanding-title" className={styles.title}>
          Seni şöyle anladım
        </h2>
      </header>

      <div className={styles.block}>
        <span className={styles.key}>Amaç</span>
        <p className={styles.goal}>{spec.primaryGoal}</p>
        {spec.secondaryGoals.length ? <ItemList items={spec.secondaryGoals} /> : null}
      </div>

      <div className={styles.routing}>
        <span className={styles.key}>Promptun hazırlanacağı AI</span>
        <div className={styles.targetHeading}>
          <strong>{TARGET_LABELS[target.target]}</strong>
          {prison.targetAI === "auto" ? <span className="chip">Otomatik seçim</span> : <span className="chip">Senin seçimin</span>}
        </div>
        <p className={styles.text}>{targetExplanation}</p>
        {plan?.targetRationale ? (
          <div className={styles.targetRationale}>
            <span className={styles.key}>
              {plan.recommendedTarget === target.target ? "Göreve uygunluk gerekçesi" : `Analizin önerisi: ${TARGET_LABELS[plan.recommendedTarget]}`}
            </span>
            <p className={styles.text}>{plan.targetRationale}</p>
          </div>
        ) : null}
      </div>

      <div className={styles.plan}>
        <h3 className={styles.sectionTitle}>Görev planı</h3>
        {plan?.approach ? <p className={styles.text}>{plan.approach}</p> : <p className={styles.planHint}>Kaydedilmiş görev adımları gösteriliyor; bu sürümde ayrıntılı yaklaşım bulunmuyor.</p>}
        {steps.length ? <PlanSteps steps={steps.slice(0, 4)} /> : <p className={styles.text}>Henüz görev adımı tanımlanmadı. Revizyon alanında beklediğin sonucu netleştirebilirsin.</p>}
        {steps.length > 4 ? (
          <details className={styles.moreSteps}>
            <summary>{steps.length - 4} adım daha</summary>
            <PlanSteps steps={steps.slice(4)} start={5} />
          </details>
        ) : null}
      </div>

      {questions.length ? (
        <div className={styles.questions}>
          <h3 className={styles.sectionTitle}>Netleştirilecek bilgiler</h3>
          {onClarify ? <QuestionClarifier key={prison.id} questions={questions.slice(0, 3)} busy={busy} onSubmit={onClarify} /> : <ul className={styles.questionList}>
            {questions.slice(0, 3).map((question, i) => <li key={`${i}:${question}`}>{question}</li>)}
          </ul>}
          {questions.length > 3 ? (
            <details className={styles.moreSteps}>
              <summary>{questions.length - 3} bilgi daha</summary>
              <ul className={styles.questionList}>{questions.slice(3).map((question, i) => <li key={`${i}:${question}`}>{question}</li>)}</ul>
            </details>
          ) : null}
          <p className={styles.planHint}>Yanıtlayabildiğin bilgileri revizyon alanına yazarak promptu netleştirebilirsin.</p>
        </div>
      ) : null}

      <dl className={styles.facts}>
        <div>
          <dt className={styles.key}>Görev türü</dt>
          <dd>
            {taskType.label.tr}
            {spec.secondaryTaskTypes.length ? (
              <span className={styles.secondary}>
                {" "}
                + {spec.secondaryTaskTypes.map((id) => getTaskType(id).label.tr).join(", ")}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className={styles.key}>Operasyon</dt>
          <dd>{OPERATION_LABELS[spec.operation]}</dd>
        </div>
        {spec.domain ? (
          <div>
            <dt className={styles.key}>Alan</dt>
            <dd>{spec.domain}</dd>
          </div>
        ) : null}
      </dl>

      <div className={styles.flags}>
        {flags.map((flag) => (
          <span key={flag} className="chip">
            {flag}
          </span>
        ))}
      </div>

      {spec.contextSummary ? (
        <div className={styles.block}>
          <span className={styles.key}>Bağlam</span>
          <p className={styles.text}>{spec.contextSummary}</p>
        </div>
      ) : null}

      {spec.assumptions.length ? (
        <div className={cx(styles.block, styles.warn)}>
          <span className={styles.key}>Varsayımlar · doğrulanmış bilgi değildir</span>
          <ItemList items={spec.assumptions.slice(0, 3)} />
        </div>
      ) : null}

      <details className={styles.stateDetails}>
        <summary>Gereksinimler, sınırlar ve kontrol ölçütleri</summary>
        <div className={styles.stateContent}>
          {SECTIONS.map(({ list, tone }) =>
            spec[list].length ? (
              <div key={list} className={cx(styles.block, tone && styles[tone])}>
                <span className={styles.key}>{LIST_LABELS[list].plural}</span>
                <ItemList items={spec[list]} />
              </div>
            ) : null,
          )}
        </div>
      </details>

      {memory.length ? (
        <div className={cx(styles.block, styles.memory)}>
          <span className={styles.key}>Görev hafızası</span>
          <ul className={styles.items}>
            {memory.map((entry) => (
              <li key={entry.id} className={styles.item}>
                <span className={styles.itemText}>{entry.directive}</span>
                <span className={styles.source}>{MEMORY_KIND_LABELS[entry.kind]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className={styles.footer}>
        <span className="mono">{prison.id}</span>
        <span>
          Analiz: {prison.engine.mode === "ai" ? `${prison.engine.provider} · ${prison.engine.model}` : "yerel motor"}
        </span>
      </footer>
    </section>
  );
}
