"use client";

import type { PrisonStatus } from "@/models/prison";
import { cx } from "@/ui/lib/format";
import { useI18n } from "@/ui/i18n";
import styles from "./StatusPipeline.module.css";

/** The prison lifecycle, collapsed into the stages a user cares about. */
const STAGES: Array<{ label: string; lang?: "en"; statuses: PrisonStatus[] }> = [
  { label: "Intent", lang: "en", statuses: ["RAW_REQUEST", "INTENT_PARSED"] },
  { label: "Prison", lang: "en", statuses: ["PRISON_CREATED"] },
  { label: "Gereksinimler", statuses: ["REQUIREMENTS_RESOLVED", "READY_FOR_COMPILE", "USER_REVISION", "PRISON_UPDATED"] },
  { label: "Derleme", statuses: ["PROMPT_COMPILED", "PROMPT_RECOMPILED"] },
  { label: "Kontrol", statuses: ["PROMPT_VALIDATED"] },
  { label: "Hazır", statuses: ["READY"] },
];

interface StatusPipelineProps {
  status: PrisonStatus;
  /** Index of a stage currently being processed (client-side busy indicator). */
  activeStage?: number | null;
}

export function StatusPipeline({ status, activeStage = null }: StatusPipelineProps) {
  const { locale, t } = useI18n();
  const labels = [
    t("Intent", "Intent", "意图"), t("Prison", "Task", "任务"),
    t("Gereksinimler", "Requirements", "需求"), t("Derleme", "Generation", "生成"),
    t("Kontrol", "Review", "检查"), t("Hazır", "Ready", "就绪"),
  ];
  const reached = STAGES.findIndex((stage) => stage.statuses.includes(status));
  return (
    <ol className={styles.root} aria-label={t("Prison durumu", "Task status", "任务状态")}>
      {STAGES.map((stage, index) => {
        const working = activeStage !== null && index === activeStage;
        const done = activeStage !== null ? index < activeStage : index <= reached;
        return (
          <li key={stage.label} className={cx(styles.stage, done && styles.done, working && styles.working)}>
            <span className={styles.dot} aria-hidden />
            <span className={styles.name} lang={locale === "tr" ? stage.lang : undefined}>
              {labels[index]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export const PIPELINE_STAGE = { intent: 0, requirements: 2, compile: 3 } as const;
