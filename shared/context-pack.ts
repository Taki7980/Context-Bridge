import { z } from "zod";

export const LIMITS = {
  captureBytes: 1_048_576,
  recommendedCaptureBytes: 262_144,
  renderedCharacters: 48_000,
  importBytes: 2_097_152,
  title: 160,
  shortField: 8_000,
  listItem: 16_000,
  artifact: 262_144,
  evidence: 262_144,
  arrayItems: 200,
  sources: 50,
  artifacts: 200,
  evidenceItems: 200,
} as const;

export type TrustLevel = "user" | "agent" | "web";
export type Sensitivity = "normal" | "private" | "secret";
export type ArtifactType = "file" | "url" | "command" | "error" | "code";
export type PolicyProfile = "off" | "lean" | "ultra" | "caveman" | "review";
export const CONTEXT_PACK_SCHEMA_VERSION = 1 as const;

const isoDate = z.string().max(40).refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}, "Expected an ISO 8601 UTC timestamp");

const contextSourceSchema = z.object({
  id: z.uuid(),
  provider: z.string().trim().min(1).max(80),
  title: z.string().max(LIMITS.title).optional(),
  url: z.url().max(2_048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only HTTP(S) URLs are allowed").optional(),
  capturedAt: isoDate,
  trust: z.enum(["user", "agent", "web"]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const artifactSchema = z.object({
  id: z.uuid(),
  type: z.enum(["file", "url", "command", "error", "code"]),
  value: z.string().min(1).max(LIMITS.artifact),
  sourceId: z.uuid().optional(),
  exact: z.boolean(),
}).strict();

const evidenceSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  text: z.string().min(1).max(LIMITS.evidence),
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.startOffset !== undefined && value.endOffset !== undefined && value.endOffset < value.startOffset) {
    ctx.addIssue({ code: "custom", message: "endOffset must not precede startOffset" });
  }
});

const itemArray = z.array(z.string().trim().min(1).max(LIMITS.listItem)).max(LIMITS.arrayItems);

export const contextPackSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().min(1).max(LIMITS.title),
  createdAt: isoDate,
  updatedAt: isoDate,
  expiresAt: isoDate.optional(),
  goal: z.string().max(LIMITS.shortField),
  facts: itemArray,
  constraints: itemArray,
  decisions: itemArray,
  completed: itemArray,
  nextActions: itemArray,
  blockers: itemArray,
  unresolved: itemArray,
  artifacts: z.array(artifactSchema).max(LIMITS.artifacts),
  evidence: z.array(evidenceSchema).max(LIMITS.evidenceItems),
  sources: z.array(contextSourceSchema).min(1).max(LIMITS.sources),
  sensitivity: z.enum(["normal", "private", "secret"]),
  policyProfile: z.enum(["off", "lean", "ultra", "caveman", "review"]),
  parentRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((pack, ctx) => {
  const sourceIds = new Set(pack.sources.map((source) => source.id));
  for (const [index, artifact] of pack.artifacts.entries()) {
    if (artifact.sourceId && !sourceIds.has(artifact.sourceId)) {
      ctx.addIssue({ code: "custom", path: ["artifacts", index, "sourceId"], message: "Unknown sourceId" });
    }
  }
  for (const [index, evidence] of pack.evidence.entries()) {
    if (!sourceIds.has(evidence.sourceId)) {
      ctx.addIssue({ code: "custom", path: ["evidence", index, "sourceId"], message: "Unknown sourceId" });
    }
  }
  if (pack.parentRevision !== undefined && pack.parentRevision >= pack.revision) {
    ctx.addIssue({ code: "custom", path: ["parentRevision"], message: "parentRevision must precede revision" });
  }
  if (pack.expiresAt && Date.parse(pack.expiresAt) <= Date.parse(pack.createdAt)) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt must follow createdAt" });
  }
});

export type ContextSource = z.infer<typeof contextSourceSchema>;
export type ContextArtifact = z.infer<typeof artifactSchema>;
export type ContextEvidence = z.infer<typeof evidenceSchema>;
export type ContextPack = z.infer<typeof contextPackSchema>;

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

export function assertSafeObject(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error("Input nesting exceeds the safe limit");
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error("Input array exceeds the safe limit");
    for (const item of value) assertSafeObject(item, depth + 1);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Unsupported object prototype");
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (dangerousKeys.has(key)) throw new Error("Dangerous key rejected: " + key);
    assertSafeObject(child, depth + 1);
  }
}

export function parseContextPack(value: unknown): ContextPack {
  assertSafeObject(value);
  return contextPackSchema.parse(value);
}

export function parseContextPackJson(json: string): ContextPack {
  if (new TextEncoder().encode(json).byteLength > LIMITS.importBytes) throw new Error("Import exceeds the 2 MiB limit");
  const parsed: unknown = JSON.parse(json);
  return migrateContextPack(parsed);
}

type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

// Add a numbered Vn -> Vn+1 function here before increasing the current version.
// The empty table is intentional: version 1 is the first public schema.
const contextPackMigrations: Readonly<Record<number, Migration>> = Object.freeze({});

export function migrateContextPack(value: unknown): ContextPack {
  assertSafeObject(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Context Pack must be an object");
  let current = value as Record<string, unknown>;
  const sourceVersion = current.schemaVersion;
  if (!Number.isInteger(sourceVersion) || Number(sourceVersion) < 1) throw new Error("Unsupported or missing Context Pack schema version");
  if (Number(sourceVersion) > CONTEXT_PACK_SCHEMA_VERSION) throw new Error("Context Pack was created by a newer unsupported schema version");
  while (Number(current.schemaVersion) < CONTEXT_PACK_SCHEMA_VERSION) {
    const version = Number(current.schemaVersion);
    const migrate = contextPackMigrations[version];
    if (!migrate) throw new Error("No migration is available from Context Pack schema version " + version);
    current = migrate(current);
    assertSafeObject(current);
    if (Number(current.schemaVersion) !== version + 1) throw new Error("Invalid Context Pack schema migration result");
  }
  return parseContextPack(current);
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function approximateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
