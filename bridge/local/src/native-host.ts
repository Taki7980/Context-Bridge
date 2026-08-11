import { z } from "zod";
import { readActive, revokeActive, writeActive } from "./state.ts";

const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activate"), requestId: z.uuid(), payload: z.unknown() }).strict(),
  z.object({ type: z.literal("revoke"), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal("status"), requestId: z.uuid() }).strict(),
]);

const MAX_MESSAGE_BYTES = 1_500_000;
let buffer = Buffer.alloc(0);
let processing = Promise.resolve();

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  processing = processing.then(processFrames).catch(() => {
    process.exitCode = 1;
    process.stdin.pause();
  });
});

process.stdin.on("end", () => {
  void processing.finally(() => {
    if (buffer.length > 0) process.exitCode = 1;
    process.stdout.end();
  });
});
process.stdin.on("error", () => {
  process.exitCode = 1;
  process.stdout.end();
});

async function processFrames(): Promise<void> {
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length === 0 || length > MAX_MESSAGE_BYTES) {
      write({ ok: false, requestId: crypto.randomUUID(), error: "Native message size rejected" });
      process.exitCode = 1;
      buffer = Buffer.alloc(0);
      process.stdin.pause();
      return;
    }
    if (buffer.length < length + 4) return;
    const payload = buffer.subarray(4, length + 4);
    buffer = buffer.subarray(length + 4);
    await handle(payload);
  }
}

async function handle(bytes: Buffer): Promise<void> {
  let requestId: string = crypto.randomUUID();
  try {
    const raw = JSON.parse(bytes.toString("utf8")) as unknown;
    if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).requestId === "string") requestId = String((raw as Record<string, unknown>).requestId);
    const message = messageSchema.parse(raw);
    if (message.type === "activate") {
      const active = await writeActive(message.payload);
      write({ ok: true, requestId: message.requestId, status: "active", expiresAt: active.expiresAt, revision: active.pack.revision });
    } else if (message.type === "revoke") {
      await revokeActive();
      write({ ok: true, requestId: message.requestId, status: "revoked" });
    } else {
      const active = await readActive();
      write({ ok: true, requestId: message.requestId, status: active ? "active" : "inactive", ...(active ? { expiresAt: active.expiresAt, revision: active.pack.revision } : {}) });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 180) : "Native host rejected the request";
    write({ ok: false, requestId, error: message });
  }
}

function write(value: unknown): void {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}
