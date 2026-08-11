import { z } from "zod";
import { vaultSettingsSchema as sharedVaultSettingsSchema } from "../../../shared/vault.ts";

export const vaultSettingsSchema = sharedVaultSettingsSchema;

export const auditEventSchemaForMessages = z.object({
  eventType: z.string().max(80),
  timestamp: z.string(),
  packId: z.string().max(80).optional(),
  revision: z.number().int().min(1).optional(),
  destination: z.string().max(100).optional(),
  result: z.enum(["success", "blocked", "failed"]),
  characters: z.number().int().min(0).max(2_000_000),
  criticalFindings: z.number().int().min(0).max(1_000),
  warningFindings: z.number().int().min(0).max(1_000),
  mode: z.enum(["full", "delta", "none"]),
}).strict();
