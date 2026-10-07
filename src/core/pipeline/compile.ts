import type { ResolvedPrison } from "@/models/prison";
import type { CriticIssue, CriticReport, PromptGeneration, PromptVersion, QualityScores, VersionTrigger } from "@/models/prompt";
import { activeOwnerRevisions, toCompileInput } from "@/core/context-engine";
import { refreshExecutionPlan } from "@/core/intent-engine/planning";
import { toTaskPlan } from "@/core/requirement-resolver";
import { runOwnerPolarityRules } from "@/core/prompt-critic/owner-polarity";
import { compilePrompt, type CompiledPrompt } from "@/core/prompt-compiler";
import { validateOutput } from "@/core/output-validator";
import { mergeFixes, runLlmCritic, runRules, scoreIssues, toIssue, type CriticFinding } from "@/core/prompt-critic";
import { MIN_REVIEW_SCORE } from "@/core/prompt-critic/llm";
import { applyPatch, CRITIC_POLICY } from "@/core/prison-engine/patch";
import { transition } from "@/core/prison-engine/state-machine";
import { resolveTaskProfile } from "@/core/task-types/registry";
import { generateJailbreakPrompt } from "@/core/jailbreak-engine";
import { combineJailbreakPrompt } from "@/core/jailbreak-engine/local";
import { generateRefinedPrompt } from "@/core/prompt-refiner";
import type { LLMProvider } from "@/services/ai/types";
import type { CouncilDeps } from "@/services/ai/council-config";
import type { CouncilEvent, CouncilReview } from "@/models/council";
import { conductCouncil, councilCandidateText, councilMemory, repairCouncilResult, type CouncilResult } from "@/core/model-council";
import type { ProgressUpdate } from "@/models/operation-progress";
import { AppError } from "@/services/errors";
import { AIProviderError } from "@/services/ai/errors";
import type { CouncilCheckpoint, CouncilCheckpointRevisionOrigin } from "@/models/council-checkpoint";
import { councilSourceFingerprint } from "@/models/council-checkpoint";
import type { CouncilCheckpointRepository } from "@/services/storage/council-checkpoint-repository";
import { checkpointMember, checkpointWorkingPrison, restoreCheckpointCouncil } from "./council-checkpoint";

export interface CompileRequest {
  trigger: VersionTrigger;
  note: string;
  /** Kept for API compatibility. Every newly AI-generated final text is reviewed. */
  llmReview: boolean;
}

export interface PipelineDeps {
  provider: LLMProvider | null;
  now?: () => Date;
  council?: CouncilDeps | null;
  onProgress?: (progress: ProgressUpdate) => void;
  /** Live council timeline for the arena view. */
  onCouncilEvent?: (event: CouncilEvent) => void;
  /** Private selected drafts; independent final review still gates every saved prompt. */
  checkpoints?: CouncilCheckpointRepository;
  /** Upstream revision preparation is reusable only after exact base/request attestation. */
  revisionOrigin?: CouncilCheckpointRevisionOrigin;
}

function check(prison: ResolvedPrison, compiled: CompiledPrompt): CriticFinding[] {
  const validation = validateOutput(compiled);
  if (!validation.ok) {
    throw new AppError("validation_error", "Üretilen prompt doğrulanamadı; mevcut kayıt korundu.", validation.problems.join("; "));
  }
  return [...runRules({ prison, compiled, validation, profile: resolveTaskProfile(prison.spec.taskType) }), ...runOwnerPolarityRules(prison, compiled.text)];
}

const findingKey = (finding: CriticFinding) => `${finding.rule}:${finding.dimension}:${finding.message}`;
const PLAN_CONTENT_DIMENSIONS: ReadonlyArray<keyof QualityScores> = [
  "intent_alignment", "constraint_clarity", "execution_clarity", "output_clarity",
];

interface Candidate {
  compiled: CompiledPrompt;
  generation: PromptGeneration;
  councilReview?: CouncilReview;
  reviewProvider?: LLMProvider;
  /** Kept for one targeted correction by the selected writer or a real independent fallback. */
  council?: CouncilResult;
}

/**
 * The main engine re-plans. While a council is active its approving jurors stand in when the main endpoint is
 * temporarily overloaded, so one busy endpoint does not discard a finished deliberation. It is still an AI call.
 */
function plannerFor(primary: LLMProvider | null, standby: LLMProvider | undefined): LLMProvider | null {
  if (!primary) return standby ?? null;
  if (!standby) return primary;
  return {
    info: primary.info,
    generateJson: async (request) => {
      try { return await primary.generateJson(request); }
      catch (error) {
        if (error instanceof AIProviderError && ["timeout", "unavailable", "rate_limit", "network"].includes(error.kind)) return standby.generateJson(request);
        throw error;
      }
    },
  };
}

/** Real source-review calls, with distinct actual member endpoints standing by on transient failure. */
function sourceReviewerFor(primary: LLMProvider | null, council: CouncilDeps): LLMProvider {
  const seen = new Set<string>();
  const providers = [primary, ...council.members.map((member) => member.provider)].filter((provider): provider is LLMProvider => {
    if (!provider) return false;
    const key = `${provider.info.provider}:${provider.info.model}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!providers.length) throw new AIProviderError("configuration", "Source review requires an actual AI provider.");
  const budget = council.depth?.callTimeoutMs ?? 90000;
  let active = providers[0];
  return {
    get info() { return active.info; },
    generateJson: async (request) => {
      let lastError: unknown;
      for (const provider of providers) {
        try {
          const response = await provider.generateJson({ ...request, timeoutMs: Math.min(request.timeoutMs ?? budget, budget) });
          active = provider;
          return response;
        } catch (error) {
          lastError = error;
          if (!(error instanceof AIProviderError) || !["timeout", "unavailable", "rate_limit", "network"].includes(error.kind)) throw error;
        }
      }
      throw lastError;
    },
  };
}

function contractFor(prison: ResolvedPrison): CompiledPrompt {
  const input = toCompileInput(prison);
  const base = compilePrompt({ ...input, options: { ...input.options, jailbreakMode: false } });
  check(prison, base);
  return base;
}

/** Shared safe repair for source review and exact final review; each caller permits it once. */
async function repairReviewedState(
  prison: ResolvedPrison, findings: CriticFinding[], scores: QualityScores, provider: LLMProvider | null,
  now: () => Date, standby?: LLMProvider,
): Promise<{ prison: ResolvedPrison; changes: string[]; feedback: string }> {
  let working = prison;
  const changes: string[] = [];
  const fixes = mergeFixes(findings);
  let stateRequiresPlanRefresh = false;
  let blockedFixes: string[] = [];
  if (fixes) {
    const removedInferredAssumption = fixes.removeIds?.some((id) => working.spec.assumptions.some((item) => item.id === id && item.source === "implicit"));
    const patch = applyPatch(working, fixes, CRITIC_POLICY, now());
    working = patch.prison;
    changes.push(...patch.changes);
    blockedFixes = patch.blocked;
    stateRequiresPlanRefresh = patch.changes.length > 0 && Boolean(fixes.restoreOwnerQuotes?.length || removedInferredAssumption);
  }
  const feedback = JSON.stringify({
    issues: findings.map(({ dimension, severity, message }) => ({ dimension, severity, message })),
    scores,
    rejected_state_fixes: blockedFixes,
    instruction: "Resolve real defects against the actual owner instructions while preserving every owner requirement, constraint, active memory, permission and scope. Model-derived state and execution plans are interpretations that must be corrected when unsupported. Rejected state fixes are not owner permissions and must not be implemented in the plan or generated text.",
  });
  // Invented plan requirements may be scored as intent or constraints rather than execution.
  const materialPlanDefect = findings.some((finding) => finding.severity === "high" && PLAN_CONTENT_DIMENSIONS.includes(finding.dimension))
    || PLAN_CONTENT_DIMENSIONS.some((dimension) => scores[dimension] < MIN_REVIEW_SCORE);
  if (working.spec.taskPlan && (stateRequiresPlanRefresh || materialPlanDefect)) {
    contractFor(working); // Validate patched structure before requesting another plan.
    working = { ...working, spec: { ...working.spec, taskPlan: toTaskPlan(await refreshExecutionPlan(working, plannerFor(provider, standby), undefined, feedback)) } };
    changes.push("Çözüm planı kalite denetiminin somut bulgularına göre güncellendi");
  }
  return { prison: working, changes, feedback };
}

function councilCandidate(prison: ResolvedPrison, base: CompiledPrompt, result: CouncilResult): Candidate {
  const writer = result.writer ?? result.winner;
  return {
    compiled: { ...base, isJailbreak: prison.compileOptions.jailbreakMode, text: councilCandidateText(prison, base, result.prompt) },
    generation: { source: "ai", provider: writer.provider.info.provider, model: writer.provider.info.model, strategies: result.strategies },
    councilReview: result.review,
    reviewProvider: result.reviewProvider,
    council: result,
  };
}

/** Generate the directive while keeping the authoritative task contract intact. */
async function generateCandidate(prison: ResolvedPrison, provider: LLMProvider | null, feedback?: string, council?: CouncilDeps | null, onProgress?: PipelineDeps["onProgress"], onCouncilEvent?: PipelineDeps["onCouncilEvent"]): Promise<Candidate> {
  const base = contractFor(prison);
  if (council) {
    // The version being regenerated or revised is the table's working memory for this task.
    const previous = prison.promptVersions.find((version) => version.version === prison.activeVersion);
    const memory = previous?.councilReview ? councilMemory(previous.councilReview, previous.version) : undefined;
    const result = await conductCouncil(prison, base, council, feedback, onProgress, { memory, onEvent: onCouncilEvent });
    return councilCandidate(prison, base, result);
  }
  if (prison.compileOptions.jailbreakMode) {
    const result = await generateJailbreakPrompt({ prison, target: base.target, basePrompt: base.text, provider, feedback });
    return {
      compiled: { ...base, isJailbreak: true, text: combineJailbreakPrompt(result.prompt, base.text, prison.language) },
      generation: {
        source: result.isAiGenerated ? "ai" : "local",
        provider: result.isAiGenerated ? provider!.info.provider : null,
        model: result.isAiGenerated ? provider!.info.model : null,
        strategies: result.strategies,
      },
    };
  }
  if (!provider) return {
    compiled: base,
    generation: { source: "compiler", provider: null, model: null, strategies: [] },
  };
  const result = await generateRefinedPrompt({ provider, prison, compiled: base, feedback });
  const text = prison.language === "tr"
    ? `# Göreve Özel Yönlendirme\n\n${result.prompt}\n\n# Bağlayıcı Görev Sözleşmesi\n\n${base.text}`
    : `# Task-Specific Direction\n\n${result.prompt}\n\n# Authoritative Task Contract\n\n${base.text}`;
  return {
    compiled: { ...base, text },
    generation: { source: "ai", provider: provider.info.provider, model: provider.info.model, strategies: result.strategies },
  };
}

/**
 * Resolve rule fixes → optional source review → generate through the API → review the exact final text.
 * Source and final review each permit one semantic repair. Unverified/failed output is never saved.
 */
export async function runCompilePipeline(
  prison: ResolvedPrison,
  request: CompileRequest,
  deps: PipelineDeps,
): Promise<ResolvedPrison> {
  const now = deps.now ?? (() => new Date());
  const compiledStatus = prison.status === "READY_FOR_COMPILE" ? "PROMPT_COMPILED" : "PROMPT_RECOMPILED";
  let working = prison;
  const fingerprint = deps.council ? councilSourceFingerprint(prison, deps.council, deps.provider) : null;
  let checkpoint = deps.checkpoints ? await deps.checkpoints.get(prison.id) : null;
  let restoredCouncil: CouncilResult | null = null;
  if (checkpoint) {
    const restoredWorking = fingerprint === checkpoint.sourceFingerprint ? checkpointWorkingPrison(checkpoint, prison) : null;
    restoredCouncil = restoredWorking && deps.council ? restoreCheckpointCouncil(checkpoint, deps.council) : null;
    if (!restoredWorking || !restoredCouncil || checkpoint.phase === "rejected" || checkpoint.repairInFlight) {
      await deps.checkpoints!.delete(prison.id);
      checkpoint = null;
    } else {
      working = restoredWorking;
    }
  }
  let initialRules: CriticFinding[] = checkpoint?.diagnostics.initialFindings ?? [];
  let appliedFixes: string[] = checkpoint?.appliedFixes ?? [];
  const sourceRepairFindings: CriticFinding[] = checkpoint?.diagnostics.sourceRepairFindings ?? [];
  let sourceRepaired = checkpoint?.sourceRepaired ?? false;
  let repairFindings: CriticFinding[] = checkpoint?.diagnostics.repairFindings ?? [];
  let semanticRepair = checkpoint?.phase === "repaired";
  let candidate: Candidate;
  if (checkpoint && restoredCouncil) {
    candidate = councilCandidate(working, contractFor(working), restoredCouncil);
    deps.onProgress?.({ stage: "validation", completed: 0, total: 1, message: "Önceki çalışmanın seçilen promptu geri yüklendi; son metin denetiminden devam ediliyor.", councilMode: working.compileOptions.councilMode });
    for (const event of restoredCouncil.review.events ?? []) deps.onCouncilEvent?.(event);
  } else {
    const input = toCompileInput(working);
    const initialContract = compilePrompt({ ...input, options: { ...input.options, jailbreakMode: false } });
    initialRules = check(working, initialContract);
    const initialFixes = mergeFixes(initialRules);
    if (initialFixes) {
      const patch = applyPatch(working, initialFixes, CRITIC_POLICY, now());
      working = patch.prison;
      appliedFixes.push(...patch.changes);
    }
    if (!deps.council?.verifySource && initialRules.some((finding) => finding.rule === "owner-polarity-plan")) {
      working = { ...working, spec: { ...working.spec, taskPlan: toTaskPlan(await refreshExecutionPlan(working, deps.provider)) } };
      appliedFixes.push("Çözüm planı kullanıcının gerçek talimatıyla yeniden doğrulandı");
    }

    if (deps.council?.verifySource) {
      const sourceProvider = sourceReviewerFor(deps.provider, deps.council);
      const councilMode = working.compileOptions.councilMode;
      const message = "Görev sözleşmesi konseyden önce kullanıcının gerçek talimatlarıyla denetleniyor.";
      deps.onProgress?.({ stage: "validation", completed: 0, total: 1, message, councilMode });
      let contract = contractFor(working);
      let sourceRules = check(working, contract);
      let review = await runLlmCritic(sourceProvider, working, contract);
      if (!review.passed || sourceRules.some((finding) => finding.severity === "high")) {
        sourceRepairFindings.push(...sourceRules, ...review.findings);
        const repaired = await repairReviewedState(working, sourceRepairFindings, review.scores, sourceProvider, now);
        working = repaired.prison;
        appliedFixes.push(...repaired.changes);
        sourceRepaired = true;
        contract = contractFor(working);
        sourceRules = check(working, contract);
        review = await runLlmCritic(sourceProvider, working, contract);
      }
      if (!review.passed || sourceRules.some((finding) => finding.severity === "high")) {
        throw new AppError("validation_error", "Görev sözleşmesi konseyden önce doğrulanamadı; mevcut kayıt korundu.",
          JSON.stringify({ scores: review.scores, findings: [...sourceRules, ...review.findings].filter((finding) => finding.severity === "high").map((finding) => finding.message) }));
      }
      deps.onProgress?.({ stage: "validation", completed: 1, total: 1, message: "Görev sözleşmesi doğrulandı; konsey başlayabilir.", councilMode });
    }

    candidate = await generateCandidate(working, deps.provider, undefined, deps.council, deps.onProgress, deps.onCouncilEvent);
  }
  const saveSelection = async (phase: CouncilCheckpoint["phase"], feedback: string | null = null, repairInFlight = false) => {
    const result = candidate.council;
    if (!deps.checkpoints || !fingerprint || !result) return;
    const at = now().toISOString();
    const publicFinding = ({ rule, dimension, severity, message }: CriticFinding) => ({ rule, dimension, severity, message });
    const next: CouncilCheckpoint = {
      schemaVersion: 1, prisonId: prison.id, sourceFingerprint: fingerprint,
      createdAt: checkpoint?.createdAt ?? at, updatedAt: at, phase, repairInFlight, workingPrison: working,
      selectedPrompt: result.prompt, strategies: result.strategies, review: result.review,
      winner: checkpointMember(result.winner), writer: result.writer ? checkpointMember(result.writer) : null,
      finalReviewers: result.finalReviewers.map(checkpointMember), reviewBudgetMs: result.reviewBudgetMs,
      feedback, diagnostics: { initialFindings: initialRules.map(publicFinding), sourceRepairFindings: sourceRepairFindings.map(publicFinding), repairFindings: repairFindings.map(publicFinding) },
      appliedFixes, sourceRepaired,
      ...(deps.revisionOrigin ? { revisionOrigin: deps.revisionOrigin } : {}),
    };
    await deps.checkpoints.save(next);
    checkpoint = next;
  };
  if (working.status !== "PROMPT_COMPILED" && working.status !== "PROMPT_RECOMPILED") working = transition(working, compiledStatus, candidate.compiled.target, now());
  if (!checkpoint) await saveSelection("selected");
  let finalRules = check(working, candidate.compiled);
  let finalLlmFindings: CriticFinding[] = [];
  let llmScores: QualityScores | null = null;
  let llmReviewed = false;

  if (deps.provider || candidate.reviewProvider) {
    const repairCandidate = async (feedback: string) => {
      if (candidate.council) {
        const base = contractFor(working);
        const mode = working.compileOptions.councilMode;
        const message = "Seçilen prompt son metin denetiminin bulgularıyla düzeltiliyor.";
        deps.onProgress?.({ stage: "revision", completed: 0, total: 1, message, councilMode: mode });
        // A crash after the upstream response must not trigger another successful correction of this draft.
        await saveSelection("needs_repair", feedback, true);
        let repaired: CouncilResult;
        try { repaired = await repairCouncilResult(working, base, candidate.council, feedback, deps.onCouncilEvent); }
        catch (error) {
          await saveSelection("needs_repair", feedback);
          throw error;
        }
        candidate = councilCandidate(working, base, repaired);
        // Persist the successful correction before its independent re-review can fail or disconnect.
        semanticRepair = true;
        await saveSelection("repaired", feedback);
        deps.onProgress?.({ stage: "revision", completed: 1, total: 1, message, councilMode: mode });
      } else {
        candidate = await generateCandidate(working, deps.provider, feedback, deps.council, deps.onProgress, deps.onCouncilEvent);
        semanticRepair = true;
      }
      finalRules = check(working, candidate.compiled);
    };
    if (checkpoint?.phase === "needs_repair") {
      if (!checkpoint.feedback) throw new AppError("storage_error", "Kaydedilen düzeltme bulguları eksik; mevcut prompt korundu.");
      await repairCandidate(checkpoint.feedback);
    }
    // API/critic failures propagate. A configured engine cannot claim a completed review.
    let review = await runLlmCritic(candidate.reviewProvider ?? deps.provider!, working, candidate.compiled);
    llmReviewed = true;
    if (!semanticRepair && (!review.passed || finalRules.some((finding) => finding.severity === "high"))) {
      repairFindings = [...finalRules, ...review.findings];
      const repairedState = await repairReviewedState(working, repairFindings, review.scores, deps.provider, now, candidate.reviewProvider);
      working = repairedState.prison;
      appliedFixes.push(...repairedState.changes);
      const feedback = repairedState.feedback;
      // A retry after unavailable correction resumes here without repeating the council or initial review.
      await saveSelection("needs_repair", feedback);
      await repairCandidate(feedback);
      review = await runLlmCritic(candidate.reviewProvider ?? deps.provider!, working, candidate.compiled);
    }
    finalLlmFindings = review.findings;
    llmScores = review.scores;
    if (!review.passed) {
      await saveSelection("rejected", JSON.stringify({ scores: review.scores, findings: review.findings.map((finding) => finding.message) }));
      throw new AppError("validation_error", "Prompt kalite kontrolünü geçemedi. Sonucun iyileştirilmesi gerekiyor; mevcut kayıt korundu.",
        JSON.stringify({ scores: review.scores, findings: review.findings.map((finding) => finding.message) }));
    }
  }
  if (finalRules.some((finding) => finding.severity === "high")) {
    await saveSelection("rejected", finalRules.filter((finding) => finding.severity === "high").map((finding) => finding.message).join("; "));
    throw new AppError("validation_error", "Prompt görev koşullarını karşılamadı; mevcut kayıt korundu.",
      finalRules.filter((finding) => finding.severity === "high").map((finding) => finding.message).join("; "));
  }

  const finalFindings = [...finalRules, ...finalLlmFindings];
  const remaining = new Set(finalFindings.map(findingKey));
  const seen = new Set<string>();
  const issues: CriticIssue[] = [];
  for (const finding of [...initialRules, ...sourceRepairFindings, ...repairFindings, ...finalFindings]) {
    const key = findingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(toIssue(finding, !remaining.has(key)));
  }
  const refined = sourceRepaired || semanticRepair || appliedFixes.length > 0;
  const critic: CriticReport = {
    issues,
    scores: scoreIssues(issues, llmScores),
    refined,
    compilePasses: semanticRepair ? 2 : 1,
    llmReviewed,
    llmError: null,
    appliedFixes,
  };
  working = transition(working, "PROMPT_VALIDATED", llmReviewed ? "AI semantic review passed" : "local rules passed", now());
  working = transition(working, "READY", "", now());
  if (candidate.councilReview) deps.onProgress?.({ stage: "validation", completed: 1, total: 1, message: "Seçilen prompt görev denetimini geçti." });

  const version: PromptVersion = {
    version: (working.promptVersions.at(-1)?.version ?? 0) + 1,
    createdAt: now().toISOString(),
    trigger: request.trigger,
    note: request.note,
    targetAI: working.targetAI,
    resolvedTarget: candidate.compiled.target,
    targetReason: candidate.compiled.targetReason,
    options: working.compileOptions,
    text: candidate.compiled.text,
    blockIds: candidate.compiled.blocks.map((block) => block.id),
    critic,
    specSnapshot: working.spec,
    memorySnapshot: working.taskMemory,
    ownerRevisionIds: activeOwnerRevisions(working).map((entry) => entry.id),
    generation: candidate.generation,
    councilReview: candidate.councilReview ?? null,
  };
  return { ...working, promptVersions: [...working.promptVersions, version], activeVersion: version.version };
}

