import { z } from "zod";
import { nowIso } from "./context-pack.ts";

export const DEFAULT_KDF_ITERATIONS = 310_000;

const kdfSchema = z.object({
  name: z.literal("PBKDF2"),
  hash: z.literal("SHA-256"),
  salt: z.string().min(16).max(128),
  iterations: z.number().int().min(100_000).max(5_000_000),
}).strict();

const envelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  recordId: z.string().min(1).max(200),
  kdf: kdfSchema,
  cipher: z.object({
    name: z.literal("AES-GCM"),
    iv: z.string().min(16).max(64),
  }).strict(),
  ciphertext: z.string().min(16).max(4_000_000),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value))).optional(),
}).strict();

export type KdfParameters = z.infer<typeof kdfSchema>;
export type EncryptedEnvelope = z.infer<typeof envelopeSchema>;

export function randomKdf(iterations = DEFAULT_KDF_ITERATIONS): KdfParameters {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { name: "PBKDF2", hash: "SHA-256", salt: bytesToBase64(salt), iterations };
}

export async function deriveVaultKey(passphrase: string, kdfValue: KdfParameters): Promise<CryptoKey> {
  const kdf = kdfSchema.parse(kdfValue);
  if (passphrase.length < 12 || passphrase.length > 1_024) throw new Error("Passphrase must contain 12 to 1,024 characters");
  const material = await crypto.subtle.importKey("raw", bufferSource(new TextEncoder().encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: bufferSource(base64ToBytes(kdf.salt)), iterations: kdf.iterations },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(raw));
}

export async function importKey(encoded: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(encoded);
  if (bytes.byteLength !== 32) throw new Error("Invalid session key length");
  return crypto.subtle.importKey("raw", bufferSource(bytes), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

function aad(envelope: Omit<EncryptedEnvelope, "ciphertext">): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

export async function encryptJson(
  key: CryptoKey,
  recordId: string,
  value: unknown,
  kdfValue: KdfParameters,
  options: { createdAt?: string; expiresAt?: string } = {},
): Promise<EncryptedEnvelope> {
  const kdf = kdfSchema.parse(kdfValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const metadata: Omit<EncryptedEnvelope, "ciphertext"> = {
    envelopeVersion: 1,
    recordId,
    kdf,
    cipher: { name: "AES-GCM", iv: bytesToBase64(iv) },
    createdAt: options.createdAt ?? nowIso(),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv), additionalData: bufferSource(aad(metadata)), tagLength: 128 },
    key,
    plaintext,
  );
  return envelopeSchema.parse({ ...metadata, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) });
}

export async function decryptJson(envelopeValue: unknown, key: CryptoKey): Promise<unknown> {
  const envelope = envelopeSchema.parse(envelopeValue);
  const { ciphertext, ...metadata } = envelope;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bufferSource(base64ToBytes(envelope.cipher.iv)),
        additionalData: bufferSource(aad(metadata)),
        tagLength: 128,
      },
      key,
      bufferSource(base64ToBytes(ciphertext)),
    );
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
  } catch {
    throw new Error("Ciphertext authentication failed");
  }
}

export function parseEnvelope(value: unknown): EncryptedEnvelope {
  return envelopeSchema.parse(value);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("Invalid base64 encoding");
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64(bytes) !== value) throw new Error("Non-canonical base64 encoding");
  return bytes;
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
