import { z } from "zod";

export const ProviderTypeSchema = z.enum(["nvidia", "deepseek", "openai", "anthropic", "compatible"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export const ProviderProfileSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  provider: ProviderTypeSchema,
  baseURL: z.string().trim().min(1).max(500),
}).strict();
export const ProviderSelectionSchema = z.object({
  providerId: ProviderProfileSchema.shape.id,
  model: z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:/-]*$/i),
}).strict();
export const ProviderCouncilSchema = z.object({
  enabled: z.boolean(),
  depth: z.enum(["quick", "deep"]),
  members: z.array(ProviderSelectionSchema.extend({ role: z.string().trim().min(1).max(160).optional() })).max(6),
}).strict();

/** Omitting apiKey preserves a credential. Null explicitly clears it, including environment fallback. */
export const ProviderSettingsInputSchema = z.object({
  revision: z.string().min(1).max(100),
  providers: z.array(ProviderProfileSchema.extend({ apiKey: z.string().trim().min(1).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/).nullable().optional() })).max(12),
  primary: ProviderSelectionSchema.nullable(),
  council: ProviderCouncilSchema,
}).strict();
export const ProviderSettingsResetSchema = z.object({ revision: z.string().min(1).max(100) }).strict();
export type ProviderSettingsInput = z.infer<typeof ProviderSettingsInputSchema>;
export type ProviderSelection = z.infer<typeof ProviderSelectionSchema>;
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
export interface PublicProviderSettings {
  revision: string;
  source: "environment" | "saved";
  providers: Array<ProviderProfile & { keyPresent: boolean; keySource: "saved" | "environment" | "none" }>;
  primary: ProviderSelection | null;
  council: z.infer<typeof ProviderCouncilSchema>;
  /** Redacted optional environment-team diagnostic; never part of the editable/saved input contract. */
  councilConfigurationError?: string;
}
