import assert from "node:assert/strict";
import test from "node:test";
import { compactText, cloneAsRevision } from "../../shared/compact.ts";
import { approximateTokens, migrateContextPack, parseContextPack, parseContextPackJson } from "../../shared/context-pack.ts";
import { createDelta } from "../../shared/delta.ts";
import { deduplicateParagraphs, findProtectedSpans, normalizeText } from "../../shared/normalize.ts";
import { POLICY_TEXT } from "../../shared/policies.ts";
import { exportPublicJson, renderDelta, renderPack } from "../../shared/render.ts";
import { makePack } from "../helpers.ts";

const ticks = String.fromCharCode(96).repeat(3);

test("strict schema accepts a valid pack and rejects unknown fields", async () => {
  const pack = await makePack();
  assert.equal(parseContextPack(pack).schemaVersion, 1);
  assert.throws(() => parseContextPack({ ...pack, unexpected: true }));
});

test("JSON import round-trips and rejects dangerous keys", async () => {
  const pack = await makePack();
  assert.deepEqual(parseContextPackJson(exportPublicJson(pack)), pack);
  const poisoned = exportPublicJson(pack).replace(/"schemaVersion": 1,/, "\"schemaVersion\": 1, \"__proto__\": {\"polluted\": true},");
  assert.throws(() => parseContextPackJson(poisoned), /Dangerous key/);
});

test("schema migration entry point accepts v1 and rejects missing or future versions", async () => {
  const pack = await makePack();
  assert.deepEqual(migrateContextPack(pack), pack);
  assert.throws(() => migrateContextPack({ ...pack, schemaVersion: 2 }), /newer unsupported/);
  const missing = { ...pack } as Record<string, unknown>;
  delete missing.schemaVersion;
  assert.throws(() => migrateContextPack(missing), /missing/);
});

test("normalization changes line endings without changing protected code", () => {
  const input = "Goal: Keep exact code\r\n\r\n" + ticks + "ts\r\nconst café = 1;\r\n" + ticks + "\r\n\r\n  prose   text  ";
  const output = normalizeText(input);
  assert.ok(output.includes(ticks + "ts\nconst café = 1;\n" + ticks));
  assert.match(output, /prose text/);
});

test("duplicate paragraphs are removed deterministically", () => {
  assert.deepEqual(deduplicateParagraphs("Alpha\n\nBeta\n\n alpha "), ["Alpha", "Beta"]);
});

test("duplicate long lines are removed without altering protected spans", () => {
  const repeated = "This is a deliberately long repeated transcript line that is safe to deduplicate.";
  const code = ticks + "ts\nconst duplicate = true;\nconst duplicate = true;\n" + ticks;
  const output = deduplicateParagraphs(repeated + "\n" + repeated + "\n\n" + code);
  assert.equal(output[0], repeated);
  assert.equal(output[1], code);
});

test("normalization preserves a space before protected URLs and paths", () => {
  const output = normalizeText("Endpoint is https://example.test/api and file is /workspace/app.ts");
  assert.equal(output, "Endpoint is https://example.test/api and file is /workspace/app.ts");
});

test("protected spans include fences, URLs, paths, commands, errors, and identifiers", () => {
  const text = [
    ticks + "ts\nconst x = 1;\n" + ticks,
    "https://example.test/api/v1",
    "/workspace/project/src/app.ts",
    "npm test",
    "TypeError: synthetic failure\n    at demo (app.ts:1:1)",
    "commit a584a738",
  ].join("\n");
  const kinds = new Set(findProtectedSpans(text).map((span) => span.kind));
  for (const kind of ["code", "url", "path", "command", "error", "identifier"]) assert.equal(kinds.has(kind as never), true);
});

test("compactor extracts only labelled structure and preserves artifacts", async () => {
  const source = [
    "Hello",
    "",
    "Goal: Repair the capture flow",
    "",
    "Facts:\n- Chrome version is 149.0.0\n- Endpoint is https://example.test/api/v1",
    "",
    "Constraints:\n- Never click Send",
    "",
    ticks + "ts\nconst exact = true;\n" + ticks,
    "",
    "Unlabelled material remains evidence.",
    "",
    "Hello",
  ].join("\n");
  const pack = await compactText(source, { provider: "unit", title: "Capture flow", trust: "agent" });
  assert.equal(pack.goal, "Repair the capture flow");
  assert.deepEqual(pack.constraints, ["Never click Send"]);
  assert.equal(pack.facts.length, 2);
  assert.ok(pack.evidence.some((item) => item.text.includes("Unlabelled material")));
  assert.ok(pack.artifacts.some((item) => item.value.includes("const exact = true;")));
});

test("quoted history is removed only when its unquoted copy exists", async () => {
  const source = "Original detail stays.\n\n> Original detail stays.\n\n> Unique quotation stays.";
  const pack = await compactText(source, { provider: "unit", trust: "agent" });
  assert.ok(pack.evidence.some((item) => item.text === "Original detail stays."));
  assert.ok(pack.evidence.some((item) => item.text === "> Unique quotation stays."));
  assert.equal(pack.evidence.some((item) => item.text === "> Original detail stays."), false);
});

test("renderer uses safe dynamic fences and keeps exact artifacts", async () => {
  const base = await makePack();
  const value = String.fromCharCode(96).repeat(4) + "\nsynthetic\n" + String.fromCharCode(96).repeat(4);
  const pack = parseContextPack({
    ...base,
    artifacts: [{ id: crypto.randomUUID(), type: "code", value, sourceId: base.sources[0]!.id, exact: true }],
  });
  const result = renderPack(pack);
  assert.equal(result.blocked, false);
  assert.ok(result.text.includes(value));
  assert.ok(result.text.includes(String.fromCharCode(96).repeat(5) + "text"));
});

test("renderer blocks when protected core exceeds budget", async () => {
  const base = await makePack();
  const pack = parseContextPack({
    ...base,
    artifacts: [{ id: crypto.randomUUID(), type: "code", value: "x".repeat(5_000), sourceId: base.sources[0]!.id, exact: true }],
  });
  const result = renderPack(pack, { budget: 4_000 });
  assert.equal(result.blocked, true);
  assert.match(result.reason ?? "", /exceeding/);
});

test("revision and delta record additions and force full pack for removed constraints", async () => {
  const parent = await makePack();
  const current = cloneAsRevision(parent, { facts: [...parent.facts, "A new fact"], constraints: [] }, Date.now() + 1_000);
  const delta = createDelta(parent, current);
  assert.deepEqual(delta.fields.facts?.added, ["A new fact"]);
  assert.equal(delta.requiresFullPack, true);
  assert.equal(renderDelta(delta).blocked, true);
});

test("all policy profiles render separately and token estimates remain approximate", async () => {
  const base = await makePack();
  for (const profile of ["off", "lean", "ultra", "caveman", "review"] as const) {
    const pack = parseContextPack({ ...base, policyProfile: profile });
    const output = renderPack(pack).text;
    assert.equal(output.includes("Optional coding policy"), profile !== "off");
    if (profile !== "off") assert.ok(output.includes(POLICY_TEXT[profile]));
  }
  assert.equal(approximateTokens("12345"), 2);
});
