import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { applyPatch, REVISION_POLICY } from "@/core/prison-engine/patch";
import { interpretRevision } from "@/core/revision-engine";
import { buildRevisionSchema, checkRevisionMemoryReferences, revisionToPatch } from "@/core/revision-engine/schema";
import { taskTypeIds } from "@/core/task-types/registry";
import { ScriptedProvider } from "./helpers";

const captionRule = "Captions use plain Turkish without emoji";
const visualRule = "Visual suggestions use warm natural light";
const menuFact = "The menu focuses on espresso and desserts";

async function task() {
  return runAnalysisPipeline({ rawRequest: "Prepare a cafe content plan without publishing posts.", language: "en", targetAI: "claude" }, null);
}

const output = (overrides: object = {}) => ({
  summary: "Kalıcı kurallar bağlandı.", set: {}, add: {}, remove_item_ids: [], resolved_unknowns: [], memory: [], revoke_memory_ids: [], ...overrides,
});

describe("memory item linkage", () => {
  it("protects each independent directive's named items while keeping unrelated menu facts revisable", async () => {
    const prison = await task();
    const updated = applyPatch(prison, {
      add: { constraints: [captionRule, visualRule], contextFacts: [menuFact] },
      memory: [
        { directive: captionRule, kind: "constraint", relatedItemTexts: [captionRule] },
        { directive: visualRule, kind: "constraint", relatedItemTexts: [visualRule] },
      ],
    }, REVISION_POLICY).prison;
    const caption = updated.spec.constraints.find((item) => item.text === captionRule)!;
    const visual = updated.spec.constraints.find((item) => item.text === visualRule)!;
    const menu = updated.spec.contextFacts.find((item) => item.text === menuFact)!;
    expect(updated.taskMemory.find((entry) => entry.directive === captionRule)?.itemRefs).toEqual([caption.id]);
    expect(updated.taskMemory.find((entry) => entry.directive === visualRule)?.itemRefs).toEqual([visual.id]);
    expect(updated.taskMemory.some((entry) => entry.itemRefs.includes(menu.id))).toBe(false);
    const removal = applyPatch(updated, { removeIds: [caption.id, visual.id, menu.id] }, REVISION_POLICY);
    expect(removal.blocked).toHaveLength(2);
    expect(removal.prison.spec.contextFacts.some((item) => item.id === menu.id)).toBe(false);
    expect(removal.prison.spec.constraints.some((item) => item.id === caption.id)).toBe(true);
    expect(removal.prison.spec.constraints.some((item) => item.id === visual.id)).toBe(true);
  });

  it("binds only the named addition's actual existing match, rather than all new or existing items", async () => {
    const prison = await task();
    prison.spec.constraints.push({ id: "con_existing_visual", text: "Use warm natural light for all visual suggestions", source: "implicit" });
    const requested = "Use warm natural light for visual suggestions";
    const updated = applyPatch(prison, {
      add: { constraints: [requested, captionRule], contextFacts: [menuFact] },
      memory: [{ directive: "Keep the warm lighting rule", kind: "constraint", relatedItemTexts: [requested] }],
    }, REVISION_POLICY).prison;
    expect(updated.taskMemory.at(-1)?.itemRefs).toEqual(["con_existing_visual"]);
    expect(updated.spec.constraints.find((item) => item.id === "con_existing_visual")?.source).toBe("revision");
    expect(updated.spec.constraints.some((item) => item.text === requested)).toBe(false);
    expect(updated.spec.contextFacts.some((item) => item.text === menuFact)).toBe(true);
  });

  it("can link a resolved unknown's fact, including a matched existing fact, without linking other answers", async () => {
    const prison = await task();
    prison.spec.unknowns = [{ id: "unk_provider", text: "Which provider?", source: "implicit" }, { id: "unk_budget", text: "What budget?", source: "implicit" }];
    prison.spec.contextFacts.push({ id: "fact_existing_provider", text: "Use Stripe", source: "revision" });
    const updated = applyPatch(prison, {
      resolvedUnknowns: [{ unknownId: "unk_provider", fact: "Use Stripe" }, { unknownId: "unk_budget", fact: "The budget is 100 EUR" }],
      memory: [{ directive: "Keep Stripe as the payment provider", kind: "constraint", relatedItemTexts: ["  use   STRIPE. "] }],
    }, REVISION_POLICY).prison;
    expect(updated.spec.unknowns).toEqual([]);
    expect(updated.taskMemory.at(-1)?.itemRefs).toEqual(["fact_existing_provider"]);
    const budget = updated.spec.contextFacts.find((item) => item.text === "The budget is 100 EUR")!;
    expect(updated.taskMemory.at(-1)?.itemRefs).not.toContain(budget.id);
  });

  it("keeps an explicit empty link list empty, while undefined direct legacy patches preserve their old protection", async () => {
    const prison = await task();
    const empty = applyPatch(prison, {
      add: { constraints: [captionRule], contextFacts: [menuFact] },
      memory: [{ directive: captionRule, kind: "constraint", relatedItemTexts: [] }],
    }, REVISION_POLICY).prison;
    expect(empty.taskMemory.at(-1)?.itemRefs).toEqual([]);
    expect(empty.taskMemory.at(-1)?.active).toBe(true);
    const legacy = applyPatch(prison, {
      add: { constraints: [captionRule], contextFacts: [menuFact] },
      memory: [{ directive: captionRule, kind: "constraint" }],
    }, REVISION_POLICY).prison;
    const ids = [...legacy.spec.constraints, ...legacy.spec.contextFacts].filter((item) => [captionRule, menuFact].includes(item.text)).map((item) => item.id);
    expect(legacy.taskMemory.at(-1)?.itemRefs.sort()).toEqual(ids.sort());
    expect(applyPatch(legacy, { removeIds: ids }, REVISION_POLICY).blocked).toHaveLength(2);
  });

  it("blocks a direct named link to an unrelated existing item rather than binding the whole patch", async () => {
    const prison = await task();
    prison.spec.contextFacts.push({ id: "fact_unrelated", text: "An unrelated existing fact", source: "explicit" });
    const result = applyPatch(prison, {
      add: { constraints: [captionRule] },
      memory: [{ directive: captionRule, kind: "constraint", relatedItemTexts: ["An unrelated existing fact"] }],
    }, REVISION_POLICY);
    expect(result.blocked).toHaveLength(1);
    expect(result.prison.taskMemory).toEqual([]);
    expect(result.prison.spec.constraints.some((item) => item.text === captionRule)).toBe(true);
  });
});

describe("revision memory wire contract", () => {
  it("defaults an omitted old wire field to an explicit empty patch list and rejects malformed supplied lists", () => {
    const schema = buildRevisionSchema(taskTypeIds());
    const parsed = schema.parse(output({ add: { constraints: [captionRule] }, memory: [{ directive: captionRule, kind: "constraint" }] }));
    expect(parsed.memory[0]?.related_item_texts).toEqual([]);
    expect(revisionToPatch(parsed).memory?.[0]?.relatedItemTexts).toEqual([]);
    expect(schema.safeParse(output({ memory: [{ directive: captionRule, kind: "constraint", related_item_texts: "everything" }] })).success).toBe(false);
  });

  it("accepts exact normalized additions and resolved facts, but rejects a paraphrase or arbitrary existing-item reference", () => {
    const schema = buildRevisionSchema(taskTypeIds());
    const valid = schema.parse(output({
      add: { constraints: [captionRule] }, resolved_unknowns: [{ unknown_id: "unk_provider", fact: "Use Stripe" }],
      memory: [{ directive: captionRule, kind: "constraint", related_item_texts: [`  ${captionRule.toUpperCase()}. `, "Use Stripe"] }],
    }));
    expect(checkRevisionMemoryReferences(valid)).toBeNull();
    const invalid = schema.parse(output({
      add: { constraints: [captionRule] },
      memory: [{ directive: captionRule, kind: "constraint", related_item_texts: ["Always write plain captions"] }],
    }));
    expect(checkRevisionMemoryReferences(invalid)).toContain("related_item_texts.0");
  });

  it("retries an invalid generated reference with a concrete error, then protects only its corrected item", async () => {
    const prison = await task();
    prison.spec.contextFacts.push({ id: "fact_unrelated", text: "An unrelated existing fact", source: "explicit" });
    const invalid = output({ add: { constraints: [captionRule], context_facts: [menuFact] }, memory: [
      { directive: captionRule, kind: "constraint", related_item_texts: ["An unrelated existing fact"] },
    ] });
    const valid = output({ add: { constraints: [captionRule], context_facts: [menuFact] }, memory: [
      { directive: captionRule, kind: "constraint", related_item_texts: [captionRule] },
    ] });
    const provider = new ScriptedProvider().enqueue("prison_revision", invalid, valid);
    const interpretation = await interpretRevision("Captions use plain Turkish without emoji. The menu focuses on espresso and desserts.", prison, provider);
    expect(provider.callsFor("prison_revision")).toHaveLength(2);
    expect(provider.callsFor("prison_revision")[1]?.messages.at(-1)?.content).toContain("memory.0.related_item_texts.0");
    const updated = applyPatch(prison, interpretation.patch, REVISION_POLICY).prison;
    const caption = updated.spec.constraints.find((item) => item.text === captionRule)!;
    expect(updated.taskMemory.at(-1)?.itemRefs).toEqual([caption.id]);
    expect(updated.taskMemory.at(-1)?.itemRefs).not.toContain("fact_unrelated");
  });

  it("fails after bounded invalid references instead of committing a fabricated relationship", async () => {
    const prison = await task();
    const before = structuredClone(prison);
    const invalid = output({ add: { constraints: [captionRule] }, memory: [{ directive: captionRule, kind: "constraint", related_item_texts: [menuFact] }] });
    const provider = new ScriptedProvider().enqueue("prison_revision", invalid, invalid);
    await expect(interpretRevision(captionRule, prison, provider)).rejects.toMatchObject({ kind: "invalid_output", detail: expect.stringContaining("related_item_texts") });
    expect(provider.calls).toHaveLength(2);
    expect(prison).toEqual(before);
  });
});
