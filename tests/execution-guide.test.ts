import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/ui/i18n";
import { ExecutionGuide } from "@/ui/participation/ExecutionGuide";
import { PromptHandoff } from "@/ui/participation/PromptHandoff";
import { PromptJourney } from "@/ui/participation/PromptJourney";
import { HandoffTaskProvider } from "@/ui/participation/HandoffTaskContext";
import { buildExecutionGuide, defaultExecutionDestination, executionKind, type ExecutionGuideInput } from "@/ui/participation/execution-guide";
import { promptExport, promptUseInstruction } from "@/ui/participation/prompt-transfer";

const input: ExecutionGuideInput = { target: "gpt", context: "chat" };

describe("practical execution routing", () => {
  it.each([
    "Bir uçak modellemek istiyorum", "I want to model an airplane", "我想创建飞机模型", "Blender ile bir sahne üret", "Create a low-poly character as GLB", "三维角色建模",
  ])("routes a concrete 3D goal to Blender: %s", (goal) => {
    const plan = buildExecutionGuide({ ...input, goal }, "en");
    expect(plan.kind).toBe("model3d");
    expect(plan.links.some((link) => link.href === "https://www.blender.org/download/")).toBe(true);
    expect(plan.steps.join(" ")).toContain("Run Script");
    expect(plan.verify).toContain("editable model");
    expect(plan.limitation).toContain("does not certify a physical aircraft");
  });

  it.each(["Configure model APIs", "Dil modeli API bağlantısını düzelt", "Optimize a language model", "优化语言模型", "Create a data model for airplane bookings"])("does not send a generic AI/data model to Blender: %s", (goal) => {
    expect(executionKind({ goal })).not.toBe("model3d");
  });

  it("keeps an airplane image request in the image workflow", () => {
    const guide = buildExecutionGuide({ ...input, taskType: "image_generation", goal: "Make an image of a 3D airplane model" }, "en");
    expect(guide.kind).toBe("image");
    expect(guide.limitation).toContain("model name alone");
    expect(guide.links.some((link) => link.href.includes("blender"))).toBe(false);
  });

  it.each([
    ["Create a Three.js React viewer for GLB models", "coding"],
    ["Fix the GLTF loader in my WebGL renderer", "debugging"],
    ["React ile Blender'dan dışa aktarılan uçak modelinin 3D görüntüleyicisini yaz", "coding"],
    ["编写一个三维 GLB 模型查看器", "coding"],
    ["Build a Three.js viewer", undefined],
  ])("routes software that displays models to code, without a Blender download (%s)", (goal, taskType) => {
    const guide = buildExecutionGuide({ ...input, goal, taskType }, "en");
    expect(guide.kind).toBe("code");
    expect(guide.links.some((link) => link.href.includes("blender"))).toBe(false);
  });

  it("keeps actual Blender asset creation scripts in the 3D workflow", () => {
    const guide = buildExecutionGuide({ ...input, taskType: "coding", goal: "Write a bpy script that creates an airplane in Blender and exports GLB" }, "en");
    expect(guide.kind).toBe("model3d");
    expect(guide.links.some((link) => link.href === "https://www.blender.org/download/")).toBe(true);
  });

  it("prefers the displayed revision's goal over an older original request", () => {
    expect(executionKind({ rawRequest: "I want a Blender aircraft model", goal: "Write a poem about flying", taskType: "writing" })).toBe("writing");
  });

  it.each([
    ["Implement a TypeScript API", "coding", "code"], ["修复代码中的错误", undefined, "code"],
    ["Analyze my spreadsheet", "data_analysis", "data"], ["分析数据分析结果", undefined, "data"],
    ["Find sources for this claim", "research", "research"], ["研究本地历史", undefined, "research"],
    ["Create a film", "video_generation", "video"], ["Write a proposal", "document_generation", "writing"],
  ] as const)("selects a workflow from concrete task evidence (%s)", (goal, taskType, kind) => {
    expect(executionKind({ goal, taskType })).toBe(kind);
  });

  it("keeps ambiguous physical product requests open instead of inventing a 3D task", () => {
    const guide = buildExecutionGuide({ ...input, goal: "Uçak yapmak istiyorum" }, "tr");
    expect(guide.kind).toBe("general");
    expect(guide.steps.join(" ")).toContain("fiziksel ürün");
    expect(guide.links.some((link) => link.href.includes("blender"))).toBe(false);
  });

  it("routes Claude agents to Claude Code while ordinary Claude chat stays chat", () => {
    expect(defaultExecutionDestination("claude", "agent")).toBe("claude-code");
    expect(defaultExecutionDestination("claude", "chat")).toBe("claude");
    const plan = buildExecutionGuide({ ...input, target: "claude", context: "agent", taskType: "coding" }, "en");
    expect(plan.links[0]!.href).toBe("https://code.claude.com/docs/en/quickstart");
    expect(plan.steps[0]).toContain("project folder");
  });

  it("uses a cloud environment route for Codex on mobile or browser", () => {
    for (const context of ["mobile", "browser"] as const) {
      const guide = buildExecutionGuide({ ...input, target: "codex", context, taskType: "coding" }, "en");
      expect(guide.links[0]!.href).toBe("https://learn.chatgpt.com/docs/cloud");
      expect(guide.steps[0]).toContain("published environment");
      expect(guide.steps[0]).not.toContain("terminal");
    }
  });

  it("makes manual versus project-agent execution concrete without promising unseen actions", () => {
    const chat = buildExecutionGuide({ ...input, taskType: "coding" }, "en");
    expect(chat.steps.join(" ")).toContain("not yet been applied to your project");
    const agent = buildExecutionGuide({ ...input, target: "codex", context: "agent", taskType: "coding" }, "en");
    expect(agent.steps.join(" ")).toContain("run the project's commands");
    expect(agent.verify).toContain("real inputs");
  });

  it("lets the owner choose Kimi without changing their target or prompt", () => {
    const original = { ...input, target: "claude" as const, goal: "Analyze CSV records", taskType: "data_analysis" };
    const before = structuredClone(original);
    const plan = buildExecutionGuide(original, "zh", "kimi");
    expect(plan.destination).toBe("kimi");
    expect(plan.links[0]!.href).toBe("https://www.kimi.com/");
    expect(plan.steps.join(" ")).toContain("Kimi");
    expect(original).toEqual(before);
    const text = "精确的提示词\nGörev\n";
    expect(promptExport(text, 2, original.target).text).toBe(text);
  });

  it("only renders official static navigation links with no request transfer", () => {
    const rawRequest = "PRIVATE USER DATA?api_key=private";
    const onRevise = vi.fn(async () => true);
    const html = renderToStaticMarkup(createElement(PromptHandoff, { ...input, text: rawRequest, rawRequest, version: 1, active: true, busy: false, onRevise }));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["https://chatgpt.com/"]);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain(rawRequest);
    expect(onRevise).not.toHaveBeenCalled();
  });

  it("shows requested deliverables and criteria as escaped task data", () => {
    const html = renderToStaticMarkup(createElement(ExecutionGuide, { ...input, goal: "Blender scene", deliverables: ["editable.blend", "<script>alert(1)</script>"], successCriteria: ["Model opens with the correct scale"] }));
    expect(html).toContain("editable.blend");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Model opens with the correct scale");
  });
});

describe("TR / EN / Chinese handoff", () => {
  const taskContext = { goal: "Model an airplane in Blender", rawRequest: "old source request", taskType: "general_reasoning", deliverables: ["context-plane.blend"], successCriteria: ["context-scale-check"] };

  it("uses the viewed version's context when output components omit the new props", () => {
    const html = renderToStaticMarkup(createElement(HandoffTaskProvider, { value: taskContext, children: createElement(PromptHandoff, { ...input, text: "prompt", version: 1, active: true, busy: false }) }));
    expect(html).toContain('href="https://www.blender.org/download/"');
    expect(html).toContain("context-plane.blend");
    expect(html).toContain("context-scale-check");
  });

  it("prefers explicitly supplied version props over surrounding context", () => {
    const html = renderToStaticMarkup(createElement(HandoffTaskProvider, { value: taskContext, children: createElement(PromptHandoff, { ...input, text: "prompt", version: 2, active: true, busy: false, goal: "Write a poem", taskType: "writing", deliverables: ["explicit-poem.txt"], successCriteria: ["explicit-length-check"] }) }));
    expect(html).not.toContain('href="https://www.blender.org/download/"');
    expect(html).toContain("explicit-poem.txt");
    expect(html).toContain("explicit-length-check");
    expect(html).not.toContain("context-plane.blend");
    expect(html).not.toContain("context-scale-check");
  });

  it("treats explicit empty lists as a deliberate override, rather than filling them from context", () => {
    const html = renderToStaticMarkup(createElement(HandoffTaskProvider, { value: taskContext, children: createElement(PromptHandoff, { ...input, text: "prompt", version: 3, active: true, busy: false, deliverables: [], successCriteria: [] }) }));
    expect(html).not.toContain("context-plane.blend");
    expect(html).not.toContain("context-scale-check");
  });

  it.each([
    ["tr", "Tam promptu kopyala", "Prompttan gerçek sonuca", "Rotayı sen çiziyorsun"],
    ["en", "Copy full prompt", "From prompt to real output", "You set the direction"],
    ["zh", "复制完整提示词", "从提示词到实际成果", "由你决定方向"],
  ] as const)("renders a complete localized journey and task guide (%s)", (locale, copy, guide, journey) => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale, children: [
      createElement(PromptJourney, { stage: "input", key: "journey" }),
      createElement(PromptHandoff, { ...input, goal: "我想做一个飞机模型", text: "原始提示词", version: 3, active: true, busy: false, key: "handoff" }),
    ] }));
    expect(html).toContain(copy);
    expect(html).toContain(guide);
    expect(html).toContain(journey);
    expect(html).toContain("Blender");
    expect(html).toContain('href="https://www.blender.org/download/"');
    if (locale !== "tr") expect(html).not.toContain("Tam promptu kopyala");
    expect(promptExport("原始提示词", 3, "gpt").text).toBe("原始提示词");
  });

  it("keeps complete-prompt paste instructions localized without modifying content", () => {
    expect(promptUseInstruction("Kimi", "mobile", "zh")).toContain("完整提示词");
    expect(promptUseInstruction("Claude", "chat", "en")).toContain("entire copied prompt");
  });
});
