import { describe, expect, it } from "vitest";
import { checkOwnerPolarity } from "@/core/text/owner-directives";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { interpretRevision } from "@/core/revision-engine";
import { runOwnerPolarityRules } from "@/core/prompt-critic/owner-polarity";
import { applyPatch, CRITIC_POLICY } from "@/core/prison-engine/patch";
import { CLEAN_CRITIC, ScriptedProvider } from "./helpers";
import { compilePrompt } from "@/core/prompt-compiler";
import { toCompileInput } from "@/core/context-engine";

const negative = "Derslere eşit süre şartı ekleme.";

async function task() {
  const prison = await runAnalysisPipeline({ rawRequest: "Haftalık çalışma planı hazırla", language: "tr", targetAI: "gpt" }, null);
  prison.revisions.push({ id: "owner_latest", createdAt: prison.createdAt, message: negative, summary: "Koşulu ekleme", engine: "ai", changes: [], resultVersion: null });
  return prison;
}

describe("explicit owner prohibition backstop", () => {
  it("catches rejected Turkish and English requirements but permits ordinary protected design constraints", () => {
    expect(checkOwnerPolarity(["Derslere eşit süre ayırma"], [negative])).toContain(negative);
    expect(checkOwnerPolarity(["Require equal subject durations"], ["Do not require equal subject durations."])).not.toBeNull();
    expect(checkOwnerPolarity(["Preserve existing visual design"], ["Preserve the existing visual design without changing it."])).toBeNull();
    expect(checkOwnerPolarity([negative], [negative])).toBeNull();
    expect(checkOwnerPolarity(["Plan Python exercises"], [negative])).toBeNull();
  });

  it("allows a later explicit owner change to supersede the former prohibition", () => {
    expect(checkOwnerPolarity(["Derslere eşit süre ayırma"], [negative, "Derslere eşit süre ayırmayı zorunlu tut."])).toBeNull();
  });

  it("rejects the wrong revision interpretation and retries with literal negative wording", async () => {
    const prison = await task();
    const provider = new ScriptedProvider().enqueue("prison_revision",
      { summary: "Eşit süre eklendi", set: {}, add: { requirements: ["Derslere eşit süre ayırma"] } },
      { summary: "Eşit süre zorunluluğu yok", set: {}, add: { constraints: [negative] } },
    );
    const result = await interpretRevision(negative, prison, provider);
    expect(provider.callsFor("prison_revision")).toHaveLength(2);
    expect(result.patch.add?.requirements).toEqual([]);
    expect(result.patch.add?.constraints).toEqual([negative]);
    expect(provider.callsFor("prison_revision")[1]?.messages.at(-1)?.content).toContain(negative);
  });

  it("restores every erroneous inferred copy to the actual owner constraint and leaves unrelated requirements intact", async () => {
    const prison = await task();
    prison.spec.requirements.push({ id: "wrong_req", text: "Derslere eşit süre ayırma", source: "revision" });
    prison.spec.protectedElements.push({ id: "wrong_guard", text: "Derslere eşit süre ayırma", source: "revision" });
    prison.spec.requiredActions.push({ id: "valid_step", text: "Matematik alıştırmalarını planla", source: "revision" });
    const findings = runOwnerPolarityRules(prison);
    expect(findings).toHaveLength(2);
    const result = applyPatch(prison, { restoreOwnerQuotes: findings.flatMap((finding) => finding.fix?.restoreOwnerQuotes ?? []) }, CRITIC_POLICY);
    expect(runOwnerPolarityRules(result.prison)).toEqual([]);
    expect(result.prison.spec.constraints).toContainEqual(expect.objectContaining({ id: "wrong_req", text: negative }));
    expect(result.prison.spec.requirements.some((item) => item.id === "wrong_req")).toBe(false);
    expect(result.prison.spec.requiredActions).toContainEqual(expect.objectContaining({ id: "valid_step" }));
  });

  it("never accepts contradictory generated wording even if both API critic responses give passing scores", async () => {
    const prison = await task();
    const before = structuredClone(prison);
    const wrong = { prompt: "Derslere eşit süre ayırma zorunluluğunu uygula.\nHaftalık çalışma planını istenen tablo biçiminde açık ve uygulanabilir olarak hazırla; günlük çalışma aralıklarını ve dinlenmeleri göster.", strategies_used: ["task_decomposition"] };
    const provider = new ScriptedProvider()
      .enqueue("prison_prompt_refinement", wrong, wrong)
      .enqueue("prison_critic", CLEAN_CRITIC, CLEAN_CRITIC);
    await expect(runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: true }, { provider })).rejects.toMatchObject({ code: "validation_error" });
    expect(prison).toEqual(before);
    expect(prison.promptVersions).toEqual([]);
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
  });
});

describe("Markdown header and row-count ownership", () => {
  const owner = "Çıktı Gün ve Metin sütunlarından oluşan Markdown tablo olsun: başlık hariç tam 7 veri satırı.";

  it("does not turn excluding the header from a row count into banning the header", () => {
    expect(checkOwnerPolarity(["Markdown tablosunda başlık olmamak"], [owner])).toContain(owner);
    expect(checkOwnerPolarity(["Markdown tabloda başlık satırı bulunmayacak ve 7 veri satırı olacak"], [owner])).toContain(owner);
    expect(checkOwnerPolarity(["Markdown tablo başlık hariç 7 veri satırı içerecek"], [owner])).toBeNull();
    expect(checkOwnerPolarity(["Başka bölüm başlıkları veya tablo dışında açıklama ekleme"], [owner])).toBeNull();
  });

  it("covers English and respects later actual owner format or header changes", () => {
    const english = "Return a Markdown table with 7 data rows excluding the header.";
    expect(checkOwnerPolarity(["Produce a Markdown table without headers"], [english])).toContain(english);
    expect(checkOwnerPolarity(["The header row must not be included"], [english])).toContain(english);
    expect(checkOwnerPolarity(["Markdown tabloda başlık satırı olmayacak"], [owner, "Markdown tabloda başlık satırı olmayacak."])).toBeNull();
    expect(checkOwnerPolarity(["No table headers"], [english, "Return the output as JSON instead."])).toBeNull();
  });

  it.each([
    "Başlık satırı olmadan 7 satırlık Markdown tablosu olmalı.",
    "Markdown tabloda başlık olmadan tam 7 veri satırı kullan.",
    "Markdown tabloda başlığı atla; yalnızca veri satırlarını yaz.",
    "Markdown tablonun başlığını kaldır; yalnızca veri satırlarını yaz.",
    "Başlık satırını kaldır ve tam 7 veri satırı kullan.",
    "Return a Markdown table without a header row.",
    "Return a Markdown table without the header row.",
  ])("catches the real missing-header wording %s", (candidate) => {
    expect(checkOwnerPolarity([candidate], [owner])).toContain(owner);
  });

  it.each([
    "Markdown tabloyu başlık satırı olmadan istiyorum.",
    "Markdown tabloda başlığı atla.",
    "Markdown tablonun başlığını kaldır.",
    "Return a Markdown table without a header row.",
    "Return a Markdown table without the header row.",
  ])("respects a later explicit owner choice %s", (changed) => {
    expect(checkOwnerPolarity([changed], [owner, changed])).toBeNull();
  });

  it("keeps the guard specific to table headers and leaves negative removal instructions alone", () => {
    expect(checkOwnerPolarity(["Başlığı kaldır."], [owner])).toBeNull();
    expect(checkOwnerPolarity(["Markdown tablo çıktısı kalsın; bölüm başlığını kaldır."], [owner])).toBeNull();
    expect(checkOwnerPolarity(["Markdown tabloda başlığı kaldırma; sütun başlıklarını koru."], [owner])).toBeNull();
    expect(checkOwnerPolarity(["Markdown tablo oluştur; tablo başlığını atlamadan sütunları koru."], [owner])).toBeNull();
    expect(checkOwnerPolarity(["Return a Markdown table without section headings."], [owner])).toBeNull();
  });

  it("repairs only an unprotected derived header ban to the literal owner clause", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: owner, language: "tr", targetAI: "gpt" }, null);
    prison.spec.requirements.push({ id: "derived_header", text: "Markdown tablosunda başlık olmamak", source: "implicit" });
    const findings = runOwnerPolarityRules(prison);
    const patch = { restoreOwnerQuotes: findings.flatMap(finding => finding.fix?.restoreOwnerQuotes ?? []) };
    const repaired = applyPatch(prison, patch, CRITIC_POLICY).prison;
    expect(runOwnerPolarityRules(repaired)).toEqual([]);
    expect(compilePrompt(toCompileInput(repaired)).text).not.toContain("başlık olmamak");
    expect(repaired.spec.requirements).toContainEqual(expect.objectContaining({ id: "derived_header", text: owner }));
    expect(repaired.rawRequest).toBe(owner);
    prison.taskMemory.push({ id: "protected_header", kind: "constraint", active: true, directive: "Protected", itemRefs: ["derived_header"], createdAt: prison.createdAt });
    expect(runOwnerPolarityRules(prison).find(finding => finding.message.includes("başlık olmamak"))?.fix).toBeUndefined();
  });

  it.each([
    "Markdown tabloda başlık satırı bulunmayacak.",
    "Başlık satırı olmadan 7 satırlık Markdown tablosu olmalı.",
    "Markdown tabloda başlığı atla.",
    "Markdown tablonun başlığını kaldır.",
  ])("rejects generated header reversal %s even when every AI score passes", async (directive) => {
    const prison = await runAnalysisPipeline({ rawRequest: owner, language: "tr", targetAI: "gpt" }, null);
    const before = structuredClone(prison);
    const wrong = { prompt: `${directive} Tam 7 veri satırında Gün ve Metin alanlarını kullan. İstenen haftalık planı sade Türkçe ile oluştur; tablo dışında açıklama ekleme.`, strategies_used: ["output_contract"] };
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", wrong, wrong).enqueue("prison_critic", CLEAN_CRITIC, CLEAN_CRITIC);
    await expect(runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: true }, { provider })).rejects.toMatchObject({ code: "validation_error" });
    expect(prison).toEqual(before);
    expect(provider.callsFor("prison_prompt_refinement")).toHaveLength(2);
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
  });
});
