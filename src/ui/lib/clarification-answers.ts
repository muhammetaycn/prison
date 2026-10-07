import type { ClarificationAnswer } from "@/models/prison";

export const MAX_CLARIFICATION_LENGTH = 2000;

/** Preserve each owner's answer with its question; never truncate or supply missing answers. */
export function clarificationMessage(questions: readonly string[], answers: Readonly<Record<string, string>>) {
  const clarifications: ClarificationAnswer[] = [...new Set(questions)].flatMap((question) => {
    const answer = Object.hasOwn(answers, question) ? answers[question]?.trim() : "";
    return answer ? [{ question, answer }] : [];
  });
  // Generated question text is contextual metadata, never an owner statement or permission.
  const message = clarifications.map((entry) => entry.answer).join("\n\n");
  return { clarifications, message, answered: clarifications.length, tooLong: message.length > MAX_CLARIFICATION_LENGTH };
}
