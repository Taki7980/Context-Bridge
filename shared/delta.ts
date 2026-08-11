import { parseContextPack, type ContextPack, type PolicyProfile } from "./context-pack.ts";

type ListField = "facts" | "constraints" | "decisions" | "completed" | "nextActions" | "blockers" | "unresolved";
const listFields: ListField[] = ["facts", "constraints", "decisions", "completed", "nextActions", "blockers", "unresolved"];

export interface FieldDelta {
  added: string[];
  removed: string[];
}

export interface ContextDelta {
  schemaVersion: 1;
  packId: string;
  title: string;
  revision: number;
  parentRevision: number;
  goal?: { from: string; to: string };
  fields: Partial<Record<ListField, FieldDelta>>;
  artifacts: FieldDelta;
  policy?: { from: PolicyProfile; to: PolicyProfile };
  requiresFullPack: boolean;
  fullPackReason?: string;
}

function diff(before: string[], after: string[]): FieldDelta {
  const oldSet = new Set(before);
  const newSet = new Set(after);
  return {
    added: after.filter((item) => !oldSet.has(item)),
    removed: before.filter((item) => !newSet.has(item)),
  };
}

export function createDelta(parentValue: ContextPack, currentValue: ContextPack): ContextDelta {
  const parent = parseContextPack(parentValue);
  const current = parseContextPack(currentValue);
  if (parent.id !== current.id) throw new Error("A delta requires revisions of the same pack");
  if (current.revision <= parent.revision) throw new Error("Current revision must follow the parent revision");
  const fields: ContextDelta["fields"] = {};
  for (const field of listFields) {
    const value = diff(parent[field], current[field]);
    if (value.added.length || value.removed.length) fields[field] = value;
  }
  const removedConstraints = fields.constraints?.removed.length ?? 0;
  const artifactDelta = diff(
    parent.artifacts.map((item) => item.type + ":" + item.value),
    current.artifacts.map((item) => item.type + ":" + item.value),
  );
  return {
    schemaVersion: 1,
    packId: current.id,
    title: current.title,
    revision: current.revision,
    parentRevision: parent.revision,
    ...(parent.goal !== current.goal ? { goal: { from: parent.goal, to: current.goal } } : {}),
    fields,
    artifacts: artifactDelta,
    ...(parent.policyProfile !== current.policyProfile ? { policy: { from: parent.policyProfile, to: current.policyProfile } } : {}),
    requiresFullPack: removedConstraints > 0,
    ...(removedConstraints > 0 ? { fullPackReason: "A safety or technical constraint was removed; send a full reviewed pack instead of a negative delta." } : {}),
  };
}
