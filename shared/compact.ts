import { LIMITS, nowIso, parseContextPack, sha256, utf8Bytes, uuid, type ArtifactType, type ContextPack, type TrustLevel } from "./context-pack.ts";
import { deduplicateParagraphs, findProtectedSpans, normalizeText } from "./normalize.ts";

export interface CompactOptions {
  provider: string;
  title?: string;
  url?: string;
  trust: TrustLevel;
  evidenceBudget?: number;
  now?: number;
}

const filler = /^(?:hi|hello|hey|thanks|thank you|hope this helps|let me know if you need anything else)[.!\s]*$/i;
const heading = /^(?:#{1,4}\s*)?(goal|task|facts?|constraints?|decisions?|completed|done|next actions?|blockers?|unresolved|questions?)\s*:?\s*(.*)$/i;

const fieldMap: Record<string, keyof Pick<ContextPack, "facts" | "constraints" | "decisions" | "completed" | "nextActions" | "blockers" | "unresolved"> | "goal"> = {
  goal: "goal",
  task: "goal",
  fact: "facts",
  facts: "facts",
  constraint: "constraints",
  constraints: "constraints",
  decision: "decisions",
  decisions: "decisions",
  completed: "completed",
  done: "completed",
  "next action": "nextActions",
  "next actions": "nextActions",
  blocker: "blockers",
  blockers: "blockers",
  unresolved: "unresolved",
  question: "unresolved",
  questions: "unresolved",
};

function cleanItems(text: string): string[] {
  return text.split("\n").map((line) => line.replace(/^\s*(?:[-*+] |\d+[.)]\s*)/, "").trim()).filter(Boolean);
}

function artifactType(kind: ReturnType<typeof findProtectedSpans>[number]["kind"]): ArtifactType {
  if (kind === "url") return "url";
  if (kind === "path") return "file";
  if (kind === "command") return "command";
  if (kind === "error") return "error";
  return "code";
}

export async function compactText(input: string, options: CompactOptions): Promise<ContextPack> {
  if (utf8Bytes(input) > LIMITS.captureBytes) throw new Error("Capture exceeds the 1 MiB hard limit");
  const normalized = normalizeText(input);
  if (!normalized) throw new Error("Capture is empty");
  const timestamp = nowIso(options.now);
  const sourceId = uuid();
  const pack: ContextPack = {
    schemaVersion: 1,
    id: uuid(),
    revision: 1,
    title: (options.title?.trim() || "Context from " + options.provider).slice(0, LIMITS.title),
    createdAt: timestamp,
    updatedAt: timestamp,
    goal: "",
    facts: [],
    constraints: [],
    decisions: [],
    completed: [],
    nextActions: [],
    blockers: [],
    unresolved: [],
    artifacts: [],
    evidence: [],
    sources: [{
      id: sourceId,
      provider: options.provider.slice(0, 80),
      ...(options.title ? { title: options.title.slice(0, LIMITS.title) } : {}),
      ...(options.url ? { url: options.url } : {}),
      capturedAt: timestamp,
      trust: options.trust,
      contentHash: await sha256(normalized),
    }],
    sensitivity: "normal",
    policyProfile: "off",
  };

  const artifactKeys = new Set<string>();
  for (const span of findProtectedSpans(normalized)) {
    const type = artifactType(span.kind);
    const key = type + ":" + span.value;
    if (artifactKeys.has(key) || pack.artifacts.length >= LIMITS.artifacts) continue;
    artifactKeys.add(key);
    pack.artifacts.push({ id: uuid(), type, value: span.value, sourceId, exact: true });
  }

  const paragraphs = deduplicateParagraphs(normalized);
  const evidenceBudget = Math.max(2_000, Math.min(options.evidenceBudget ?? 32_000, LIMITS.evidence));
  let usedEvidence = 0;
  for (const paragraph of paragraphs) {
    if (filler.test(paragraph)) continue;
    const lines = paragraph.split("\n");
    const match = lines[0]?.match(heading);
    if (match) {
      const label = match[1]?.toLocaleLowerCase() ?? "";
      const target = fieldMap[label];
      const body = [match[2] ?? "", ...lines.slice(1)].join("\n");
      const items = cleanItems(body);
      if (target === "goal") {
        if (!pack.goal && items.length > 0) pack.goal = items.join("\n").slice(0, LIMITS.shortField);
      } else if (target) {
        const array = pack[target] as string[];
        for (const item of items) {
          if (!array.includes(item) && array.length < LIMITS.arrayItems) array.push(item.slice(0, LIMITS.listItem));
        }
      }
      continue;
    }
    const quoted = lines.every((line) => line.trimStart().startsWith(">"));
    const unquoted = paragraph.replace(/^\s*>\s?/gm, "").trim();
    if (quoted && paragraphs.some((candidate) => candidate !== paragraph && candidate.replace(/\s+/g, " ").includes(unquoted.replace(/\s+/g, " ")))) continue;
    if (usedEvidence + paragraph.length <= evidenceBudget) {
      pack.evidence.push({ id: uuid(), sourceId, text: paragraph });
      usedEvidence += paragraph.length;
    }
  }
  if (usedEvidence < normalized.length && pack.evidence.length === 0 && !pack.goal) {
    pack.unresolved.push("The source exceeded the evidence budget. Review a smaller selection; no text was silently truncated into a fact.");
  }
  return parseContextPack(pack);
}

export function cloneAsRevision(pack: ContextPack, updates: Partial<ContextPack>, now = Date.now()): ContextPack {
  const next = {
    ...pack,
    ...updates,
    schemaVersion: 1 as const,
    id: pack.id,
    revision: pack.revision + 1,
    parentRevision: pack.revision,
    createdAt: pack.createdAt,
    updatedAt: nowIso(now),
  };
  return parseContextPack(next);
}
