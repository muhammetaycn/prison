import type { z } from "zod";
import { correctionMessage } from "@/templates/engine-prompts";
import { AIProviderError } from "./errors";
import { effectiveMaxTokens } from "./generation-budget";
import type { ChatMessage, Effort, LLMProvider } from "./types";

export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  effort: Effort;
  maxTokens?: number;
  /** Extra semantic validation beyond the schema. Return an error description, or null when valid. */
  check?: (value: T) => string | null;
  /** Total attempts including the first one. Bounded: there is no open-ended retry. */
  maxAttempts?: number;
}

type JsonParse = { ok: true; value: unknown } | { ok: false; error: string };

/** Parses JSON, tolerating DeepSeek/R1/Nemotron thinking process prose, code fences, or surrounding text. */
export function parseJsonLoose(raw: string): JsonParse {
  const original = raw.trim();
  // Parse untouched JSON first so literal thinking tags inside a JSON string remain intact.
  const candidates: string[] = [original];
  const originalFence = original.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (originalFence?.[1]?.trim()) candidates.push(originalFence[1].trim());
  const text = original.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  candidates.push(text);
  
  // 2. Code fence match (```json ... ```)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]?.trim()) {
    candidates.push(fenced[1].trim());
  }

  // 3. Extract outermost JSON object { ... }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(text.slice(first, last + 1).trim());
  }

  let lastError = "empty output";
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: lastError };
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

/**
 * Calls the provider, then parses and validates the output. On a parse/validation failure it
 * re-asks once with the errors attached (controlled retry). Truncation gets a larger token budget;
 * other provider errors are not retried here. Adapters/SDKs own their bounded HTTP retry policy;
 * NVIDIA retries only completed 429/503 responses, never timeouts or general network failures.
 */
export async function generateStructured<T>(provider: LLMProvider, request: StructuredRequest<T>): Promise<T> {
  const maxAttempts = Math.min(Math.max(request.maxAttempts ?? 2, 1), 3);
  const messages: ChatMessage[] = [{ role: "user", content: request.user }];
  let lastError = "";
  let maxTokens = effectiveMaxTokens(provider.info, request.maxTokens ?? 16000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string;
    try {
      raw = await provider.generateJson({
        system: request.system,
        messages,
        schema: request.schema,
        schemaName: request.schemaName,
        maxTokens,
        effort: request.effort,
      });
    } catch (error) {
      if (error instanceof AIProviderError && error.kind === "truncated" && attempt < maxAttempts) {
        lastError = error.detail;
        const limit = provider.info.provider === "nvidia" ? 32768 : 64000;
        maxTokens = Math.max(maxTokens, Math.min(maxTokens * 2, limit));
        continue;
      }
      throw error;
    }

    const parsed = parseJsonLoose(raw);
    if (!parsed.ok) {
      lastError = `Output is not valid JSON (${parsed.error}).`;
    } else {
      const result = request.schema.safeParse(parsed.value);
      if (!result.success) {
        lastError = formatZodIssues(result.error);
      } else {
        const semanticError = request.check?.(result.data) ?? null;
        if (!semanticError) return result.data;
        lastError = semanticError;
      }
    }

    if (attempt < maxAttempts) {
      messages.push({ role: "assistant", content: raw.slice(0, 24000) });
      messages.push({ role: "user", content: correctionMessage(lastError) });
    }
  }

  throw new AIProviderError("invalid_output", `${request.schemaName}: ${lastError}`);
}
