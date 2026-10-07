import { describe, expect, it } from "vitest";
import { activeOwnerRevisions, isolatePrison, toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { restoreVersion, runRevisionPipeline } from "@/core/pipeline/revise";
import { transition } from "@/core/prison-engine/state-machine";
import { isResolved, PrisonSchema, type ResolvedPrison } from "@/models/prison";

function clock() {
  let tick = Date.parse("2026-10-04T09:00:00Z");
  return () => new Date(tick += 1000);
}

async function studyTask(now: () => Date) {
  const task = await runAnalysisPipeline({ rawRequest: "Create a weekday study plan.", language: "en", targetAI: "gpt" }, null, now);
  return runCompilePipeline(task, { trigger: "initial", note: "", llmReview: false }, { provider: null, now });
}

function regenerate(task: ResolvedPrison, now: () => Date) {
  return runCompilePipeline(transition(task, "READY_FOR_COMPILE", "regenerate", now()),
    { trigger: "regenerate", note: "", llmReview: false }, { provider: null, now });
}

function reload(task: ResolvedPrison): ResolvedPrison {
  const loaded = PrisonSchema.parse(JSON.parse(JSON.stringify(task)));
  if (!isResolved(loaded)) throw new Error("Expected a resolved saved task");
  return loaded;
}

describe("owner directive scope after restoring a version", () => {
  it("keeps rolled-back instructions absent during regeneration and accepts new revisions after reload", async () => {
    const now = clock();
    const initial = await studyTask(now);
    const oldMessage = "Use 4 hours per day for study.";
    const revised = await runRevisionPipeline(initial, oldMessage, { provider: null, now });
    const oldId = revised.revisions.at(-1)!.id;
    expect(revised.promptVersions.at(-1)?.ownerRevisionIds).toEqual([oldId]);
    expect(revised.promptVersions.at(-1)?.text).toContain(oldMessage);

    const restored = reload(restoreVersion(revised, 1, now())!);
    expect(restored.revisions.map((entry) => entry.id)).toContain(oldId);
    expect(activeOwnerRevisions(restored)).toEqual([]);
    expect(toCompileInput(restored).ownerDirectives).toEqual([]);
    expect(isolatePrison(restored).owner_revisions).toEqual([]);
    const regenerated = await regenerate(restored, now);
    expect(regenerated.promptVersions.at(-1)?.text).not.toContain(oldMessage);
    expect(regenerated.spec.requirements.some((entry) => entry.text.includes("4 hours"))).toBe(false);
    expect(regenerated.promptVersions.at(-1)?.ownerRevisionIds).toEqual([]);

    const newMessage = "Use 2 hours per day for study.";
    const fresh = reload(await runRevisionPipeline(regenerated, newMessage, { provider: null, now }));
    const freshId = fresh.revisions.at(-1)!.id;
    expect(toCompileInput(fresh).ownerDirectives).toEqual([newMessage]);
    expect(isolatePrison(fresh).owner_revisions).toEqual([{ message: newMessage }]);
    expect(fresh.promptVersions.at(-1)?.text).toContain(newMessage);
    expect(fresh.promptVersions.at(-1)?.text).not.toContain(oldMessage);
    expect(fresh.promptVersions.at(-1)?.ownerRevisionIds).toEqual([freshId]);
  });

  it("restores each branch's exact scope, including a version created by an earlier restore", async () => {
    const now = clock();
    const initial = await studyTask(now);
    const branchA = await runRevisionPipeline(initial, "Use 4 hours per day for study.", { provider: null, now });
    const branchAId = branchA.revisions.at(-1)!.id;
    const firstRestore = restoreVersion(branchA, 1, now())!;
    const restoreNumber = firstRestore.activeVersion!;
    const branchB = await runRevisionPipeline(firstRestore, "Use 2 hours per day for study.", { provider: null, now });
    const branchBId = branchB.revisions.at(-1)!.id;

    const restoredA = restoreVersion(branchB, 2, now())!;
    expect(activeOwnerRevisions(restoredA).map((entry) => entry.id)).toEqual([branchAId]);
    expect(restoredA.inactiveOwnerRevisionIds).toContain(branchBId);
    const compiledA = await regenerate(restoredA, now);
    expect(compiledA.promptVersions.at(-1)?.text).toContain("Use 4 hours per day for study.");
    expect(compiledA.promptVersions.at(-1)?.text).not.toContain("Use 2 hours per day for study.");

    const restoredEmpty = restoreVersion(compiledA, restoreNumber, now())!;
    expect(activeOwnerRevisions(restoredEmpty)).toEqual([]);
    expect(restoredEmpty.promptVersions.at(-1)?.ownerRevisionIds).toEqual([]);
  });

  it("loads legacy snapshots and excludes later revisions even when timestamps are equal", async () => {
    const now = clock();
    const initial = await studyTask(now);
    const revised = await runRevisionPipeline(initial, "Use 4 hours per day for study.", { provider: null, now });
    const legacy = JSON.parse(JSON.stringify(revised));
    for (const version of legacy.promptVersions) delete version.ownerRevisionIds;
    delete legacy.inactiveOwnerRevisionIds;
    legacy.revisions[0].createdAt = legacy.promptVersions[0].createdAt;
    const loaded = reload(legacy);
    expect(loaded.promptVersions[0]?.ownerRevisionIds).toBeNull();
    const restored = reload(restoreVersion(loaded, 1, now())!);
    expect(activeOwnerRevisions(restored)).toEqual([]);
    const compiled = await regenerate(restored, now);
    expect(compiled.promptVersions.at(-1)?.text).not.toContain("Use 4 hours per day for study.");
    expect(compiled.promptVersions.at(-1)?.ownerRevisionIds).toEqual([]);
  });

  it("reconstructs a legacy branch generated after an earlier restore without resurrecting its discarded branch", async () => {
    const now = clock();
    const initial = await studyTask(now);
    const branchA = await runRevisionPipeline(initial, "Use 4 hours per day for study.", { provider: null, now });
    const restored = restoreVersion(branchA, 1, now())!;
    const branchB = await runRevisionPipeline(restored, "Use 2 hours per day for study.", { provider: null, now });
    const branchBVersion = branchB.activeVersion!;
    const legacy = JSON.parse(JSON.stringify(branchB));
    for (const version of legacy.promptVersions) delete version.ownerRevisionIds;
    delete legacy.inactiveOwnerRevisionIds;

    const rebuilt = reload(restoreVersion(reload(legacy), branchBVersion, now())!);
    expect(toCompileInput(rebuilt).ownerDirectives).toEqual(["Use 2 hours per day for study."]);
    const compiled = await regenerate(rebuilt, now);
    expect(compiled.promptVersions.at(-1)?.text).toContain("Use 2 hours per day for study.");
    expect(compiled.promptVersions.at(-1)?.text).not.toContain("Use 4 hours per day for study.");
  });

  it("loads a legacy record already on a restored branch and still includes its newly staged revision", async () => {
    const now = clock();
    const initial = await studyTask(now);
    const revised = await runRevisionPipeline(initial, "Use 4 hours per day for study.", { provider: null, now });
    const legacy = JSON.parse(JSON.stringify(restoreVersion(revised, 1, now())!));
    for (const version of legacy.promptVersions) delete version.ownerRevisionIds;
    delete legacy.inactiveOwnerRevisionIds;
    legacy.revisions.push({ ...legacy.revisions[0], id: "rev_old_no_change", resultVersion: null });
    const loaded = reload(legacy);
    expect(activeOwnerRevisions(loaded)).toEqual([]);
    expect(activeOwnerRevisions(transition(loaded, "USER_REVISION", "New owner instruction", now()))).toEqual([]);
    const fresh = await runRevisionPipeline(loaded, "Use 2 hours per day for study.", { provider: null, now });
    expect(toCompileInput(fresh).ownerDirectives).toEqual(["Use 2 hours per day for study."]);
    expect(fresh.promptVersions.at(-1)?.text).not.toContain("Use 4 hours per day for study.");
    expect(fresh.promptVersions.at(-1)?.ownerRevisionIds).toEqual([fresh.revisions.at(-1)!.id]);
  });
});
