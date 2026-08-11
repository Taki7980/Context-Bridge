import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { contextPackSchema, nowIso, type ContextPack } from "../../../shared/context-pack.ts";
import { hasCriticalFindings, scanText } from "../../../shared/security.ts";

const activePayloadSchema = z.object({
  pack: contextPackSchema,
  rendered: z.string().min(1).max(250_000),
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
}).strict();

const stateEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  iv: z.string(),
  tag: z.string(),
  ciphertext: z.string(),
  writtenAt: z.string(),
}).strict();

export type ActivePayload = z.infer<typeof activePayloadSchema>;

export function stateDirectory(): string {
  if (process.env.CONTEXT_BRIDGE_STATE_DIR) return path.resolve(process.env.CONTEXT_BRIDGE_STATE_DIR);
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? os.homedir(), "ContextBridge");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "ContextBridge");
  return path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "context-bridge");
}

async function ensureKey(): Promise<Buffer> {
  const directory = stateDirectory();
  const keyPath = path.join(directory, "bridge.key");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const encoded = (await readFile(keyPath, "utf8")).trim();
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32 || key.toString("base64") !== encoded) throw new Error("Invalid local bridge key");
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString("base64"), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(keyPath, 0o600);
    return key;
  }
}

export async function writeActive(value: unknown): Promise<ActivePayload> {
  const payload = activePayloadSchema.parse(value);
  const expires = Date.parse(payload.expiresAt);
  if (expires <= Date.now() || expires > Date.now() + 60 * 60_000) throw new Error("Activation expiry must be within the next 60 minutes");
  const findings = scanText(payload.rendered, { trust: "agent" });
  if (hasCriticalFindings(findings)) throw new Error("Critical secret detected by local bridge");
  const key = await ensureKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("context-bridge-active-v1", "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const envelope = {
    version: 1 as const,
    algorithm: "aes-256-gcm" as const,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    writtenAt: nowIso(),
  };
  const directory = stateDirectory();
  const target = path.join(directory, "active-context.json");
  const temporary = path.join(directory, "active-context.pending-" + process.pid);
  await writeFile(temporary, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600, flag: "w" });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  return payload;
}

export async function readActive(): Promise<ActivePayload | undefined> {
  const target = path.join(stateDirectory(), "active-context.json");
  try {
    const envelope = stateEnvelopeSchema.parse(JSON.parse(await readFile(target, "utf8")) as unknown);
    const key = await ensureKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from("context-bridge-active-v1", "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
    const payload = activePayloadSchema.parse(JSON.parse(plaintext) as unknown);
    if (Date.parse(payload.expiresAt) <= Date.now()) {
      await revokeActive();
      return undefined;
    }
    return payload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Local active-context state could not be authenticated");
  }
}

export async function revokeActive(): Promise<void> {
  await rm(path.join(stateDirectory(), "active-context.json"), { force: true });
}

export function publicToolResult(payload: ActivePayload | undefined): {
  status: "active" | "no_active_context";
  pack?: ContextPack;
  rendered?: string;
  expiresAt?: string;
  trust?: ContextPack["sources"][number]["trust"][];
  sensitivity?: ContextPack["sensitivity"];
} {
  if (!payload) return { status: "no_active_context" };
  return {
    status: "active",
    pack: payload.pack,
    rendered: payload.rendered,
    expiresAt: payload.expiresAt,
    trust: [...new Set(payload.pack.sources.map((source) => source.trust))],
    sensitivity: payload.pack.sensitivity,
  };
}
