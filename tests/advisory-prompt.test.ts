import { describe, expect, it } from "vitest";
import { toCompileInput, type CompileInput } from "@/core/context-engine";
import { validateOutput } from "@/core/output-validator";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { applyPatch, CRITIC_POLICY } from "@/core/prison-engine/patch";
import { compilePrompt } from "@/core/prompt-compiler";
import { mergeFixes, runRules } from "@/core/prompt-critic";
import { resolveRequirements } from "@/core/requirement-resolver";
import { resolveTaskProfile } from "@/core/task-types/registry";
import type { ConcreteTarget, Language } from "@/models/common";
import type { IntentAnalysis } from "@/models/intent";
import { DEFAULT_COMPILE_OPTIONS, type CompileOptions } from "@/models/options";
import { paymentIntent } from "./helpers";

const TARGETS = ["gpt", "claude", "gemini", "codex"] as const;
const CONTEXTS = ["chat", "mobile", "browser", "agent"] as const;
const VERBOSITIES = ["concise", "standard", "detailed"] as const;

const CONTENT = {
  en: {
    goal: "Compare fixed delay, exponential backoff and capped jitter for checkout retries and recommend one",
    request: "Compare fixed delay, exponential backoff and capped jitter for checkout retries and recommend one. Return a comparison table and a recommendation only. Do not edit files or run commands. Keep checkout unchanged. Ask which payment provider is used if its retry rules affect the recommendation.",
    question: "Which payment provider is used?",
    format: "Comparison table and recommendation only",
    description: "A read-only comparison of retry approaches with a justified recommendation",
    deliverables: ["Comparison table", "Recommendation with trade-offs"],
    boundary: "Do not edit files or run commands",
    preserved: "Keep checkout unchanged",
    role: "a software reliability adviser",
    approach: "Compare the supplied approaches, identify decision-changing gaps, and recommend an option without applying it.",
    steps: [
      { action: "Compare retry approaches", purpose: "Identify reliability and latency trade-offs", verification: "Each approach is evaluated using the same criteria" },
      { action: "Recommend an approach", purpose: "Help the owner choose the best fit", verification: "The recommendation cites the comparison and marks uncertainty" },
    ],
  },
  tr: {
    goal: "Ödeme tekrarı için sabit gecikme, üstel bekleme ve sınırlı rastgele gecikmeyi karşılaştır ve birini öner",
    request: "Ödeme tekrarı için sabit gecikme, üstel bekleme ve sınırlı rastgele gecikmeyi karşılaştır ve birini öner. Yalnızca karşılaştırma tablosu ve öneri döndür. Dosyaları değiştirme veya komut çalıştırma. Ödeme akışını olduğu gibi koru. Tekrar kuralları öneriyi etkiliyorsa hangi ödeme sağlayıcısının kullanıldığını sor.",
    question: "Hangi ödeme sağlayıcısı kullanılıyor?",
    format: "Yalnızca karşılaştırma tablosu ve öneri",
    description: "Tekrar yaklaşımlarının salt okunur karşılaştırması ve gerekçeli öneri",
    deliverables: ["Karşılaştırma tablosu", "Ödünleşimleriyle öneri"],
    boundary: "Dosyaları değiştirme veya komut çalıştırma",
    preserved: "Ödeme akışını olduğu gibi koru",
    role: "yazılım güvenilirliği danışmanı",
    approach: "Sunulan yaklaşımları karşılaştır, kararı değiştiren eksikleri belirle ve hiçbir değişiklik uygulamadan bir seçenek öner.",
    steps: [
      { action: "Tekrar yaklaşımlarını karşılaştır", purpose: "Güvenilirlik ve gecikme ödünleşimlerini belirlemek", verification: "Her yaklaşım aynı kriterlerle değerlendirildi" },
      { action: "Bir yaklaşım öner", purpose: "Kullanıcının uygun seçeneği seçmesine yardımcı olmak", verification: "Öneri karşılaştırmaya dayanıyor ve belirsizlikler açık" },
    ],
  },
} as const;

/** Replace every implementation-specific fixture field: this is advice about code, not coding work. */
function advisoryIntent(language: Language, operation: "advise" | "analyze", planned = false): IntentAnalysis {
  const content = CONTENT[language];
  return paymentIntent({
    title: language === "en" ? "Checkout retry recommendation" : "Ödeme tekrarı önerisi",
    primary_goal: content.goal,
    secondary_goals: [],
    task_type: "coding",
    secondary_task_types: [],
    domain: "checkout reliability",
    operation,
    target_ai_mentioned: null,
    expected_output: { format: content.format, description: content.description, deliverables: [...content.deliverables] },
    existing_system: true,
    new_system: false,
    preserve_architecture: true,
    execution_required: false,
    analysis_required: true,
    research_required: false,
    coding_required: true,
    deployment_required: false,
    deployment_permission: "forbidden",
    visual_generation_required: false,
    advice_only: operation === "advise",
    role: content.role,
    context_summary: "",
    current_system: "",
    known_facts: [],
    explicit_requirements: [content.boundary, content.preserved],
    implicit_requirements: [],
    constraints: [content.boundary],
    protected_elements: [content.preserved],
    allowed_operations: [],
    disallowed_operations: [],
    required_actions: planned ? content.steps.map((step) => step.action) : [],
    assumptions: [],
    unknowns: planned ? [] : [content.question],
    conflicts: [],
    success_conditions: [],
    execution_plan: planned ? {
      approach: content.approach,
      steps: content.steps.map((step) => ({ ...step })),
      clarifying_questions: [content.question],
      recommended_target: "gpt",
      target_rationale: content.description,
    } : null,
  });
}

function inputFor(intent: IntentAnalysis, language: Language, targetAI: ConcreteTarget, options: Partial<CompileOptions> = {}): CompileInput {
  const resolved = resolveRequirements({ intent, language, itemSeq: 0 });
  return {
    prisonId: "advisory-regression",
    spec: resolved.spec,
    rawRequest: CONTENT[language].request,
    language,
    targetAI,
    options: { ...DEFAULT_COMPILE_OPTIONS, ...options },
    ownerDirectives: [],
  };
}

// Match unwanted positive imperatives/claims, while allowing the owner's prohibitions to remain verbatim.
const IMPLEMENTATION_DIRECTIVES = [
  /(?:^|\n)\s*(?:[-*]|\d+\.)?\s*Implement\b/imu,
  /(?:^|\n)\s*(?:[-*]|\d+\.)?\s*Add or update tests\b/imu,
  /(?:^|\n)\s*(?:[-*]|\d+\.)?\s*Run (?:the existing build|commands and tests|a regression check)\b/imu,
  /After each step run the relevant build/iu,
  /Plan the smallest set of changes/iu,
  /mapping each requirement to concrete changes/iu,
  /Mevcut kod stiline[^\n]*uygula/iu,
  /Gerekli değişiklikleri[^\n]*uygula/iu,
  /Küçük ve doğrulanabilir adımlarla uygula/iu,
  /Yeni veya değişen davranış için test ekle/iu,
  /Değişikliklerinden önce ve sonra mevcut build/iu,
  /Her adımdan sonra ilgili build/iu,
  /Her değişikliği komut ve testlerle doğrula/iu,
  /en küçük değişiklik setini planla/iu,
  /somut değişikliklere eşleyen kısa bir plan/iu,
];

const IMPLEMENTATION_REPORTS = [
  /Every requirement is implemented and verified/iu,
  /Build, type check and existing tests pass/iu,
  /The list of files created or modified/iu,
  /Verification steps that were run and their results/iu,
  /Her gereksinim uygulanmış ve doğrulanmış/iu,
  /Build, tip kontrolü ve mevcut testler geçiyor/iu,
  /Oluşturulan veya değiştirilen dosyaların listesi/iu,
  /Çalıştırılan doğrulama adımları ve sonuçları/iu,
];

function expectReadOnlyPrompt(text: string, language: Language, label: string) {
  const content = CONTENT[language];
  for (const expected of [content.goal, content.format, content.question, content.boundary, content.preserved]) {
    expect(text, label).toContain(expected);
  }
  for (const contradiction of [...IMPLEMENTATION_DIRECTIVES, ...IMPLEMENTATION_REPORTS]) {
    expect(text, `${label}: ${contradiction}`).not.toMatch(contradiction);
  }
}

function domainAdviceInput(taskType: string, goal: string, language: Language, options: Partial<CompileOptions>): CompileInput {
  const intent = advisoryIntent(language, taskType === "data_analysis" || taskType === "debugging" ? "analyze" : "advise");
  intent.task_type = taskType;
  intent.primary_goal = goal;
  intent.domain = taskType;
  intent.role = "";
  intent.expected_output = { format: "", description: "", deliverables: [] };
  intent.coding_required = taskType !== "data_analysis";
  intent.explicit_requirements = [CONTENT[language].boundary];
  intent.constraints = [CONTENT[language].boundary];
  intent.protected_elements = [];
  intent.unknowns = [];
  const input = inputFor(intent, language, "claude", options);
  input.rawRequest = `${goal}. ${CONTENT[language].boundary}.`;
  return input;
}

function expectNoImplementationDefaults(text: string) {
  for (const contradiction of [...IMPLEMENTATION_DIRECTIVES, ...IMPLEMENTATION_REPORTS]) {
    expect(text).not.toMatch(contradiction);
  }
}

describe("advisory coding prompt contracts", () => {
  for (const language of ["en", "tr"] as const) {
    for (const operation of ["advise", "analyze"] as const) {
      for (const jailbreakMode of [false, true]) {
        it(`${language} ${operation} remains read-only with JB ${jailbreakMode ? "on" : "off"} across targets, contexts and verbosity`, () => {
          const intent = advisoryIntent(language, operation);
          for (const target of TARGETS) {
            for (const executionContext of CONTEXTS) {
              for (const verbosity of VERBOSITIES) {
                const input = inputFor(intent, language, target, {
                  jailbreakMode, executionContext, agentMode: executionContext === "agent", verbosity, technicality: "technical",
                });
                const before = structuredClone(input);
                const result = compilePrompt(input);
                expectReadOnlyPrompt(result.text, language, `${target}/${executionContext}/${verbosity}`);
                expect(result.target).toBe(target);
                expect(input).toEqual(before);
              }
            }
          }
        });
      }
    }
  }

  it.each(["en", "tr"] as const)("preserves a concrete advisory plan and its unanswered question in %s", (language) => {
    const intent = advisoryIntent(language, "advise", true);
    const input = inputFor(intent, language, "codex", { jailbreakMode: true, agentMode: true, executionContext: "agent" });
    const result = compilePrompt(input);
    expectReadOnlyPrompt(result.text, language, "planned advice");
    for (const step of CONTENT[language].steps) {
      expect(result.text).toContain(step.action);
      expect(result.text).toContain(step.verification);
    }
    expect(result.text).toContain(CONTENT[language].approach);
  });

  it.each(["en", "tr"] as const)("does not turn a missing advisory output format into a changed-files report in %s", (language) => {
    const intent = advisoryIntent(language, "analyze");
    intent.expected_output = { format: "", description: "", deliverables: [] };
    const input = inputFor(intent, language, "codex", { jailbreakMode: true, agentMode: true, executionContext: "agent" });
    const result = compilePrompt(input);
    expect(result.text).toContain(CONTENT[language].goal);
    for (const contradiction of [...IMPLEMENTATION_DIRECTIVES, ...IMPLEMENTATION_REPORTS]) {
      expect(result.text).not.toMatch(contradiction);
    }
  });

  it.each([false, true])("regenerates a legacy saved advisory spec without its old engineering defaults with JB %s", (jailbreakMode) => {
    const input = inputFor(advisoryIntent("en", "advise"), "en", "codex", { jailbreakMode, agentMode: true, executionContext: "agent" });
    input.spec.requiredActions = [
      { id: "act_old_1", text: "Inspect the existing code paths related to the objective", source: "default" },
      { id: "act_old_2", text: "Implement the required changes with minimal, focused edits", source: "default" },
      { id: "act_owner", text: "Explain which unit tests would validate capped jitter, without adding them", source: "explicit" },
    ];
    input.spec.successCriteria = [
      { id: "done_old_1", text: "Every requirement is implemented and verified", source: "default" },
      { id: "done_old_2", text: "Build, type check and existing tests pass", source: "default" },
      { id: "done_owner", text: "The recommendation identifies proposed unit-test cases without executing them", source: "revision" },
    ];
    const before = structuredClone(input);
    const result = compilePrompt(input);
    expectReadOnlyPrompt(result.text, "en", "legacy advisory spec");
    expect(result.text).toContain("Explain which unit tests would validate capped jitter, without adding them");
    expect(result.text).toContain("The recommendation identifies proposed unit-test cases without executing them");
    expect(input).toEqual(before);
  });

  it.each(["en", "tr"] as const)("critic repair does not reintroduce implementation into an incomplete advisory state in %s", async (language) => {
    const intent = advisoryIntent(language, "analyze");
    const input = inputFor(intent, language, "codex", { jailbreakMode: true, agentMode: true, executionContext: "agent" });
    const base = await runAnalysisPipeline({ rawRequest: input.rawRequest, language, targetAI: "codex", jailbreakMode: true }, null);
    const prison = {
      ...base,
      intent,
      spec: { ...input.spec, requiredActions: [], successCriteria: [] },
      compileOptions: input.options,
    };
    const compiled = compilePrompt(toCompileInput(prison));
    const findings = runRules({ prison, compiled, validation: validateOutput(compiled), profile: resolveTaskProfile("coding") });
    const patch = mergeFixes(findings);
    expect(patch?.add?.requiredActions ?? []).toEqual([]);
    expect(patch?.add?.successCriteria?.length).toBeGreaterThan(0);
    const repaired = applyPatch(prison, patch!, CRITIC_POLICY).prison;
    expectReadOnlyPrompt(compilePrompt(toCompileInput(repaired)).text, language, "critic-repaired advice");
    expect(prison.spec.requiredActions).toEqual([]);
    expect(prison.spec.successCriteria).toEqual([]);
  });

  it.each([false, true])("keeps actual implementation and verification for an authorized modification with JB %s", (jailbreakMode) => {
    const intent = paymentIntent({
      primary_goal: "Add capped jitter to the checkout retry handler",
      explicit_requirements: ["Preserve the checkout response schema", "Do not deploy"],
      required_actions: [],
      success_conditions: [],
      expected_output: { format: "", description: "", deliverables: [] },
      execution_plan: null,
    });
    const input = inputFor(intent, "en", "codex", { jailbreakMode, agentMode: true, executionContext: "agent" });
    input.rawRequest = "Add capped jitter to the checkout retry handler. Preserve the checkout response schema. Do not deploy.";
    const result = compilePrompt(input);
    expect(result.text).toContain(intent.primary_goal);
    expect(result.text).toMatch(/Implement in small, verifiable steps|Implement the required changes/iu);
    expect(result.text).toMatch(/run the relevant build|Run the existing build/iu);
    expect(result.text).toContain("Add or update tests for new or changed behavior");
    expect(result.text).toContain("Every requirement is implemented and verified");
    expect(result.text).toContain("Preserve the checkout response schema");
    expect(result.text).toContain("Do not deploy");
  });

  it("retains evidence, severity and prioritized remediation in security advice and its agent protocol", () => {
    for (const language of ["en", "tr"] as const) {
      for (const jailbreakMode of [false, true]) {
        for (const agentMode of [false, true]) {
          const goal = language === "en" ? "Review the supplied checkout authentication configuration and recommend defensive improvements" : "Sunulan ödeme kimlik doğrulama yapılandırmasını incele ve savunma odaklı iyileştirmeler öner";
          const input = domainAdviceInput("security_analysis", goal, language, { jailbreakMode, agentMode, executionContext: agentMode ? "agent" : "chat" });
          const result = compilePrompt(input);
          const workflow = result.blocks.find((block) => block.id === "EXECUTION_PROTOCOL")?.items?.join("\n") ?? "";
          expect(workflow).toContain(language === "en" ? "collect evidence for every finding" : "her bulgu için kanıt topla");
          expect(workflow).toContain(language === "en" ? "severity and likelihood" : "önem ve olasılığa");
          expect(workflow).toContain(language === "en" ? "prioritized remediations" : "önceliklendirilmiş iyileştirmeler");
          expect(result.text).toContain(language === "en" ? "Findings with severity, evidence and affected component" : "Önem derecesi, kanıt ve etkilenen bileşenle bulgular");
          expect(result.text).toContain(language === "en" ? "Prioritized remediation steps" : "Önceliklendirilmiş iyileştirme adımları");
          expect(result.text).toContain(CONTENT[language].boundary);
          expectNoImplementationDefaults(result.text);
        }
      }
    }
  });

  it("retains interface accessibility checks and architecture deliverables when advice output fields are empty", () => {
    for (const language of ["en", "tr"] as const) {
      for (const jailbreakMode of [false, true]) {
        const options = { jailbreakMode, agentMode: true, executionContext: "agent" as const };
        const ui = compilePrompt(domainAdviceInput("ui_ux", language === "en" ? "Review the supplied checkout screens and recommend usability improvements" : "Sunulan ödeme ekranlarını incele ve kullanılabilirlik iyileştirmeleri öner", language, options));
        expect(ui.text).toContain(language === "en" ? "responsiveness and accessibility (contrast, focus states, semantics)" : "Duyarlılığı ve erişilebilirliği kontrol et (kontrast, odak durumları, semantik)");
        expectNoImplementationDefaults(ui.text);

        const architecture = compilePrompt(domainAdviceInput("software_architecture", language === "en" ? "Recommend an architecture for the supplied order-processing requirements" : "Sunulan sipariş işleme gereksinimleri için bir mimari öner", language, options));
        const output = architecture.blocks.find((block) => block.id === "OUTPUT_CONTRACT")?.items?.join("\n") ?? "";
        expect(output).toContain(language === "en" ? "components, responsibilities and data flow" : "Bileşenler, sorumluluklar ve veri akışı");
        expect(output).toContain(language === "en" ? "alternatives considered and trade-offs" : "alternatifler ve ödünleşimlerle");
        expectNoImplementationDefaults(architecture.text);
      }
    }
  });

  it("retains missing-value, outlier, causation and factual validation rigor in data analysis", () => {
    for (const language of ["en", "tr"] as const) {
      for (const jailbreakMode of [false, true]) {
        const input = domainAdviceInput("data_analysis", language === "en" ? "Analyze the supplied sales CSV and explain supported trends" : "Sunulan satış CSV dosyasını analiz et ve kanıtlı eğilimleri açıkla", language, { jailbreakMode, agentMode: true, executionContext: "agent" });
        const result = compilePrompt(input);
        expect(result.text).toContain(language === "en" ? "missing values and outliers" : "eksik değerler ve aykırı değerler");
        expect(result.text).toContain(language === "en" ? "Distinguish correlation from causation" : "Korelasyonu nedensellikten ayır");
        expect(result.text).toContain(language === "en" ? "Separate verified facts, inferences and assumptions explicitly" : "Doğrulanmış gerçekleri, çıkarımları ve varsayımları açıkça ayır");
        expectNoImplementationDefaults(result.text);
      }
    }
  });

  it("keeps debugging analysis read-only instead of inheriting fix, regression-test and completed-fix defaults", () => {
    for (const language of ["en", "tr"] as const) {
      for (const jailbreakMode of [false, true]) {
        const input = domainAdviceInput("debugging", language === "en" ? "Analyze the supplied timeout logs and recommend likely causes" : "Sunulan zaman aşımı günlüklerini analiz et ve olası nedenleri öner", language, { jailbreakMode, agentMode: true, executionContext: "agent" });
        const result = compilePrompt(input);
        expect(result.text).toContain(input.spec.primaryGoal);
        expect(result.text).toContain(CONTENT[language].boundary);
        expect(result.text).not.toMatch(/Apply the smallest fix|Add a regression test and verify the fix|The original problem no longer reproduces|A test covers the failure and passes/iu);
        expect(result.text).not.toMatch(/Kök nedeni çözen en küçük düzeltmeyi uygula|Regresyon testi ekle ve düzeltmeyi doğrula|Orijinal problem artık tekrarlanmıyor|Hatayı kapsayan bir test var ve geçiyor/iu);
        expectNoImplementationDefaults(result.text);
      }
    }
  });
});
