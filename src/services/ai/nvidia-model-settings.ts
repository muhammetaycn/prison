import type { Effort } from "./types";

export interface NvidiaModelSettings {
  stream: boolean;
  temperature: number;
  top_p?: number;
  reasoning_effort?: "low" | "medium" | "high";
  chat_template_kwargs?: Record<string, boolean | number | string>;
}

/** Hosted NVIDIA model IDs and their model-specific wire controls, rather than generic effort guesses. */
export function nvidiaModelSettings(model: string, effort: Effort): NvidiaModelSettings {
  if (/^nvidia\/nemotron-3-ultra-/.test(model)) return {
    stream: true, temperature: 1, top_p: 0.95, reasoning_effort: "medium",
    // The hosted endpoint rejects reasoning_budget despite the NIM schema exposing it.
    chat_template_kwargs: { enable_thinking: true, medium_effort: true },
  };
  if (/^nvidia\/nemotron-3-super-/.test(model)) {
    // Super accepts low/high, not medium. Low effort keeps normal council work bounded.
    const reasoning = effort === "high" ? "high" : "low";
    return { stream: true, temperature: 1, top_p: 0.95, reasoning_effort: reasoning,
      chat_template_kwargs: { enable_thinking: true, low_effort: reasoning === "low" } };
  }
  if (/^openai\/gpt-oss-(?:20b|120b)$/.test(model)) return {
    // 20B's hosted 4096-token ceiling must also leave room for the final structured result.
    stream: true, temperature: 0.6, top_p: 0.7,
    reasoning_effort: model === "openai/gpt-oss-20b" && effort === "high" ? "medium" : effort,
  };
  if (/^z-ai\/glm-5\.3(?:-flash)?$/.test(model)) {
    // GLM interprets unsupported effort values (including "medium") as full "max" effort.
    const reasoning = effort === "high" ? "high" : "low";
    return { stream: true, temperature: 0.5, top_p: 1, reasoning_effort: reasoning,
      chat_template_kwargs: { clear_thinking: true, reasoning_effort: reasoning } };
  }
  if (model === "moonshotai/kimi-k3") return {
    // Kimi fixes top_p and other sampling parameters; only temperature is configurable here.
    stream: true, temperature: 1, reasoning_effort: effort === "high" ? "high" : "low",
  };
  if (model === "meta/muse-glimmer-30b") return {
    stream: true, temperature: 0.95, top_p: 1, reasoning_effort: effort,
    chat_template_kwargs: { reasoning_strength: effort },
  };
  if (model === "deepseek-ai/deepseek-v4.1-flash") return {
    // The hosted schema does not expose the reference model's numeric reasoning controls.
    stream: true, temperature: 1, top_p: 0.95,
  };
  if (/^nvidia\/nemotron-3\.5-lightning-/.test(model)) return {
    stream: false, temperature: 0.2, chat_template_kwargs: { enable_thinking: false },
  };
  return { stream: false, temperature: 0.2 };
}
