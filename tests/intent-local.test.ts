import { describe, expect, it } from "vitest";
import { analyzeIntentLocally } from "@/core/intent-engine/local/analyzer";
import { extractGoal, splitClauses, toImperative } from "@/core/intent-engine/local/goal";
import { analyzeIntent, normalizeIntent } from "@/core/intent-engine";

describe("local goal extraction", () => {
  it("turns Turkish future-tense causatives into imperatives", () => {
    expect(toImperative("ekletecek")).toBe("ekle");
    expect(toImperative("sağlayacak")).toBe("sağla");
    expect(toImperative("yapacak")).toBe("yap");
    expect(toImperative("edecek")).toBe("et");
    expect(toImperative("geliştirecek")).toBe("geliştir");
    expect(toImperative("üretecek")).toBe("üret");
    expect(toImperative("anlatacak")).toBe("anlat");
    expect(toImperative("sistemini")).toBe("sistemini");
  });

  it("removes the prompt-writing wrapper and the target mention", () => {
    const { goal } = extractGoal("Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.");
    expect(goal).toBe("Mevcut projemi bozmadan ödeme sistemini ekle.");
  });

  it("handles English wrappers", () => {
    const { goal } = extractGoal("Write a Codex prompt that adds a payment system to my existing project without breaking it");
    expect(goal).toBe("Add a payment system to my existing project without breaking it.");
  });

  it.each([
    ["Build a prompt generator for customer support", "Build a prompt generator for customer support."],
    ["Prompt üreten bir sistem geliştir", "Prompt üreten bir sistem geliştir."],
    ["Prompt üretecek bir sistem geliştir", "Prompt üretecek bir sistem geliştir."],
  ])("preserves prompt-related work inside the actual task: %s", (raw, expected) => {
    expect(extractGoal(raw).goal).toBe(expected);
  });

  it("splits clauses only after future-tense verbs", () => {
    expect(splitClauses("ana akışı görünür yapacak ve kullanıcıların bulmasını sağlayacak")).toEqual([
      "ana akışı görünür yapacak",
      "kullanıcıların bulmasını sağlayacak",
    ]);
    expect(splitClauses("ürün ve fiyat listesini güncelle")).toEqual(["ürün ve fiyat listesini güncelle"]);
  });
});

describe("local intent analyzer", () => {
  it("understands an existing-project coding request for Codex", () => {
    const intent = analyzeIntentLocally({
      rawRequest: "Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.",
      language: "en",
      targetAI: "auto",
    });
    expect(intent.task_type).toBe("coding");
    expect(intent.target_ai_mentioned).toBe("codex");
    expect(intent.existing_system).toBe(true);
    expect(intent.preserve_architecture).toBe(true);
    expect(intent.coding_required).toBe(true);
    expect(intent.operation).toBe("modify_existing");
    expect(intent.deployment_permission).toBe("unspecified");
    expect(intent.unknowns.some((u) => /payment provider/i.test(u))).toBe(true);
    expect(intent.implicit_requirements.some((r) => /card data/i.test(r))).toBe(true);
    expect(intent.protected_elements).toContain("Existing functionality");
  });

  it("detects SEO/UI secondary types and splits requirements", () => {
    const intent = analyzeIntentLocally({
      rawRequest:
        "Mevcut sitemi bozmadan ana akışı daha görünür yapacak ve Google’dan gelen kullanıcıların ilgili tartışmaları direkt bulmasını sağlayacak Codex promptu üret.",
      language: "tr",
      targetAI: "auto",
    });
    expect(intent.task_type).toBe("coding");
    expect(intent.secondary_task_types).toContain("seo");
    expect(intent.explicit_requirements).toEqual([
      "Ana akışı daha görünür yap",
      "Google’dan gelen kullanıcıların ilgili tartışmaları direkt bulmasını sağla",
    ]);
  });

  it("recognizes advice-only security analysis without coding", () => {
    const intent = analyzeIntentLocally({
      rawRequest: "Windows bilgisayarımın güvenlik ayarlarını analiz edip sadece öneri sunacak bir prompt yaz.",
      language: "tr",
      targetAI: "auto",
    });
    expect(intent.task_type).toBe("security_analysis");
    expect(intent.advice_only).toBe(true);
    expect(intent.coding_required).toBe(false);
    expect(intent.operation).toBe("advise");
  });

  it("reads explicit deployment prohibitions", () => {
    const intent = analyzeIntentLocally({
      rawRequest: "Sitemdeki giriş hatasını düzelt ama canlıya deploy etme.",
      language: "en",
      targetAI: "auto",
    });
    expect(intent.task_type).toBe("debugging");
    expect(intent.deployment_permission).toBe("forbidden");
  });

  it("is used when no provider is configured", async () => {
    const result = await analyzeIntent({ rawRequest: "Instagram için içerik planı hazırla", language: "tr", targetAI: "auto" }, null);
    expect(result.engine.mode).toBe("local");
    expect(result.intent.task_type).toBe("social_media");
  });
});

describe("intent normalization", () => {
  it("dedupes, trims and drops unknown task types", () => {
    const intent = analyzeIntentLocally({ rawRequest: "Bir blog yazısı yaz", language: "en", targetAI: "auto" });
    const normalized = normalizeIntent({
      ...intent,
      task_type: "not_a_type",
      secondary_task_types: ["writing", "writing", "nope"],
      constraints: ["  Keep it short. ", "keep it short", ""],
    });
    expect(normalized.task_type).toBe("general_reasoning");
    expect(normalized.secondary_task_types).toEqual(["writing"]);
    expect(normalized.constraints).toEqual(["Keep it short"]);
  });
});
