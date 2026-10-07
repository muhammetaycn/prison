import { describe, expect, it } from "vitest";
import type { CompileInput } from "@/core/context-engine";
import { compilePrompt } from "@/core/prompt-compiler";
import { resolveRequirements } from "@/core/requirement-resolver";
import { DEFAULT_COMPILE_OPTIONS, type CompileOptions } from "@/models/options";
import type { TargetAI } from "@/models/common";
import type { PrisonSpec } from "@/models/spec";
import { paymentIntent } from "./helpers";

function resolved(overrides: Parameters<typeof paymentIntent>[0] = {}): PrisonSpec {
  return resolveRequirements({ intent: paymentIntent(overrides), language: "en", itemSeq: 0 }).spec;
}

function input(spec: PrisonSpec, targetAI: TargetAI = "auto", options: Partial<CompileOptions> = {}): CompileInput {
  return {
    prisonId: "pr_test0001",
    spec,
    rawRequest: "Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.",
    language: "en",
    targetAI,
    options: { ...DEFAULT_COMPILE_OPTIONS, ...options },
  };
}

const texts = (items: { text: string }[]) => items.map((i) => i.text);

describe("requirement resolver", () => {
  it("tags sources and adds existing-system protections as defaults", () => {
    const ownerRequirement = "Add a payment system";
    const spec = resolved({ explicit_requirements: [ownerRequirement] });
    expect(spec.requirements.find((r) => r.text === ownerRequirement)?.source).toBe("explicit");
    expect(spec.requirements.find((r) => r.text === "Handle failed payments safely")?.source).toBe("implicit");
    expect(spec.assumptions[0]?.source).toBe("assumed");
    const defaults = spec.protectedElements.filter((p) => p.source === "default").map((p) => p.text);
    expect(defaults).toContain("Existing architecture, framework and core library choices");
    expect(texts(spec.disallowedOperations)).toContain("Rewrite the project or large parts of it from scratch");
  });

  it("forbids deployment by default for code work, without duplicating an existing deploy prohibition", () => {
    const spec = resolved();
    expect(spec.deploymentPermission).toBe("forbidden");
    const deployItems = spec.disallowedOperations.filter((d) => /deploy/i.test(d.text));
    expect(deployItems).toHaveLength(1);
  });

  it("allows deployment only when asked, with a verification guard", () => {
    const spec = resolved({ deployment_permission: "allowed", deployment_required: true, disallowed_operations: [] });
    expect(spec.deploymentPermission).toBe("allowed");
    expect(spec.disallowedOperations.some((d) => /deploy/i.test(d.text))).toBe(false);
    expect(texts(spec.constraints)).toContain("Deploy only after every verification step has passed");
  });

  it("records advice-only guards and contradictions", () => {
    const spec = resolved({ advice_only: true, execution_required: true, operation: "advise" });
    expect(texts(spec.constraints)).toContain("Provide recommendations only; do not apply changes directly");
    expect(spec.conflicts.length).toBeGreaterThan(0);
  });

  it("gives item ids that are unique within the prison", () => {
    const spec = resolved();
    const ids = Object.values(spec)
      .filter(Array.isArray)
      .flat()
      .filter((v): v is { id: string } => typeof v === "object" && v !== null && "id" in v)
      .map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("prompt compiler", () => {
  it.each(["concise", "detailed"] as const)("preserves complete boundary directives without reversing them in %s mode", (verbosity) => {
    const spec = resolved({ disallowed_operations: ["Keep deployment disabled", "Do not expose production credentials", "Deploy to production"] });
    const original = structuredClone(spec);
    const compiled = compilePrompt(input(spec, "gpt", { verbosity }));
    const constraints = compiled.blocks.find((block) => block.id === "CONSTRAINTS")?.items;
    expect(constraints).toContain("Keep deployment disabled");
    expect(constraints).toContain("Do not expose production credentials");
    expect(compiled.text).not.toContain("Do not keep deployment disabled");
    expect(compiled.text).not.toContain("Do not do not expose production credentials");
    if (verbosity === "concise") expect(constraints).toContain("Do not deploy to production");
    else expect(compiled.blocks.find((block) => block.id === "DO_NOT_DO")?.items).toContain("Deploy to production");
    expect(spec).toEqual(original);
  });

  it("is deterministic: same prison input, same prompt", () => {
    const spec = resolved();
    expect(compilePrompt(input(spec)).text).toBe(compilePrompt(input(spec)).text);
  });

  it("resolves AUTO to the target named in the request, but never overrides an explicit choice", () => {
    const spec = resolved();
    expect(compilePrompt(input(spec, "auto")).target).toBe("codex");
    expect(compilePrompt(input(spec, "auto")).targetReason).toBe("request_mentioned");
    expect(compilePrompt(input(spec, "claude")).target).toBe("claude");
    const unnamed = resolved({ target_ai_mentioned: null });
    expect(compilePrompt(input(unnamed, "auto")).targetReason).toBe("ai_recommendation");
    expect(compilePrompt(input({ ...unnamed, taskPlan: null }, "auto")).targetReason).toBe("coding_existing");
  });

  it("renders a repository brief for Codex", () => {
    const text = compilePrompt(input(resolved(), "codex")).text;
    expect(text).toContain("## Task\nAdd a payment system to the existing project without breaking current functionality.");
    expect(text).toContain("## Must Not Break");
    expect(text).toContain("## Done When");
    expect(text).toContain("AGENTS.md");
  });

  it("renders XML sections for Claude with context before the objective", () => {
    const text = compilePrompt(input(resolved(), "claude")).text;
    expect(text).toMatch(/^You are a senior full-stack engineer/);
    expect(text).toContain("<objective>");
    expect(text.indexOf("<context>")).toBeLessThan(text.indexOf("<objective>"));
    expect(text).not.toContain("## ");
  });

  it("ends Gemini prompts with an anchoring instruction and keeps GPT in Markdown", () => {
    expect(compilePrompt(input(resolved(), "gemini")).text.trim()).toMatch(/return the output exactly as specified\.$/);
    expect(compilePrompt(input(resolved(), "gpt")).text).toContain("## Objective");
  });

  it("separates assumptions from facts", () => {
    const text = compilePrompt(input(resolved(), "gpt")).text;
    expect(text).toContain("Working assumptions, not verified facts");
    expect(text).toContain("Unknown. Do not invent answers");
  });

  it("concise is shorter than detailed and folds protections into constraints", () => {
    const spec = resolved();
    const concise = compilePrompt(input(spec, "gpt", { verbosity: "concise" }));
    const detailed = compilePrompt(input(spec, "gpt", { verbosity: "detailed" }));
    expect(concise.text.length).toBeLessThan(detailed.text.length);
    expect(concise.blocks.some((b) => b.id === "PROTECTED_ELEMENTS")).toBe(false);
    expect(concise.text).toContain("Keep intact: Existing user flows");
    expect(detailed.blocks.some((b) => b.id === "USER_INTENT")).toBe(true);
  });

  it("strict scope locks the scope; open scope frees the solution; both keep the protections", () => {
    const spec = resolved();
    const strict = compilePrompt(input(spec, "gpt", { scope: "strict" })).text;
    const open = compilePrompt(input(spec, "gpt", { scope: "open" })).text;
    expect(strict).toContain("Stay strictly inside this scope");
    expect(strict).toContain("Add features, files or dependencies that were not requested");
    expect(open).toContain("propose improvements beyond the minimum");
    for (const text of [strict, open]) {
      expect(text).toContain("The scope is locked; your problem-solving is not.");
      expect(text).toContain("Existing user flows");
    }
  });

  it("agent mode adds an autonomous loop with target-specific behavior", () => {
    const spec = resolved();
    expect(compilePrompt(input(spec, "gpt", { agentMode: true })).text).toContain("Keep going until the task is completely resolved");
    expect(compilePrompt(input(spec, "codex", { agentMode: true })).text).toContain("Work autonomously through this loop");
  });

  it("technical mode adds precision and exact command reporting", () => {
    const text = compilePrompt(input(resolved(), "gpt", { technicality: "technical" })).text;
    expect(text).toContain("reference concrete files, functions, commands");
    expect(text).toContain("Report the exact commands you ran");
  });

  it("only uses the given prison's state (no leakage between prisons)", () => {
    const a = resolved({ primary_goal: "Add a payment system to the shop" });
    const b = resolveRequirements({
      intent: paymentIntent({
        primary_goal: "Write an onboarding email sequence",
        task_type: "writing",
        coding_required: false,
        existing_system: false,
        explicit_requirements: ["Five emails"],
        target_ai_mentioned: null,
      }),
      language: "en",
      itemSeq: 0,
    }).spec;
    const textA = compilePrompt(input(a)).text;
    const textB = compilePrompt(input(b)).text;
    expect(textA).not.toContain("onboarding email");
    expect(textB).not.toContain("payment system to the shop");
  });
});
