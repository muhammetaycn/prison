import { z } from "zod";
import { ConcreteTargetSchema } from "./common";

/** Where a state item came from. Lets the UI and the compiler separate facts from defaults and guesses. */
export const ITEM_SOURCES = ["explicit", "implicit", "default", "assumed", "revision", "critic"] as const;
export const ItemSourceSchema = z.enum(ITEM_SOURCES);
export type ItemSource = z.infer<typeof ItemSourceSchema>;

export const SpecItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  source: ItemSourceSchema,
});
export type SpecItem = z.infer<typeof SpecItemSchema>;

/** Every list-valued field of the prison spec. Generic item operations iterate over this. */
export const ITEM_LIST_KEYS = [
  "secondaryGoals",
  "requirements",
  "constraints",
  "protectedElements",
  "allowedOperations",
  "disallowedOperations",
  "requiredActions",
  "assumptions",
  "unknowns",
  "successCriteria",
  "contextFacts",
  "conflicts",
] as const;
export type ItemListKey = (typeof ITEM_LIST_KEYS)[number];

export const ITEM_ID_PREFIX: Record<ItemListKey, string> = {
  secondaryGoals: "goal",
  requirements: "req",
  constraints: "con",
  protectedElements: "pro",
  allowedOperations: "allow",
  disallowedOperations: "deny",
  requiredActions: "act",
  assumptions: "asm",
  unknowns: "unk",
  successCriteria: "done",
  contextFacts: "fact",
  conflicts: "cfl",
};

export const OPERATIONS = [
  "modify_existing",
  "create_new",
  "analyze",
  "advise",
  "research",
  "generate_content",
  "generate_media",
  "automate",
  "other",
] as const;
export const OperationSchema = z.enum(OPERATIONS);
export type Operation = z.infer<typeof OperationSchema>;

export const DEPLOYMENT_PERMISSIONS = ["allowed", "forbidden", "unspecified"] as const;
export const DeploymentPermissionSchema = z.enum(DEPLOYMENT_PERMISSIONS);
export type DeploymentPermission = z.infer<typeof DeploymentPermissionSchema>;

export const SpecFlagsSchema = z.object({
  existingSystem: z.boolean(),
  newSystem: z.boolean(),
  preserveArchitecture: z.boolean(),
  executionRequired: z.boolean(),
  analysisRequired: z.boolean(),
  researchRequired: z.boolean(),
  codingRequired: z.boolean(),
  deploymentRequired: z.boolean(),
  visualGenerationRequired: z.boolean(),
  adviceOnly: z.boolean(),
});
export type SpecFlags = z.infer<typeof SpecFlagsSchema>;

export const ExpectedOutputSchema = z.object({
  format: z.string(),
  description: z.string(),
  deliverables: z.array(z.string()),
});
export type ExpectedOutput = z.infer<typeof ExpectedOutputSchema>;

/** A concise plan for achieving this task, separate from private model reasoning. */
export const TaskPlanSchema = z.object({
  approach: z.string(),
  steps: z.array(z.object({ action: z.string(), purpose: z.string(), verification: z.string() })),
  clarifyingQuestions: z.array(z.string()),
  recommendedTarget: ConcreteTargetSchema,
  targetRationale: z.string(),
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

const itemList = z.array(SpecItemSchema);

/**
 * The normalized, mutable working state of a prison.
 * The prompt compiler reads ONLY this (plus the prison's own options and raw request).
 */
export const PrisonSpecSchema = z.object({
  primaryGoal: z.string(),
  taskType: z.string(),
  secondaryTaskTypes: z.array(z.string()),
  operation: OperationSchema,
  domain: z.string(),
  role: z.string(),
  contextSummary: z.string(),
  currentSystem: z.string(),
  requestedTarget: ConcreteTargetSchema.nullable(),
  /** Legacy records can be read without inventing a plan that was never generated. */
  taskPlan: TaskPlanSchema.nullable().default(null),
  deploymentPermission: DeploymentPermissionSchema,
  flags: SpecFlagsSchema,
  expectedOutput: ExpectedOutputSchema,
  secondaryGoals: itemList,
  requirements: itemList,
  constraints: itemList,
  protectedElements: itemList,
  allowedOperations: itemList,
  disallowedOperations: itemList,
  requiredActions: itemList,
  assumptions: itemList,
  unknowns: itemList,
  successCriteria: itemList,
  contextFacts: itemList,
  conflicts: itemList,
});
export type PrisonSpec = z.infer<typeof PrisonSpecSchema>;
