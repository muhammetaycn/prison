import { LANGUAGES, TARGET_AIS, type Language, type TargetAI } from "@/models/common";
import { TARGET_LABELS } from "@/templates/ui-labels";
import type { SegmentedOption } from "./Segmented";

export const TARGET_OPTIONS: ReadonlyArray<SegmentedOption<TargetAI>> = TARGET_AIS.map((value) => ({
  value,
  label: TARGET_LABELS[value],
}));

const LANGUAGE_LABELS: Record<Language, string> = { en: "EN", tr: "TR" };

export const LANGUAGE_OPTIONS: ReadonlyArray<SegmentedOption<Language>> = LANGUAGES.map((value) => ({
  value,
  label: LANGUAGE_LABELS[value],
}));
