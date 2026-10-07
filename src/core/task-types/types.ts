import type { ConcreteTarget, Localized } from "@/models/common";
import type { BlockId } from "@/models/prompt";
import type { Operation, SpecFlags } from "@/models/spec";

export type TaskFamily = "engineering" | "analysis" | "visual" | "content" | "strategy";

export type ProtocolBlockId = "EXECUTION_PROTOCOL" | "RESEARCH_PROTOCOL" | "TEST_PROTOCOL" | "VALIDATION_PROTOCOL";

/** A template line applies only when every listed flag has the given value. */
export type FlagCondition = Partial<Record<keyof SpecFlags, boolean>>;

export interface TemplateLine {
  text: Localized;
  when?: FlagCondition;
}

export type ProtocolTemplates = Partial<Record<ProtocolBlockId, TemplateLine[]>>;

/** Defaults shared by every task type of a family. */
export interface FamilyTemplate {
  id: TaskFamily;
  /** Optional blocks that are relevant at standard verbosity. */
  blocks: BlockId[];
  protocols: ProtocolTemplates;
  agentProtocol: TemplateLine[];
  defaultActions: TemplateLine[];
  outputContract: TemplateLine[];
  successCriteria: TemplateLine[];
  expectedFormat: Localized;
  defaultOperation: Operation;
}

/**
 * Declarative description of a task type. Adding a task type = adding one profile object;
 * nothing in the engines switches on task type ids.
 */
export interface TaskTypeProfile {
  id: string;
  family: TaskFamily;
  label: Localized;
  /** English description used in the Intent Engine's task catalog. */
  description: string;
  role: Localized;
  autoTarget: ConcreteTarget;
  /** Custom overrides describe advice/review; inherited implementation defaults still need adaptation. */
  advisoryAware?: boolean;
  blocks?: BlockId[];
  protocols?: ProtocolTemplates;
  defaultActions?: TemplateLine[];
  implicitRequirements?: TemplateLine[];
  constraints?: TemplateLine[];
  disallowed?: TemplateLine[];
  outputContract?: TemplateLine[];
  successCriteria?: TemplateLine[];
  /** Folded (lowercase, ASCII-folded Turkish) stems used only by the local fallback analyzer. */
  localSignals: Array<string | [string, number]>;
}

/** Profile merged with its family template — what the engines actually consume. */
export interface ResolvedTaskProfile {
  id: string;
  family: TaskFamily;
  label: Localized;
  description: string;
  role: Localized;
  autoTarget: ConcreteTarget;
  advisoryAware?: boolean;
  blocks: BlockId[];
  protocols: ProtocolTemplates;
  agentProtocol: TemplateLine[];
  defaultActions: TemplateLine[];
  implicitRequirements: TemplateLine[];
  constraints: TemplateLine[];
  disallowed: TemplateLine[];
  outputContract: TemplateLine[];
  successCriteria: TemplateLine[];
  expectedFormat: Localized;
  defaultOperation: Operation;
  localSignals: Array<string | [string, number]>;
}
