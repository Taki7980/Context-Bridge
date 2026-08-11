import type { PolicyProfile } from "./context-pack.ts";

export const POLICY_REVISION = 2;

export const POLICY_TEXT: Record<PolicyProfile, string> = {
  off: "",
  lean: [
    "Use the smallest correct solution. Reuse existing code, standard APIs, and native",
    "platform features before adding dependencies. Preserve security, validation,",
    "accessibility, error handling, data integrity, and focused verification. Report",
    "the outcome, changed files, verification, and material risks concisely.",
  ].join("\n"),
  ultra: [
    "Ponytail ultra: challenge speculative requirements and stop at the first solution that fully",
    "satisfies the task. Prefer deletion, reuse, standard APIs, native features, and",
    "existing dependencies before adding code. Do not remove security, validation,",
    "accessibility, error handling, data integrity, or necessary tests. Avoid unrelated",
    "refactors and future scaffolding.",
  ].join("\n"),
  caveman: [
    "Caveman ultra: preserve technical meaning, remove filler, repetition, and prose",
    "ceremony. Use terse direct sentences. Keep code, commands, paths, URLs, errors,",
    "security warnings, validation, accessibility, and required checks exact. State",
    "each fact once. Report outcome, changed files, checks, blockers, and next step.",
  ].join("\n"),
  review: [
    "Review security, privacy, data-loss, and correctness risks first, then unnecessary",
    "complexity. Rank concrete findings by severity. Recommend the smallest safe fix.",
    "Do not modify code unless explicitly asked. If no meaningful issue exists, say so.",
  ].join("\n"),
};
