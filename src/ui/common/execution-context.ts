import type { ExecutionContext } from "@/models/options";
import { OPTION_VALUE_LABELS } from "@/templates/ui-labels";

export const EXECUTION_CONTEXT_LABELS: Record<ExecutionContext, string> = OPTION_VALUE_LABELS.executionContext;

export const EXECUTION_CONTEXT_DESCRIPTIONS: Record<ExecutionContext, string> = {
  chat: "Prompt, sohbet içinde yanıt verecek bir AI için hazırlanır.",
  mobile: "Prompt, telefonda okunup kullanılacak bir AI için hazırlanır.",
  browser: "Prompt, tarayıcıda çalışacak bir AI için hazırlanır. Erişim ve işlem sınırların korunur.",
  agent: "Prompt, dosyalar ve araçlarla çalışabilen bir agent için hazırlanır. Yetkileri senin isteğin belirler.",
};

export const EXECUTION_CONTEXT_OPTIONS = (Object.keys(EXECUTION_CONTEXT_LABELS) as ExecutionContext[]).map((value) => ({
  value,
  label: EXECUTION_CONTEXT_LABELS[value],
}));
