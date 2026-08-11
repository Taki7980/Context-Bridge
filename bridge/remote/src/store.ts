import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";
import { contextPackSchema } from "../../../shared/context-pack.ts";
import type { RemoteConfig } from "./config.ts";

const storedRemotePayloadSchema = z.object({
  pack: contextPackSchema,
  rendered: z.string().min(1).max(250_000),
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
}).strict();

export const remotePayloadSchema = storedRemotePayloadSchema.superRefine((value, ctx) => {
  const expires = Date.parse(value.expiresAt);
  if (expires <= Date.now() || expires > Date.now() + 60 * 60_000) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Remote activation must expire within 60 minutes" });
});

export const remoteActivationSchema = storedRemotePayloadSchema.extend({
  acknowledgeWarnings: z.boolean(),
}).strict().superRefine((value, ctx) => {
  const expires = Date.parse(value.expiresAt);
  if (expires <= Date.now() || expires > Date.now() + 60 * 60_000) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Remote activation must expire within 60 minutes" });
});

export type RemotePayload = z.infer<typeof remotePayloadSchema>;

interface StoredEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface ActiveContextStore {
  activate(subject: string, payload: RemotePayload): Promise<void>;
  getActive(subject: string): Promise<RemotePayload | undefined>;
  revoke(subject: string): Promise<void>;
  cleanup(): Promise<number>;
  health(): Promise<void>;
  close(): Promise<void>;
}

abstract class EncryptedStore {
  constructor(protected readonly key: Buffer) {}

  protected encrypt(subject: string, payloadValue: RemotePayload): StoredEnvelope {
    const payload = remotePayloadSchema.parse(payloadValue);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("context-bridge-remote-v1:" + subject));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  }

  protected decrypt(subject: string, envelopeValue: unknown): RemotePayload {
    const envelope = z.object({ version: z.literal(1), iv: z.string(), tag: z.string(), ciphertext: z.string() }).strict().parse(envelopeValue);
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from("context-bridge-remote-v1:" + subject));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const value = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
    return storedRemotePayloadSchema.parse(JSON.parse(value) as unknown);
  }
}

export class MemoryActiveContextStore extends EncryptedStore implements ActiveContextStore {
  readonly #records = new Map<string, StoredEnvelope>();

  async activate(subject: string, payload: RemotePayload): Promise<void> {
    this.#records.set(subject, this.encrypt(subject, payload));
  }

  async getActive(subject: string): Promise<RemotePayload | undefined> {
    const envelope = this.#records.get(subject);
    if (!envelope) return undefined;
    const payload = this.decrypt(subject, envelope);
    if (Date.parse(payload.expiresAt) <= Date.now()) {
      this.#records.delete(subject);
      return undefined;
    }
    return payload;
  }

  async revoke(subject: string): Promise<void> {
    this.#records.delete(subject);
  }

  async cleanup(): Promise<number> {
    let removed = 0;
    for (const subject of this.#records.keys()) {
      if (!await this.getActive(subject)) removed += 1;
    }
    return removed;
  }

  async health(): Promise<void> {}
  async close(): Promise<void> { this.#records.clear(); }
}

export class PostgresActiveContextStore extends EncryptedStore implements ActiveContextStore {
  readonly #pool: Pool;

  constructor(config: RemoteConfig) {
    super(config.encryptionKey);
    if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
    this.#pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
      statement_timeout: 5_000,
      query_timeout: 6_000,
    });
  }

  async activate(subject: string, payloadValue: RemotePayload): Promise<void> {
    const payload = remotePayloadSchema.parse(payloadValue);
    const envelope = this.encrypt(subject, payload);
    await this.#pool.query(
      "INSERT INTO context_bridge_active (subject, encrypted_payload, pack_id, revision, created_at, expires_at, active, revoked_at) VALUES ($1, $2::jsonb, $3, $4, NOW(), $5, TRUE, NULL) ON CONFLICT (subject) DO UPDATE SET encrypted_payload = EXCLUDED.encrypted_payload, pack_id = EXCLUDED.pack_id, revision = EXCLUDED.revision, created_at = NOW(), expires_at = EXCLUDED.expires_at, active = TRUE, revoked_at = NULL WHERE context_bridge_active.subject = $1",
      [subject, JSON.stringify(envelope), payload.pack.id, payload.pack.revision, payload.expiresAt],
    );
  }

  async getActive(subject: string): Promise<RemotePayload | undefined> {
    const result = await this.#pool.query<{ encrypted_payload: unknown }>(
      "SELECT encrypted_payload FROM context_bridge_active WHERE subject = $1 AND active = TRUE AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1",
      [subject],
    );
    const row = result.rows[0];
    return row ? this.decrypt(subject, row.encrypted_payload) : undefined;
  }

  async revoke(subject: string): Promise<void> {
    await this.#pool.query(
      "UPDATE context_bridge_active SET active = FALSE, revoked_at = NOW() WHERE subject = $1 AND active = TRUE",
      [subject],
    );
  }

  async cleanup(): Promise<number> {
    const result = await this.#pool.query("UPDATE context_bridge_active SET active = FALSE, revoked_at = COALESCE(revoked_at, NOW()) WHERE active = TRUE AND expires_at <= NOW()");
    return result.rowCount ?? 0;
  }

  async health(): Promise<void> {
    await this.#pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export function createStore(config: RemoteConfig): ActiveContextStore {
  return config.development ? new MemoryActiveContextStore(config.encryptionKey) : new PostgresActiveContextStore(config);
}
