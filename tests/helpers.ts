import { nowIso, parseContextPack, sha256, uuid, type ContextPack } from "../shared/context-pack.ts";

export async function makePack(overrides: Partial<ContextPack> = {}): Promise<ContextPack> {
  const timestamp = nowIso();
  const sourceId = uuid();
  const pack = {
    schemaVersion: 1 as const,
    id: uuid(),
    revision: 1,
    title: "Synthetic payment-status handoff",
    createdAt: timestamp,
    updatedAt: timestamp,
    goal: "Fix the payment status flow without changing wallet behavior.",
    facts: ["The endpoint is GET /api/v1/rider/payment-status."],
    constraints: ["Never store plaintext Context Packs."],
    decisions: ["ride_payments is the source of truth."],
    completed: ["The handler resolves the internal user UUID."],
    nextActions: ["Run the focused integration test."],
    blockers: [],
    unresolved: [],
    artifacts: [],
    evidence: [{ id: uuid(), sourceId, text: "Synthetic evidence only." }],
    sources: [{
      id: sourceId,
      provider: "test-fixture",
      capturedAt: timestamp,
      trust: "user" as const,
      contentHash: await sha256("Synthetic evidence only."),
    }],
    sensitivity: "normal" as const,
    policyProfile: "off" as const,
    ...overrides,
  };
  return parseContextPack(pack);
}
