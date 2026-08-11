import { z } from "zod";
import { decryptJson, deriveVaultKey, encryptJson, exportKey, importKey, parseEnvelope, randomKdf, type EncryptedEnvelope, type KdfParameters } from "./crypto.ts";
import { assertSafeObject, migrateContextPack, nowIso, parseContextPack, type ContextPack } from "./context-pack.ts";

const META_KEY = "cb:vault-meta";
const SESSION_KEY = "cb:session-key";
const SESSION_ACTIVITY = "cb:last-activity";
const PACK_PREFIX = "cb:pack:";
const SETTINGS_KEY = "cb:special:settings";
const AUDIT_KEY = "cb:special:audit";

const vaultMetaSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  kdf: z.object({
    name: z.literal("PBKDF2"),
    hash: z.literal("SHA-256"),
    salt: z.string(),
    iterations: z.number().int(),
  }).strict(),
  verifier: z.unknown(),
}).strict();

export const vaultSettingsSchema = z.object({
  autoLockMinutes: z.number().int().min(1).max(240),
  defaultExpiryDays: z.number().int().min(0).max(365),
  contextBudget: z.number().int().min(4_000).max(250_000),
  theme: z.enum(["system", "light", "dark"]),
  blockedPatterns: z.array(z.string().max(200)).max(50),
}).strict();

export type VaultSettings = z.infer<typeof vaultSettingsSchema>;

export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 15,
  defaultExpiryDays: 30,
  contextBudget: 48_000,
  theme: "system",
  blockedPatterns: [],
};

const auditEventSchema = z.object({
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

export type AuditEvent = z.infer<typeof auditEventSchema>;

export interface DestinationRevision {
  revision: number;
  policyRevision?: number | undefined;
  sentAt: string;
}

export interface PackRecord {
  kind: "pack";
  current: ContextPack;
  revisions: ContextPack[];
  destinations: Record<string, DestinationRevision>;
}

export interface KeyValueStore {
  getAll(): Promise<Record<string, unknown>>;
  get(key: string): Promise<unknown>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface SessionStore {
  get(key: string): Promise<unknown>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface PackSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  expiresAt?: string;
  sensitivity: ContextPack["sensitivity"];
}

export interface ListResult {
  packs: PackSummary[];
  unreadableRecordIds: string[];
}

interface Backup {
  backupVersion: 1;
  exportedAt: string;
  records: Record<string, unknown>;
}

export class Vault {
  #key: CryptoKey | undefined;
  #meta: z.infer<typeof vaultMetaSchema> | undefined;

  constructor(private readonly local: KeyValueStore, private readonly session: SessionStore) {}

  async isSetup(): Promise<boolean> {
    return (await this.local.get(META_KEY)) !== undefined;
  }

  async setup(passphrase: string, remember = false, iterations?: number): Promise<void> {
    if (await this.isSetup()) throw new Error("Vault is already configured");
    const kdf = randomKdf(iterations);
    const key = await deriveVaultKey(passphrase, kdf);
    const verifier = await encryptJson(key, "vault-verifier", { value: "context-bridge-vault", version: 1 }, kdf);
    const settings = await encryptJson(key, "settings", DEFAULT_SETTINGS, kdf);
    const audit = await encryptJson(key, "audit", [], kdf);
    const meta = vaultMetaSchema.parse({ version: 1, createdAt: nowIso(), kdf, verifier });
    await this.local.set({ [META_KEY]: meta, [SETTINGS_KEY]: settings, [AUDIT_KEY]: audit });
    this.#key = key;
    this.#meta = meta;
    await this.rememberKey(remember);
  }

  async unlock(passphrase: string, remember = false): Promise<void> {
    const meta = vaultMetaSchema.parse(await this.local.get(META_KEY));
    const key = await deriveVaultKey(passphrase, meta.kdf);
    const verifier = await decryptJson(meta.verifier, key);
    if (!isVerifier(verifier)) throw new Error("Vault verification failed");
    this.#key = key;
    this.#meta = meta;
    await this.rememberKey(remember);
    await this.sweepExpired();
  }

  async restoreSession(): Promise<boolean> {
    const metaValue = await this.local.get(META_KEY);
    const encoded = await this.session.get(SESSION_KEY);
    if (typeof encoded !== "string" || metaValue === undefined) return false;
    try {
      const meta = vaultMetaSchema.parse(metaValue);
      const key = await importKey(encoded);
      const verifier = await decryptJson(meta.verifier, key);
      if (!isVerifier(verifier)) return false;
      this.#key = key;
      this.#meta = meta;
      await this.touch();
      return true;
    } catch {
      await this.session.remove([SESSION_KEY, SESSION_ACTIVITY]);
      return false;
    }
  }

  async lock(): Promise<void> {
    this.#key = undefined;
    this.#meta = undefined;
    await this.session.remove([SESSION_KEY, SESSION_ACTIVITY]);
  }

  async status(): Promise<{ setup: boolean; unlocked: boolean }> {
    return { setup: await this.isSetup(), unlocked: this.#key !== undefined };
  }

  async touch(): Promise<void> {
    if (this.#key) await this.session.set({ [SESSION_ACTIVITY]: Date.now() });
  }

  async enforceInactivity(): Promise<boolean> {
    if (!this.#key) return false;
    const settings = await this.getSettings();
    const activity = await this.session.get(SESSION_ACTIVITY);
    if (typeof activity === "number" && Date.now() - activity > settings.autoLockMinutes * 60_000) {
      await this.lock();
      return true;
    }
    await this.touch();
    return false;
  }

  async savePack(packValue: ContextPack): Promise<ContextPack> {
    const pack = parseContextPack(packValue);
    const key = this.requireKey();
    const existing = await this.readPackRecord(pack.id, false);
    let revisions = [pack];
    let destinations: Record<string, DestinationRevision> = {};
    if (existing) {
      if (pack.revision <= existing.current.revision) throw new Error("Revision conflict; refresh the pack and preview again");
      revisions = [...existing.revisions, pack].slice(-20);
      destinations = existing.destinations;
    }
    const record: PackRecord = { kind: "pack", current: pack, revisions, destinations };
    const envelope = await encryptJson(key, "pack:" + pack.id, record, this.requireMeta().kdf, {
      createdAt: pack.createdAt,
      ...(pack.expiresAt ? { expiresAt: pack.expiresAt } : {}),
    });
    const finalKey = PACK_PREFIX + pack.id;
    const tempKey = finalKey + ":pending";
    await this.local.set({ [tempKey]: envelope });
    try {
      await this.local.set({ [finalKey]: envelope });
      await this.local.remove([tempKey]);
    } catch (error) {
      await this.local.remove([tempKey]).catch(() => undefined);
      throw error;
    }
    await this.touch();
    return pack;
  }

  async listPacks(): Promise<ListResult> {
    this.requireKey();
    await this.sweepExpired();
    const values = await this.local.getAll();
    const packs: PackSummary[] = [];
    const unreadableRecordIds: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(PACK_PREFIX) || key.endsWith(":pending")) continue;
      const id = key.slice(PACK_PREFIX.length);
      try {
        const record = await this.decryptPackRecord(value);
        packs.push({
          id: record.current.id,
          title: record.current.title,
          revision: record.current.revision,
          updatedAt: record.current.updatedAt,
          ...(record.current.expiresAt ? { expiresAt: record.current.expiresAt } : {}),
          sensitivity: record.current.sensitivity,
        });
      } catch {
        unreadableRecordIds.push(id);
      }
    }
    packs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.touch();
    return { packs, unreadableRecordIds };
  }

  async getPack(id: string, revision?: number): Promise<ContextPack> {
    const record = await this.readPackRecord(id, true);
    if (!record) throw new Error("Pack not found");
    const pack = revision === undefined ? record.current : record.revisions.find((item) => item.revision === revision);
    if (!pack) throw new Error("Revision not found");
    if (pack.expiresAt && Date.parse(pack.expiresAt) <= Date.now()) throw new Error("Pack has expired");
    await this.touch();
    return pack;
  }

  async getPackRecord(id: string): Promise<PackRecord> {
    const record = await this.readPackRecord(id, true);
    if (!record) throw new Error("Pack not found");
    return record;
  }

  async markDestination(id: string, label: string, revision: number, policyRevision?: number): Promise<void> {
    const cleanLabel = label.trim().slice(0, 100);
    if (!cleanLabel) throw new Error("Destination label is required");
    const record = await this.getPackRecord(id);
    if (record.current.revision !== revision) throw new Error("Revision mismatch; create a new preview");
    record.destinations[cleanLabel] = { revision, ...(policyRevision ? { policyRevision } : {}), sentAt: nowIso() };
    const envelope = await encryptJson(this.requireKey(), "pack:" + id, record, this.requireMeta().kdf, {
      createdAt: record.current.createdAt,
      ...(record.current.expiresAt ? { expiresAt: record.current.expiresAt } : {}),
    });
    await this.local.set({ [PACK_PREFIX + id]: envelope });
  }

  async deletePack(id: string): Promise<void> {
    this.requireKey();
    await this.local.remove([PACK_PREFIX + id, PACK_PREFIX + id + ":pending"]);
    await this.touch();
  }

  async deleteAllPacks(): Promise<void> {
    this.requireKey();
    const values = await this.local.getAll();
    await this.local.remove(Object.keys(values).filter((key) => key.startsWith(PACK_PREFIX)));
    await this.touch();
  }

  async getSettings(): Promise<VaultSettings> {
    const value = await this.local.get(SETTINGS_KEY);
    if (value === undefined) return DEFAULT_SETTINGS;
    const decrypted = await decryptJson(value, this.requireKey());
    return vaultSettingsSchema.parse(decrypted);
  }

  async saveSettings(value: VaultSettings): Promise<VaultSettings> {
    const settings = vaultSettingsSchema.parse(value);
    const envelope = await encryptJson(this.requireKey(), "settings", settings, this.requireMeta().kdf);
    await this.local.set({ [SETTINGS_KEY]: envelope });
    await this.touch();
    return settings;
  }

  async appendAudit(value: AuditEvent): Promise<void> {
    const event = auditEventSchema.parse(value);
    const existing = await this.readAudit();
    const events = [...existing, event].slice(-500);
    const envelope = await encryptJson(this.requireKey(), "audit", events, this.requireMeta().kdf);
    await this.local.set({ [AUDIT_KEY]: envelope });
  }

  async readAudit(): Promise<AuditEvent[]> {
    const value = await this.local.get(AUDIT_KEY);
    if (value === undefined) return [];
    const decrypted = await decryptJson(value, this.requireKey());
    return z.array(auditEventSchema).max(500).parse(decrypted);
  }

  async clearAudit(): Promise<void> {
    const envelope = await encryptJson(this.requireKey(), "audit", [], this.requireMeta().kdf);
    await this.local.set({ [AUDIT_KEY]: envelope });
  }

  async changePassphrase(oldPassphrase: string, newPassphrase: string, iterations?: number): Promise<void> {
    const oldMeta = this.requireMeta();
    const oldKey = await deriveVaultKey(oldPassphrase, oldMeta.kdf);
    const verifier = await decryptJson(oldMeta.verifier, oldKey);
    if (!isVerifier(verifier)) throw new Error("Current passphrase is incorrect");
    const snapshot = await this.local.getAll();
    const newKdf = randomKdf(iterations);
    const newKey = await deriveVaultKey(newPassphrase, newKdf);
    const replacement: Record<string, unknown> = {};
    for (const [storageKey, value] of Object.entries(snapshot)) {
      if (storageKey === META_KEY || !storageKey.startsWith("cb:")) continue;
      if (storageKey.endsWith(":pending")) continue;
      const oldEnvelope = parseEnvelope(value);
      const plaintext = await decryptJson(oldEnvelope, oldKey);
      replacement[storageKey] = await encryptJson(newKey, oldEnvelope.recordId, plaintext, newKdf, {
        createdAt: oldEnvelope.createdAt,
        ...(oldEnvelope.expiresAt ? { expiresAt: oldEnvelope.expiresAt } : {}),
      });
    }
    const newVerifier = await encryptJson(newKey, "vault-verifier", verifier, newKdf);
    const newMeta = vaultMetaSchema.parse({ version: 1, createdAt: oldMeta.createdAt, kdf: newKdf, verifier: newVerifier });
    replacement[META_KEY] = newMeta;
    try {
      await this.local.set(replacement);
      this.#key = newKey;
      this.#meta = newMeta;
      const remembered = typeof (await this.session.get(SESSION_KEY)) === "string";
      await this.rememberKey(remembered);
    } catch (error) {
      await this.local.set(snapshot).catch(() => undefined);
      throw error;
    }
  }

  async exportBackup(): Promise<string> {
    this.requireKey();
    const records = await this.local.getAll();
    const backup: Backup = { backupVersion: 1, exportedAt: nowIso(), records };
    return JSON.stringify(backup, null, 2) + "\n";
  }

  async importBackup(json: string): Promise<void> {
    if (new TextEncoder().encode(json).byteLength > 12_000_000) throw new Error("Backup exceeds the 12 MB limit");
    const parsed: unknown = JSON.parse(json);
    assertSafeObject(parsed);
    const backup = z.object({
      backupVersion: z.literal(1),
      exportedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
      records: z.record(z.string(), z.unknown()),
    }).strict().parse(parsed);
    const importedKeys = Object.keys(backup.records);
    if (importedKeys.length > 2_500) throw new Error("Backup contains too many records");
    if (!(META_KEY in backup.records) || !(SETTINGS_KEY in backup.records) || !(AUDIT_KEY in backup.records)) throw new Error("Backup is missing required vault records");
    const packKey = /^cb:pack:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?::pending)?$/i;
    for (const key of importedKeys) {
      if (![META_KEY, SETTINGS_KEY, AUDIT_KEY].includes(key) && !packKey.test(key)) throw new Error("Backup contains an unsupported record key");
    }
    vaultMetaSchema.parse(backup.records[META_KEY]);
    for (const [key, value] of Object.entries(backup.records)) {
      if (key !== META_KEY && key.startsWith("cb:")) parseEnvelope(value);
    }
    const current = await this.local.getAll();
    const currentKeys = Object.keys(current).filter((key) => key.startsWith("cb:"));
    try {
      await this.local.set(backup.records);
      await this.local.remove(currentKeys.filter((key) => !(key in backup.records)));
    } catch (error) {
      await this.local.set(current).catch(() => undefined);
      await this.local.remove(importedKeys.filter((key) => !(key in current))).catch(() => undefined);
      throw error;
    }
    await this.lock();
  }

  async sweepExpired(now = Date.now()): Promise<number> {
    if (!this.#key) return 0;
    const values = await this.local.getAll();
    const expired: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(PACK_PREFIX) || key.endsWith(":pending")) continue;
      try {
        const envelope = parseEnvelope(value);
        if (envelope.expiresAt && Date.parse(envelope.expiresAt) <= now) expired.push(key);
      } catch {
        // Preserve corrupt ciphertext for backup and recovery.
      }
    }
    if (expired.length) await this.local.remove(expired);
    return expired.length;
  }

  async destroyVault(): Promise<void> {
    const values = await this.local.getAll();
    await this.local.remove(Object.keys(values).filter((key) => key.startsWith("cb:")));
    await this.lock();
  }

  private async rememberKey(remember: boolean): Promise<void> {
    if (!this.#key) return;
    if (remember) {
      await this.session.set({ [SESSION_KEY]: await exportKey(this.#key), [SESSION_ACTIVITY]: Date.now() });
    } else {
      await this.session.remove([SESSION_KEY]);
      await this.session.set({ [SESSION_ACTIVITY]: Date.now() });
    }
  }

  private requireKey(): CryptoKey {
    if (!this.#key) throw new Error("Vault is locked");
    return this.#key;
  }

  private requireMeta(): z.infer<typeof vaultMetaSchema> {
    if (!this.#meta) throw new Error("Vault is locked");
    return this.#meta;
  }

  private async readPackRecord(id: string, preserveCorruption: boolean): Promise<PackRecord | undefined> {
    this.requireKey();
    const value = await this.local.get(PACK_PREFIX + id);
    if (value === undefined) return undefined;
    try {
      return await this.decryptPackRecord(value);
    } catch (error) {
      if (preserveCorruption) throw new Error("Pack ciphertext is unreadable; it was preserved for encrypted backup");
      throw error;
    }
  }

  private async decryptPackRecord(value: unknown): Promise<PackRecord> {
    const decrypted = await decryptJson(value, this.requireKey());
    assertSafeObject(decrypted);
    const raw = z.object({
      kind: z.literal("pack"),
      current: z.unknown(),
      revisions: z.array(z.unknown()).min(1).max(20),
      destinations: z.record(z.string().max(100), z.object({
        revision: z.number().int().min(1),
        policyRevision: z.number().int().min(1).optional(),
        sentAt: z.string(),
      }).strict()),
    }).strict().parse(decrypted);
    return {
      kind: "pack",
      current: migrateContextPack(raw.current),
      revisions: raw.revisions.map(migrateContextPack),
      destinations: raw.destinations,
    };
  }
}

function isVerifier(value: unknown): value is { value: string; version: number } {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).value === "context-bridge-vault" && (value as Record<string, unknown>).version === 1);
}

export class MemoryStore implements KeyValueStore, SessionStore {
  readonly values = new Map<string, unknown>();
  failNextSet = false;

  async getAll(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.values.entries());
  }

  async get(key: string): Promise<unknown> {
    return this.values.get(key);
  }

  async set(values: Record<string, unknown>): Promise<void> {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("Simulated persistence failure");
    }
    for (const [key, value] of Object.entries(values)) this.values.set(key, structuredClone(value));
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) this.values.delete(key);
  }
}
