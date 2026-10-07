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
  const [executionContext, setExecutionContext] = useState<ExecutionContext>(prison.compileOptions.executionContext ?? "chat");
  const [councilMode, setCouncilMode] = useState<CouncilMode>(prison.compileOptions.councilMode ?? "competition");
  useEffect(() => {
    setExecutionContext(prison.compileOptions.executionContext ?? "chat");
    setCouncilMode(prison.compileOptions.councilMode ?? "competition");
  }, [prison.id, prison.compileOptions.executionContext, prison.compileOptions.councilMode]);

  if (!isResolved(prison)) {
    return <div className={styles.root}>Bu prison eksik kaydedilmiş; yeniden analiz etmen gerekiyor.</div>;
  }
  const working = busy !== null;
  const target = previewTarget(prison);
  const hasPrompt = prison.promptVersions.length > 0;
  const activeOperation = operation?.status === "queued" || operation?.status === "running" ? operation : null;
  const compiling = activeOperation ? activeOperation.kind === "compile" || activeOperation.kind === "adjust" : busy?.kind === "compile" || busy?.kind === "modify";
  const revising = activeOperation ? activeOperation.kind === "revise" || activeOperation.kind === "clarify" : busy?.kind === "revise";
  const statusLabel = activeOperation?.status === "queued"
    ? compiling ? "Üretim sırada" : "Güncelleme sırada"
    : compiling ? hasPrompt ? "Yeni sürüm hazırlanıyor" : "Üretiliyor"
      : revising ? hasPrompt ? "Yeni sürüm hazırlanıyor" : "Görev güncelleniyor"
        : busy?.kind === "load" ? "Durum okunuyor" : STATUS_LABELS[prison.status];
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
          <summary>Orijinal istek</summary>
          <blockquote>{prison.rawRequest}</blockquote>
        </details>
        {busy && progress ? <CouncilProgressPanel progress={progress} /> : null}
        {failedOperation ? (
          <section className={styles.operationFailure} role="alert" aria-label="İşlem sonucu">
            <div>
              <strong>{failedOperation.status === "interrupted" ? "İşlem yarıda kesildi" : "İşlem tamamlanamadı"}</strong>
              <p>{failedOperation.error?.message ?? "Prompt kaydedilemedi. Son tartışma aşağıda korunuyor."}</p>
              {failedEvents?.length ? <p>Son tartışma kaydı korunuyor; aşağıdan inceleyebilirsin.</p> : null}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => failedOperation.retry && onRetryOperation ? onRetryOperation(failedOperation) : onCompile({ executionContext, councilMode })}>
              {failedOperation.retry && onRetryOperation ? "Aynı işlemi yeniden dene" : "Promptu yeniden üret"}
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
              <span className="label">Sonraki adım</span>
              <p className={styles.generateText}>
                İsteğin, görev planın ve sınırların hedef AI&apos;a uygun biçimde birleştirilecek. Çıktı,
                seçtiğin AI&apos;da kullanabileceğin hazır prompt olacak.
              </p>
              <ExecutionContextPicker value={executionContext} onChange={setExecutionContext} disabled={working} />
              <CouncilModePicker value={councilMode} onChange={setCouncilMode} disabled={working} available={councilEnabled} />
              <div className={styles.generateRow}>
                <span className={styles.generateTarget}>
                  Hedef: <strong>{TARGET_LABELS[target.target]}</strong>
                  {prison.targetAI === "auto" ? ` — AUTO, ${TARGET_REASON_LABELS[target.reason]}` : ""}
                </span>
                <button type="button" className="btn btn-primary" onClick={() => onCompile({ executionContext, councilMode })} disabled={working}>
                  {busy?.kind === "compile" ? <span className="spinner" aria-hidden /> : null}
                  Promptu üret
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
