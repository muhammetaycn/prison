import type { CouncilCheckpoint, CouncilCheckpointModelRef } from "@/models/council-checkpoint";
import { CouncilCheckpointWorkingPrisonSchema } from "@/models/council-checkpoint";
import type { ResolvedPrison } from "@/models/prison";
import type { CouncilDeps, CouncilMember } from "@/services/ai/council-config";
import type { CouncilResult } from "@/core/model-council";
import { reviewerChain } from "@/core/model-council";
import { AIProviderError } from "@/services/ai/errors";

const modelKey = (provider: string, model: string | null) => `${provider}:${model}`.toLowerCase();

export function checkpointMember(member: CouncilMember): CouncilCheckpointModelRef {
  const { provider, model } = member.provider.info;
  if (!model) throw new AIProviderError("configuration", "Council checkpoint requires actual model identities.");
  return { id: member.id, role: member.role, provider, model };
}

/** A saved seat can use only its configured endpoint or an actual configured reserve. */
export function restoreCheckpointCouncil(checkpoint: CouncilCheckpoint, council: CouncilDeps): CouncilResult | null {
  const review = structuredClone(checkpoint.review);
  const restore = (reference: CouncilCheckpointModelRef): CouncilMember | null => {
    const seat = council.members.find((member) => member.id === reference.id && member.role === reference.role);
    const evidence = review.participants.find((participant) => participant.id === reference.id
      && participant.role === reference.role && participant.provider === reference.provider && participant.model === reference.model);
    if (!seat || !evidence) return null;
    const key = modelKey(reference.provider, reference.model);
    const provider = [seat.provider, ...(council.reserves ?? [])].find((candidate) => modelKey(candidate.info.provider, candidate.info.model) === key);
    return provider ? { ...seat, provider } : null;
  };
  const winner = restore(checkpoint.winner);
  const writer = checkpoint.writer ? restore(checkpoint.writer) : undefined;
  const reviewers = checkpoint.finalReviewers.map(restore);
  if (!winner || (checkpoint.writer && !writer) || reviewers.some((member) => !member)
    || winner.id !== review.winnerId || winner.provider.info.model !== review.winnerModel) return null;
  const finalReviewers = reviewers as CouncilMember[];
  const author = writer ?? winner;
  const authorKey = modelKey(author.provider.info.provider, author.provider.info.model);
  const keys = finalReviewers.map(({ provider }) => modelKey(provider.info.provider, provider.info.model));
  if (!finalReviewers.length || keys.includes(authorKey) || new Set(keys).size !== keys.length) return null;
  if (checkpoint.workingPrison.id !== checkpoint.prisonId) return null;
  return {
    prompt: checkpoint.selectedPrompt, strategies: checkpoint.strategies, winner,
    ...(writer ? { writer } : {}), finalReviewers, reviewBudgetMs: checkpoint.reviewBudgetMs, review,
    reviewProvider: reviewerChain(finalReviewers, checkpoint.reviewBudgetMs, (reviewer) => { review.finalReviewerModel = reviewer.provider.info.model!; }),
  };
}

/** Derived working state can be restored only for this exact source task, never as a ready prompt. */
export function checkpointWorkingPrison(checkpoint: CouncilCheckpoint, source: ResolvedPrison): ResolvedPrison | null {
  const value = checkpoint.workingPrison;
  // Normalize schema defaults and field order equally for file-backed and other valid repositories.
  const current = CouncilCheckpointWorkingPrisonSchema.parse(source);
  if (value.id !== current.id || value.rawRequest !== current.rawRequest || value.language !== current.language
    || value.targetAI !== current.targetAI || value.activeVersion !== current.activeVersion
    || JSON.stringify(value.compileOptions) !== JSON.stringify(current.compileOptions)
    || !["READY_FOR_COMPILE", "PRISON_UPDATED", "PROMPT_COMPILED", "PROMPT_RECOMPILED"].includes(value.status)) return null;
  // The checkpoint holds public task data, but never writes a selected or rejected draft into promptVersions.
  if (JSON.stringify(value.promptVersions) !== JSON.stringify(current.promptVersions)) return null;
  if (JSON.stringify(value.revisions) !== JSON.stringify(current.revisions)
    || JSON.stringify(value.taskMemory) !== JSON.stringify(current.taskMemory)
    || JSON.stringify(value.inactiveOwnerRevisionIds) !== JSON.stringify(current.inactiveOwnerRevisionIds)) return null;
  return { ...structuredClone(value), title: current.title, createdAt: current.createdAt };
}
