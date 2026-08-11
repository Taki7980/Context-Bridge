import { z } from "zod";
import { contextPackSchema } from "../../shared/context-pack.ts";
import { auditEventSchemaForMessages, vaultSettingsSchema } from "./storage/validation.ts";

const base = {
  requestId: z.uuid(),
};

export const requestSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("STATUS") }).strict(),
  z.object({ ...base, type: z.literal("SETUP_VAULT"), passphrase: z.string().min(12).max(1_024), confirmation: z.string().min(12).max(1_024), remember: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("UNLOCK"), passphrase: z.string().min(1).max(1_024), remember: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("LOCK") }).strict(),
  z.object({ ...base, type: z.literal("CAPTURE_SELECTION") }).strict(),
  z.object({ ...base, type: z.literal("CAPTURE_PROVIDER") }).strict(),
  z.object({ ...base, type: z.literal("DETECT_PROVIDER") }).strict(),
  z.object({ ...base, type: z.literal("SAVE_PACK"), pack: contextPackSchema, acknowledgeWarnings: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("LIST_PACKS") }).strict(),
  z.object({ ...base, type: z.literal("GET_PACK"), id: z.uuid(), revision: z.number().int().min(1).optional() }).strict(),
  z.object({ ...base, type: z.literal("GET_PACK_RECORD"), id: z.uuid() }).strict(),
  z.object({ ...base, type: z.literal("DELETE_PACK"), id: z.uuid() }).strict(),
  z.object({ ...base, type: z.literal("DELETE_ALL_PACKS") }).strict(),
  z.object({ ...base, type: z.literal("GET_SETTINGS") }).strict(),
  z.object({ ...base, type: z.literal("SAVE_SETTINGS"), settings: vaultSettingsSchema }).strict(),
  z.object({ ...base, type: z.literal("VALIDATE_OUTBOUND"), text: z.string().min(1).max(250_000), trust: z.enum(["user", "agent", "web"]), acknowledgeWarnings: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("INSERT_REVIEWED"), text: z.string().min(1).max(250_000), digest: z.string().regex(/^[a-f0-9]{64}$/), packId: z.uuid(), revision: z.number().int().min(1), acknowledgeWarnings: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("ACTIVATE_LOCAL"), pack: contextPackSchema, rendered: z.string().min(1).max(250_000), digest: z.string().regex(/^[a-f0-9]{64}$/), ttlMinutes: z.number().int().min(1).max(60), acknowledgeWarnings: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("REVOKE_LOCAL") }).strict(),
  z.object({ ...base, type: z.literal("LOCAL_STATUS") }).strict(),
  z.object({ ...base, type: z.literal("MARK_DESTINATION"), id: z.uuid(), label: z.string().trim().min(1).max(100), revision: z.number().int().min(1), policyRevision: z.number().int().min(1).optional() }).strict(),
  z.object({ ...base, type: z.literal("APPEND_AUDIT"), event: auditEventSchemaForMessages }).strict(),
  z.object({ ...base, type: z.literal("READ_AUDIT") }).strict(),
  z.object({ ...base, type: z.literal("CLEAR_AUDIT") }).strict(),
  z.object({ ...base, type: z.literal("EXPORT_BACKUP") }).strict(),
  z.object({ ...base, type: z.literal("IMPORT_BACKUP"), json: z.string().min(1).max(12_000_000) }).strict(),
  z.object({ ...base, type: z.literal("CHANGE_PASSPHRASE"), currentPassphrase: z.string().min(1).max(1_024), newPassphrase: z.string().min(12).max(1_024), confirmation: z.string().min(12).max(1_024) }).strict(),
  z.object({ ...base, type: z.literal("DESTROY_VAULT") }).strict(),
  z.object({ ...base, type: z.literal("GENERATE_MCP_SETUP") }).strict(),
]);

export type ExtensionRequest = z.infer<typeof requestSchema>;

export type ExtensionResponse =
  | { ok: true; requestId: string; data: unknown }
  | { ok: false; requestId: string; error: string };
