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
import { useI18n } from "@/ui/i18n";
import { useVocabulary } from "@/ui/i18n/vocabulary";
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
  const { t } = useI18n();
  return (
    <ol className={styles.planSteps} start={start}>
      {steps.map((step, i) => (
        <li key={`${start + i}:${step.action}`}>
          <strong>{step.action}</strong>
          {step.purpose ? <p>{step.purpose}</p> : null}
          {step.verification ? <span className={styles.stepCheck}>{t("Kontrol", "Check", "验证")}: {step.verification}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function ItemList({ items }: { items: SpecItem[] }) {
  const label = useVocabulary();
  return (
    <ul className={styles.items}>
      {items.map((item) => (
        <li key={item.id} className={styles.item}>
          <span className={styles.itemText}>{item.text}</span>
          {item.source !== "explicit" ? (
            <span className={cx(styles.source, styles[`source_${item.source}`])}>{label(SOURCE_LABELS[item.source])}</span>
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
  const { locale, t } = useI18n();
  const label = useVocabulary();
  const taskLabel = (id: string) => (getTaskType(id).label as Partial<Record<string, string>>)[locale] ?? getTaskType(id).label.en;
  const { spec } = prison;
  const target = previewTarget(prison);
  const plan = spec.taskPlan;
  const steps = plan?.steps.length ? plan.steps : spec.requiredActions.map((item) => ({ action: item.text, purpose: "", verification: "" }));
  const questions = [...new Set(plan ? plan.clarifyingQuestions : spec.unknowns.map((item) => item.text))];
  const targetExplanation = target.reason === "user_selected"
    ? t("Prompt, seçtiğin AI için hazırlanacak.", "The prompt will be tailored to your chosen AI.", "提示词将针对你选择的 AI 进行优化。")
    : target.reason === "request_mentioned"
    ? t("İsteğinde belirttiğin AI esas alındı.", "Using the AI named in your request.", "采用你在请求中指定的 AI。")
    : target.reason === "coding_existing"
    ? t("Mevcut proje üzerinde kod çalışması gerektiği için Codex seçildi.", "Codex was chosen for work on your existing code project.", "因为需要修改现有代码项目，所以选择了 Codex。")
    : target.reason === "ai_recommendation"
    ? t("Görev planındaki AI önerisi esas alındı.", "Using the AI recommended in the task plan.", "采用任务方案中推荐的 AI。")
    : t(`${taskLabel(spec.taskType)} görevinin özelliklerine göre seçildi.`, `Chosen for the needs of your ${taskLabel(spec.taskType)} task.`, `根据“${taskLabel(spec.taskType)}”任务的需求选择。`);
  const memory = prison.taskMemory.filter((m) => m.active);
  const flags = [
    spec.flags.existingSystem && t("Mevcut sistem", "Existing system", "现有系统"),
    spec.flags.newSystem && t("Yeni sistem", "New system", "新系统"),
    spec.flags.preserveArchitecture && t("Mimari korunmalı", "Preserve architecture", "保留架构"),
    spec.flags.codingRequired && t("Kod gerekiyor", "Coding required", "需要编写代码"),
    spec.flags.researchRequired && label("Araştırma"),
    spec.flags.adviceOnly && label("Yalnızca öneri"),
    spec.flags.visualGenerationRequired && t("Görsel üretim", "Visual creation", "视觉创作"),
    `${t("Yayınlama", "Deployment", "发布")}: ${label(DEPLOYMENT_LABELS[spec.deploymentPermission])}`,
  ].filter((f): f is string => Boolean(f));

  return (
    <section className={styles.root} aria-labelledby="understanding-title">
      <header className={styles.header}>
        <span className="label">{t("İstek analizi", "Request analysis", "请求分析")}</span>
        <h2 id="understanding-title" className={styles.title}>
          {t("Seni şöyle anladım", "Here's how I understood your request", "这是对你请求的理解")}
        </h2>
      </header>

      <div className={styles.block}>
        <span className={styles.key}>{t("Amaç", "Goal", "目标")}</span>
        <p className={styles.goal}>{spec.primaryGoal}</p>
        {spec.secondaryGoals.length ? <ItemList items={spec.secondaryGoals} /> : null}
      </div>

      <div className={styles.routing}>
        <span className={styles.key}>{t("Promptun hazırlanacağı AI", "AI this prompt is for", "提示词的目标 AI")}</span>
        <div className={styles.targetHeading}>
          <strong>{TARGET_LABELS[target.target]}</strong>
          <span className="chip">{prison.targetAI === "auto" ? t("Otomatik seçim", "Automatic choice", "自动选择") : t("Senin seçimin", "Your choice", "你的选择")}</span>
        </div>
        <p className={styles.text}>{targetExplanation}</p>
        {plan?.targetRationale ? (
          <div className={styles.targetRationale}>
            <span className={styles.key}>
              {plan.recommendedTarget === target.target ? t("Göreve uygunluk gerekçesi", "Why it fits this task", "适合此任务的原因") : t(`Analizin önerisi: ${TARGET_LABELS[plan.recommendedTarget]}`, `Suggested by analysis: ${TARGET_LABELS[plan.recommendedTarget]}`, `分析推荐：${TARGET_LABELS[plan.recommendedTarget]}`)}
            </span>
            <p className={styles.text}>{plan.targetRationale}</p>
          </div>
        ) : null}
      </div>

      <div className={styles.plan}>
        <h3 className={styles.sectionTitle}>{t("Görev planı", "Task plan", "任务方案")}</h3>
        {plan?.approach ? <p className={styles.text}>{plan.approach}</p> : <p className={styles.planHint}>{t("Kaydedilmiş görev adımları gösteriliyor; bu sürümde ayrıntılı yaklaşım bulunmuyor.", "Showing the saved steps; this version has no detailed approach.", "显示已保存的步骤；此版本没有详细方案。")}</p>}
        {steps.length ? <PlanSteps steps={steps.slice(0, 4)} /> : <p className={styles.text}>{t("Henüz görev adımı tanımlanmadı. Revizyon alanında beklediğin sonucu netleştirebilirsin.", "No task steps yet. Clarify the result you want in the revision area.", "尚未定义任务步骤。请在修改区域说明你期望的结果。")}</p>}
        {steps.length > 4 ? (
          <details className={styles.moreSteps}>
            <summary>{t(`${steps.length - 4} adım daha`, `${steps.length - 4} more steps`, `还有 ${steps.length - 4} 个步骤`)}</summary>
            <PlanSteps steps={steps.slice(4)} start={5} />
          </details>
        ) : null}
      </div>

      {questions.length ? (
        <div className={styles.questions}>
          <h3 className={styles.sectionTitle}>{t("Netleştirilecek bilgiler", "Information to clarify", "需要明确的信息")}</h3>
          {onClarify ? <QuestionClarifier key={prison.id} questions={questions.slice(0, 3)} busy={busy} onSubmit={onClarify} /> : <ul className={styles.questionList}>
            {questions.slice(0, 3).map((question, i) => <li key={`${i}:${question}`}>{question}</li>)}
          </ul>}
          {questions.length > 3 ? (
            <details className={styles.moreSteps}>
              <summary>{t(`${questions.length - 3} bilgi daha`, `${questions.length - 3} more questions`, `还有 ${questions.length - 3} 个问题`)}</summary>
              <ul className={styles.questionList}>{questions.slice(3).map((question, i) => <li key={`${i}:${question}`}>{question}</li>)}</ul>
            </details>
          ) : null}
          <p className={styles.planHint}>{t("Yanıtlayabildiğin bilgileri revizyon alanına yazarak promptu netleştirebilirsin.", "Add what you know in the revision area to refine the prompt.", "在修改区域补充你知道的信息，以完善提示词。")}</p>
        </div>
      ) : null}

      <dl className={styles.facts}>
        <div>
          <dt className={styles.key}>{t("Görev türü", "Task type", "任务类型")}</dt>
          <dd>
            {taskLabel(spec.taskType)}
            {spec.secondaryTaskTypes.length ? (
              <span className={styles.secondary}>
                {" "}
                + {spec.secondaryTaskTypes.map(taskLabel).join(", ")}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className={styles.key}>{t("Operasyon", "Operation", "操作")}</dt>
          <dd>{label(OPERATION_LABELS[spec.operation])}</dd>
        </div>
        {spec.domain ? (
          <div>
            <dt className={styles.key}>{t("Alan", "Domain", "领域")}</dt>
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
          <span className={styles.key}>{t("Bağlam", "Context", "背景")}</span>
          <p className={styles.text}>{spec.contextSummary}</p>
        </div>
      ) : null}

      {spec.assumptions.length ? (
        <div className={cx(styles.block, styles.warn)}>
          <span className={styles.key}>{t("Varsayımlar · doğrulanmış bilgi değildir", "Assumptions · not verified facts", "假设 · 非已验证信息")}</span>
          <ItemList items={spec.assumptions.slice(0, 3)} />
        </div>
      ) : null}

      <details className={styles.stateDetails}>
        <summary>{t("Gereksinimler, sınırlar ve kontrol ölçütleri", "Requirements, constraints and checks", "需求、限制与检查标准")}</summary>
        <div className={styles.stateContent}>
          {SECTIONS.map(({ list, tone }) =>
            spec[list].length ? (
              <div key={list} className={cx(styles.block, tone && styles[tone])}>
                <span className={styles.key}>{label(LIST_LABELS[list].plural)}</span>
                <ItemList items={spec[list]} />
              </div>
            ) : null,
          )}
        </div>
      </details>

      {memory.length ? (
        <div className={cx(styles.block, styles.memory)}>
          <span className={styles.key}>{t("Görev hafızası", "Task memory", "任务记忆")}</span>
          <ul className={styles.items}>
            {memory.map((entry) => (
              <li key={entry.id} className={styles.item}>
                <span className={styles.itemText}>{entry.directive}</span>
                <span className={styles.source}>{label(MEMORY_KIND_LABELS[entry.kind])}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className={styles.footer}>
        <span className="mono">{prison.id}</span>
        <span>
          {t("Analiz", "Analysis", "分析")}: {prison.engine.mode === "ai" ? `${prison.engine.provider} · ${prison.engine.model}` : t("yerel motor", "local engine", "本地引擎")}
        </span>
      </footer>
    </section>
  );
}
