"use client";

import type { TargetAI } from "@/models/common";
import { useEffect, useState } from "react";
import type { CompileOptions, CouncilMode, ExecutionContext, ModifierAction } from "@/models/options";
import { isResolved, type ClarificationAnswer, type Prison } from "@/models/prison";
import { STATUS_LABELS, TARGET_LABELS, TARGET_REASON_LABELS } from "@/templates/ui-labels";
import { previewTarget } from "@/ui/lib/target";
import { PIPELINE_STAGE, StatusPipeline } from "@/ui/common/StatusPipeline";
import { ExecutionContextPicker } from "@/ui/common/ExecutionContextPicker";
import { CouncilModePicker } from "@/ui/common/CouncilModePicker";
import { IntentPreview } from "@/ui/intent-preview/IntentPreview";
import { PromptOutput } from "@/ui/prompt-output/PromptOutput";
import { RevisionChat } from "@/ui/revision-chat/RevisionChat";
import type { BusyState } from "@/ui/PrisonApp";
import type { PrisonOperation } from "@/models/operation";
import type { CouncilProgress } from "@/ui/lib/api";
import { CouncilProgressPanel } from "@/ui/common/CouncilProgressPanel";
import { CouncilArena } from "@/ui/council-arena/CouncilArena";
import { replayEvents } from "@/ui/council-arena/timeline";
import { useI18n } from "@/ui/i18n";
import { useVocabulary } from "@/ui/i18n/vocabulary";
import styles from "./PrisonView.module.css";

interface PrisonViewProps {
  prison: Prison;
  busy: BusyState | null;
  progress?: CouncilProgress | null;
  operation?: PrisonOperation | null;
  councilEnabled?: boolean;
  viewVersion: number | null;
  onViewVersion: (version: number) => void;
  onCompile: (options?: Pick<CompileOptions, "executionContext" | "councilMode">) => void;
  onRetryOperation?: (operation: PrisonOperation) => void;
  onModify: (action: ModifierAction) => void;
  onRetarget: (target: TargetAI) => void;
  onExecutionContext?: (context: ExecutionContext) => void;
  onCouncilMode?: (mode: CouncilMode) => void;
  onRevise: (message: string) => Promise<boolean>;
  onClarify: (clarifications: ClarificationAnswer[]) => Promise<boolean>;
  onRestore: (version: number) => void;
}

function busyStage(busy: BusyState | null): number | null {
  if (!busy) return null;
  if (busy.kind === "compile" || busy.kind === "modify") return PIPELINE_STAGE.compile;
  if (busy.kind === "revise") return PIPELINE_STAGE.requirements;
  return null;
}

export function PrisonView({
  prison,
  busy,
  progress,
  operation,
  councilEnabled = true,
  viewVersion,
  onViewVersion,
  onCompile,
  onRetryOperation,
  onModify,
  onRetarget,
  onExecutionContext,
  onCouncilMode,
  onRevise,
  onClarify,
  onRestore,
}: PrisonViewProps) {
  const { t } = useI18n();
  const label = useVocabulary();
  const [executionContext, setExecutionContext] = useState<ExecutionContext>(prison.compileOptions.executionContext ?? "chat");
  const [councilMode, setCouncilMode] = useState<CouncilMode>(prison.compileOptions.councilMode ?? "single");
  useEffect(() => {
    setExecutionContext(prison.compileOptions.executionContext ?? "chat");
    setCouncilMode(prison.compileOptions.councilMode ?? "single");
  }, [prison.id, prison.compileOptions.executionContext, prison.compileOptions.councilMode]);

  if (!isResolved(prison)) {
    return <div className={styles.root}>{t("Bu prison eksik kaydedilmiş; yeniden analiz etmen gerekiyor.", "This task was saved incompletely; analyze it again.", "此任务保存不完整，请重新分析。")}</div>;
  }
  const working = busy !== null;
  const target = previewTarget(prison);
  const hasPrompt = prison.promptVersions.length > 0;
  const activeOperation = operation?.status === "queued" || operation?.status === "running" ? operation : null;
  const compiling = activeOperation ? activeOperation.kind === "compile" || activeOperation.kind === "adjust" : busy?.kind === "compile" || busy?.kind === "modify";
  const revising = activeOperation ? activeOperation.kind === "revise" || activeOperation.kind === "clarify" : busy?.kind === "revise";
  const statusLabel = activeOperation?.status === "queued"
    ? compiling ? t("Üretim sırada", "Generation queued", "生成已排队") : t("Güncelleme sırada", "Update queued", "更新已排队")
    : compiling ? hasPrompt ? t("Yeni sürüm hazırlanıyor", "Preparing a new version", "正在准备新版本") : t("Üretiliyor", "Generating", "正在生成")
      : revising ? hasPrompt ? t("Yeni sürüm hazırlanıyor", "Preparing a new version", "正在准备新版本") : t("Görev güncelleniyor", "Updating task", "正在更新任务")
        : busy?.kind === "load" ? t("Durum okunuyor", "Reading status", "正在读取状态") : label(STATUS_LABELS[prison.status]);
  const liveEvents = busy && progress?.events?.length ? progress.events : null;
  const failedOperation = !busy && (operation?.status === "failed" || operation?.status === "interrupted") ? operation : null;
  const failedEvents = failedOperation?.progress?.events;
  const shownVersion = prison.promptVersions.find((version) => version.version === (viewVersion ?? prison.activeVersion));
  const replay = !liveEvents && !failedEvents?.length && shownVersion?.councilReview ? shownVersion.councilReview : null;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.crumbs}>
          <span className="mono">{prison.id}</span>
          <span className={styles.status}>{statusLabel}</span>
          {busy ? (
            <span className={styles.working}>
              <span className="spinner" aria-hidden />
              {busy.label}
            </span>
          ) : null}
        </div>
        <h1 className={styles.title}>{prison.title}</h1>
        <StatusPipeline status={prison.status} activeStage={busyStage(busy)} />
        <details className={styles.raw}>
          <summary>{t("Orijinal istek", "Original request", "原始需求")}</summary>
          <blockquote>{prison.rawRequest}</blockquote>
        </details>
        {busy && progress ? <CouncilProgressPanel progress={progress} /> : null}
        {failedOperation ? (
          <section className={styles.operationFailure} role="alert" aria-label={t("İşlem sonucu", "Operation result", "操作结果")}>
            <div>
              <strong>{failedOperation.status === "interrupted" ? t("İşlem yarıda kesildi", "Operation interrupted", "操作已中断") : t("İşlem tamamlanamadı", "Operation could not be completed", "操作未能完成")}</strong>
              <p>{failedOperation.error?.message ?? t("Prompt kaydedilemedi. Son tartışma aşağıda korunuyor.", "The prompt could not be saved. The latest discussion is preserved below.", "未能保存提示词。下方保留了最近的讨论。")}</p>
              {failedEvents?.length ? <p>{t("Son tartışma kaydı korunuyor; aşağıdan inceleyebilirsin.", "The latest discussion is preserved; you can review it below.", "最近的讨论记录已保留，可以在下方查看。")}</p> : null}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => failedOperation.retry && onRetryOperation ? onRetryOperation(failedOperation) : onCompile({ executionContext, councilMode })}>
              {failedOperation.retry && onRetryOperation ? t("Aynı işlemi yeniden dene", "Retry the same operation", "重试相同操作") : t("Promptu yeniden üret", "Regenerate prompt", "重新生成提示词")}
            </button>
          </section>
        ) : null}
        {liveEvents ? (
          <CouncilArena key={`live-${prison.id}`} live mode={progress?.councilMode ?? councilMode} events={liveEvents} />
        ) : failedEvents?.length ? (
          <CouncilArena key={`failed-${failedOperation!.id}`} live={false} mode={failedOperation!.progress?.councilMode ?? councilMode} events={failedEvents} />
        ) : replay ? (
          <CouncilArena key={`replay-${prison.id}-${shownVersion!.version}`} live={false} promptReady mode={replay.mode} events={replayEvents(replay)} />
        ) : null}
      </header>

      <div className={styles.grid}>
        <div className={styles.left}>
          <IntentPreview prison={prison} busy={working} onClarify={onClarify} />
        </div>

        <div className={styles.right}>
          {hasPrompt ? (
            <>
              <PromptOutput
                key={prison.id}
                prison={prison}
                viewVersion={viewVersion}
                busy={working}
                onViewVersion={onViewVersion}
                onModify={onModify}
                onRetarget={onRetarget}
                onExecutionContext={onExecutionContext}
                onCouncilMode={onCouncilMode}
                councilEnabled={councilEnabled}
                onRegenerate={() => onCompile()}
                onRestore={onRestore}
                onRevise={onRevise}
              />
            </>
          ) : (
            <div className={styles.generate}>
              <span className="label">{t("Sonraki adım", "Next step", "下一步")}</span>
              <p className={styles.generateText}>
                {t("İsteğin, görev planın ve sınırların hedef AI'a uygun biçimde birleştirilecek. Çıktı, seçtiğin AI'da kullanabileceğin hazır prompt olacak.", "Your request, task plan and boundaries will be combined for the target AI. The result will be a ready-to-use prompt for your chosen AI.", "系统将把需求、任务计划和限制整合为适配目标 AI 的内容，生成可在所选 AI 中直接使用的提示词。")}
              </p>
              <ExecutionContextPicker value={executionContext} onChange={setExecutionContext} disabled={working} />
              <CouncilModePicker value={councilMode} onChange={setCouncilMode} disabled={working} available={councilEnabled} />
              <div className={styles.generateRow}>
                <span className={styles.generateTarget}>
                  {t("Hedef:", "Target:", "目标：")} <strong>{TARGET_LABELS[target.target]}</strong>
                  {prison.targetAI === "auto" ? ` — AUTO, ${label(TARGET_REASON_LABELS[target.reason])}` : ""}
                </span>
                <button type="button" className="btn btn-primary" onClick={() => onCompile({ executionContext, councilMode })} disabled={working}>
                  {busy?.kind === "compile" ? <span className="spinner" aria-hidden /> : null}
                  {t("Promptu üret", "Generate prompt", "生成提示词")}
                </button>
              </div>
            </div>
          )}
          <RevisionChat
            key={prison.id}
            revisions={prison.revisions}
            busy={working}
            hasPrompt={hasPrompt}
            onSubmit={onRevise}
            onViewVersion={onViewVersion}
          />
        </div>
      </div>
    </div>
  );
}
