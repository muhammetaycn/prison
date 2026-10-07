import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { applyPatch, REVISION_POLICY } from "@/core/prison-engine/patch";
import { interpretRevision } from "@/core/revision-engine";
import { ScriptedProvider } from "./helpers";

describe("revision bounds and unknown resolution", () => {
  it("resolves multiple supplied answers and retains the literal exclusion without inventing subject weights", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Türkçe, matematik ve fizik için çalışma planı oluştur", language: "tr", targetAI: "gpt" }, null);
    prison.spec.unknowns = [
      { id: "unk_duration", text: "Planın kaç hafta süreceği", source: "implicit" },
      { id: "unk_daily", text: "Günlük çalışma süresi", source: "implicit" },
      { id: "unk_days", text: "Hafta sonunun dahil olup olmayacağı", source: "implicit" },
    ];
    const message = "Plan 2 hafta olacak. Günde en fazla 3 saat çalışabilirim. Hafta sonu dahil olmayacak.";
    const provider = new ScriptedProvider().enqueue("prison_revision", {
      summary: "Süre, günlük üst sınır ve çalışma günleri netleştirildi.",
      set: {},
      add: { constraints: ["Günde en fazla 3 saat çalışabilirim", "Hafta sonu dahil olmayacak"] },
      resolved_unknowns: [
        { unknown_id: "unk_duration", fact: "Plan 2 hafta olacak" },
        { unknown_id: "unk_daily", fact: "Günde en fazla 3 saat çalışabilirim" },
        { unknown_id: "unk_days", fact: "Hafta sonu dahil olmayacak" },
      ],
    });
    const interpreted = await interpretRevision(message, prison, provider);
    const revised = applyPatch(prison, interpreted.patch, REVISION_POLICY).prison;
    expect(provider.callsFor("prison_revision")).toHaveLength(1);
    expect(provider.callsFor("prison_revision")[0]?.messages[0]?.content).toContain(message);
    expect(revised.spec.unknowns).toEqual([]);
    expect(revised.spec.contextFacts.map((fact) => fact.text)).toEqual(expect.arrayContaining([
      "Plan 2 hafta olacak", "Günde en fazla 3 saat çalışabilirim", "Hafta sonu dahil olmayacak",
    ]));
    expect(revised.spec.constraints.map((constraint) => constraint.text)).toEqual(expect.arrayContaining([
      "Günde en fazla 3 saat çalışabilirim", "Hafta sonu dahil olmayacak",
    ]));
    expect(revised.spec.disallowedOperations.some((item) => /Hafta sonu dışı|Pazartesi.*yasak/i.test(item.text))).toBe(false);
    expect(revised.spec.requirements.some((item) => /eşit ağırlık|balanced|equal weights/i.test(item.text))).toBe(false);
  });
});
