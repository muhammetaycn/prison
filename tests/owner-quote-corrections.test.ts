import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { applyPatch, CRITIC_POLICY } from "@/core/prison-engine/patch";

async function revisedTask() {
  const task = await runAnalysisPipeline({ rawRequest: "Haftalık çalışma planı hazırla", targetAI: "gpt", language: "tr" }, null);
  task.revisions.push({ id: "rev_owner", createdAt: task.createdAt, message: "Hafta sonu dahil olmayacak. Toplam 3 saate dinlenmeler dahil.", summary: "Koşullar netleşti.", changes: [], resultVersion: null, engine: "ai" });
  task.spec.constraints.push({ id: "con_bad_quote", text: "Hafta sonu dışı çalışma yasaklanmalı", source: "revision" });
  return task;
}

describe("owner quote corrections", () => {
  it("restores a mistranslated constraint from the owner's literal words while keeping its identity", async () => {
    const task = await revisedTask();
    const corrected = applyPatch(task, { restoreOwnerQuotes: [{ itemId: "con_bad_quote", ownerQuote: "Hafta sonu dahil olmayacak." }] }, CRITIC_POLICY);
    expect(corrected.blocked).toEqual([]);
    expect(corrected.prison.spec.constraints.find((item) => item.id === "con_bad_quote")).toMatchObject({ text: "Hafta sonu dahil olmayacak.", source: "revision" });
    expect(task.spec.constraints.find((item) => item.id === "con_bad_quote")?.text).toBe("Hafta sonu dışı çalışma yasaklanmalı");
  });

  it("resolves an answered unknown using the verifiable answer without inventing a fact", async () => {
    const task = await revisedTask();
    task.spec.unknowns.push({ id: "unk_answered", text: "Dinlenmeler toplam süreye dahil mi?", source: "implicit" });
    const corrected = applyPatch(task, { restoreOwnerQuotes: [{ itemId: "unk_answered", ownerQuote: "Toplam 3 saate dinlenmeler dahil." }] }, CRITIC_POLICY);
    expect(corrected.prison.spec.unknowns.some((item) => item.id === "unk_answered")).toBe(false);
    expect(corrected.prison.spec.contextFacts).toContainEqual(expect.objectContaining({ text: "Toplam 3 saate dinlenmeler dahil", source: "revision" }));
  });

  it("rejects fabricated quotes, explicit-item edits and memory-protected-item edits", async () => {
    const task = await revisedTask();
    task.spec.constraints.push({ id: "con_explicit", text: "Günlük üst sınırı koru", source: "explicit" });
    task.taskMemory.push({ id: "mem_guard", createdAt: task.createdAt, directive: "Bu koşulu koru", kind: "constraint", itemRefs: ["con_bad_quote"], active: true });
    const before = structuredClone(task.spec);
    const result = applyPatch(task, { restoreOwnerQuotes: [
      { itemId: "con_bad_quote", ownerQuote: "Hafta sonu dahil olmayacak." },
      { itemId: "con_explicit", ownerQuote: "Toplam 3 saate dinlenmeler dahil." },
      { itemId: "con_missing", ownerQuote: "Hafta sonu dahil olmayacak." },
      { itemId: "con_bad_quote", ownerQuote: "Hafta sonu 8 saat çalışılacak." },
    ] }, CRITIC_POLICY);
    expect(result.blocked).toHaveLength(4);
    expect(result.prison.spec).toEqual(before);
    expect(result.prison.taskMemory).toEqual(task.taskMemory);
  });

  it("keeps a complete negative owner sentence in constraints without prepending another negation", async () => {
    const task = await revisedTask();
    task.spec.disallowedOperations.push({ id: "deny_paraphrase", text: "Weekday work", source: "revision" });
    const result = applyPatch(task, { restoreOwnerQuotes: [{ itemId: "deny_paraphrase", ownerQuote: "Hafta sonu dahil olmayacak." }] }, CRITIC_POLICY);
    expect(result.prison.spec.disallowedOperations.some((item) => item.id === "deny_paraphrase")).toBe(false);
    expect(result.prison.spec.constraints).toContainEqual(expect.objectContaining({ id: "deny_paraphrase", text: "Hafta sonu dahil olmayacak." }));
  });
});
