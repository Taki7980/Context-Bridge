import assert from "node:assert/strict";
import test from "node:test";
import { decryptJson, deriveVaultKey, encryptJson, randomKdf } from "../../shared/crypto.ts";
import { cloneAsRevision } from "../../shared/compact.ts";
import { MemoryStore, Vault } from "../../shared/vault.ts";
import { makePack } from "../helpers.ts";

test("vault setup, save, lock, unlock, and read keeps persistent storage encrypted", async () => {
  const local = new MemoryStore();
  const session = new MemoryStore();
  const vault = new Vault(local, session);
  await vault.setup("synthetic long passphrase", false, 100_000);
  const pack = await makePack();
  await vault.savePack(pack);
  const serialized = JSON.stringify(await local.getAll());
  assert.equal(serialized.includes(pack.goal), false);
  assert.equal(serialized.includes(pack.title), false);
  await vault.lock();
  await assert.rejects(() => vault.getPack(pack.id), /locked/);
  await vault.unlock("synthetic long passphrase", false);
  assert.deepEqual(await vault.getPack(pack.id), pack);
});

test("wrong passphrase and modified ciphertext fail authentication", async () => {
  const local = new MemoryStore();
  const vault = new Vault(local, new MemoryStore());
  await vault.setup("synthetic correct phrase", false, 100_000);
  await vault.lock();
  await assert.rejects(() => vault.unlock("synthetic wrong phrase", false), /authentication failed/);
  const values = await local.getAll();
  const key = Object.keys(values).find((item) => item === "cb:special:settings")!;
  const envelope = structuredClone(values[key]) as Record<string, unknown>;
  envelope.ciphertext = String(envelope.ciphertext).slice(0, -4) + "AAAA";
  await local.set({ [key]: envelope });
  await vault.unlock("synthetic correct phrase", false);
  await assert.rejects(() => vault.getSettings(), /authentication failed/);
});

test("fresh IVs produce different ciphertext for identical values", async () => {
  const kdf = randomKdf(100_000);
  const key = await deriveVaultKey("synthetic repeat phrase", kdf);
  const first = await encryptJson(key, "record", { same: true }, kdf);
  const second = await encryptJson(key, "record", { same: true }, kdf);
  assert.notEqual(first.cipher.iv, second.cipher.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.deepEqual(await decryptJson(first, key), { same: true });
});

test("failed persistence never writes plaintext or destroys the prior revision", async () => {
  const local = new MemoryStore();
  const vault = new Vault(local, new MemoryStore());
  await vault.setup("synthetic persistence phrase", false, 100_000);
  const pack = await makePack();
  await vault.savePack(pack);
  const next = cloneAsRevision(pack, { facts: [...pack.facts, "Never persist this failed edit"] });
  local.failNextSet = true;
  await assert.rejects(() => vault.savePack(next), /Simulated/);
  assert.equal(JSON.stringify(await local.getAll()).includes("Never persist this failed edit"), false);
  assert.equal((await vault.getPack(pack.id)).revision, 1);
});

test("destination revisions, expiry sweep, backup, and passphrase change work", async () => {
  const local = new MemoryStore();
  const vault = new Vault(local, new MemoryStore());
  await vault.setup("synthetic initial phrase", false, 100_000);
  const pack = await makePack({ expiresAt: new Date(Date.now() + 5_000).toISOString() });
  await vault.savePack(pack);
  await vault.markDestination(pack.id, "Codex review", 1, 1);
  assert.equal((await vault.getPackRecord(pack.id)).destinations["Codex review"]?.revision, 1);
  const backup = await vault.exportBackup();
  assert.equal(backup.includes(pack.goal), false);
  await vault.changePassphrase("synthetic initial phrase", "synthetic replacement phrase", 100_000);
  await vault.lock();
  await assert.rejects(() => vault.unlock("synthetic initial phrase", false));
  await vault.unlock("synthetic replacement phrase", false);
  assert.equal(await vault.sweepExpired(Date.now() + 10_000), 1);
  await assert.rejects(() => vault.getPack(pack.id), /not found/);
});

test("backup import validates record keys, replaces atomically, and requires the original passphrase", async () => {
  const source = new Vault(new MemoryStore(), new MemoryStore());
  await source.setup("synthetic backup source phrase", false, 100_000);
  const pack = await makePack({ title: "Encrypted backup fixture" });
  await source.savePack(pack);
  const backup = await source.exportBackup();

  const local = new MemoryStore();
  const target = new Vault(local, new MemoryStore());
  await target.setup("synthetic replaced vault phrase", false, 100_000);
  const before = await local.getAll();
  const malicious = JSON.parse(backup) as { records: Record<string, unknown> };
  malicious.records["unsupported-record"] = { fake: true };
  await assert.rejects(() => target.importBackup(JSON.stringify(malicious)), /unsupported record key/);
  assert.deepEqual(await local.getAll(), before);

  await target.importBackup(backup);
  assert.equal((await target.status()).unlocked, false);
  await assert.rejects(() => target.unlock("synthetic replaced vault phrase", false));
  await target.unlock("synthetic backup source phrase", false);
  assert.equal((await target.getPack(pack.id)).title, "Encrypted backup fixture");
});
