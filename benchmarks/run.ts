import { writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { compactText } from "../shared/compact.ts";
import { approximateTokens, parseContextPack } from "../shared/context-pack.ts";
import { deduplicateParagraphs, normalizeText } from "../shared/normalize.ts";
import { renderPack } from "../shared/render.ts";
import { scanText } from "../shared/security.ts";
import { fixtures } from "./fixtures.ts";

interface Result {
  id: string;
  sourceCharacters: number;
  sourceApproximateTokens: number;
  cleanedCharacters: number;
  structuredCharacters: number;
  leanCharacters: number;
  ultraCharacters: number;
  reviewCharacters: number;
  reductionPercent: number;
  criticalFactRetentionPercent: number;
  protectedSpanRetentionPercent: number;
  processingMilliseconds: number;
  criticalSecretFindings: number;
}

const results: Result[] = [];
for (const fixture of fixtures) {
  const started = performance.now();
  const pack = await compactText(fixture.transcript, {
    provider: "synthetic-benchmark",
    title: fixture.id,
    trust: "agent",
    evidenceBudget: 8_000,
  });
  const structured = renderPack(pack, { budget: 48_000 }).text;
  const lean = renderPack(parseContextPack({ ...pack, policyProfile: "lean" }), { budget: 48_000 }).text;
  const ultra = renderPack(parseContextPack({ ...pack, policyProfile: "ultra" }), { budget: 48_000 }).text;
  const review = renderPack(parseContextPack({ ...pack, policyProfile: "review" }), { budget: 48_000 }).text;
  const cleaned = deduplicateParagraphs(normalizeText(fixture.transcript)).join("\n\n");
  const factMatches = fixture.criticalFacts.filter((fact) => structured.includes(fact)).length;
  const protectedMatches = fixture.protectedSpans.filter((span) => structured.includes(span)).length;
  const findings = scanText(structured, { trust: "agent" });
  results.push({
    id: fixture.id,
    sourceCharacters: fixture.transcript.length,
    sourceApproximateTokens: approximateTokens(fixture.transcript),
    cleanedCharacters: cleaned.length,
    structuredCharacters: structured.length,
    leanCharacters: lean.length,
    ultraCharacters: ultra.length,
    reviewCharacters: review.length,
    reductionPercent: round((1 - structured.length / fixture.transcript.length) * 100),
    criticalFactRetentionPercent: round(factMatches / fixture.criticalFacts.length * 100),
    protectedSpanRetentionPercent: round(protectedMatches / fixture.protectedSpans.length * 100),
    processingMilliseconds: round(performance.now() - started),
    criticalSecretFindings: findings.filter((finding) => finding.severity === "critical").length,
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  fixtureCount: results.length,
  medianContextReductionPercent: median(results.map((item) => item.reductionPercent)),
  aggregateCriticalFactRetentionPercent: round(results.reduce((sum, item) => sum + item.criticalFactRetentionPercent, 0) / results.length),
  aggregateProtectedSpanRetentionPercent: round(results.reduce((sum, item) => sum + item.protectedSpanRetentionPercent, 0) / results.length),
  criticalSecretExports: results.reduce((sum, item) => sum + item.criticalSecretFindings, 0),
  medianProcessingMilliseconds: median(results.map((item) => item.processingMilliseconds)),
  gates: {
    medianReductionAtLeast30: false,
    criticalFactRetentionAtLeast95: false,
    protectedSpanRetention100: false,
    zeroCriticalSecretExports: false,
  },
};
summary.gates.medianReductionAtLeast30 = summary.medianContextReductionPercent >= 30;
summary.gates.criticalFactRetentionAtLeast95 = summary.aggregateCriticalFactRetentionPercent >= 95;
summary.gates.protectedSpanRetention100 = summary.aggregateProtectedSpanRetentionPercent === 100;
summary.gates.zeroCriticalSecretExports = summary.criticalSecretExports === 0;

const output = { summary, results };
await writeFile(path.join(import.meta.dirname, "results.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify(summary, null, 2));

if (Object.values(summary.gates).some((passed) => !passed)) {
  throw new Error("One or more benchmark release gates failed");
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
