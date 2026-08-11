export interface BenchmarkFixture {
  id: string;
  transcript: string;
  criticalFacts: string[];
  protectedSpans: string[];
}

const ticks = String.fromCharCode(96).repeat(3);

export const fixtures: BenchmarkFixture[] = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  const goal = "Implement synthetic workflow " + number + " without changing unrelated behavior.";
  const fact = "The verified endpoint is GET /api/v1/synthetic-" + number + "/status.";
  const constraint = "Never auto-submit provider message " + number + ".";
  const decision = "Use records_" + number + " as the source of truth.";
  const command = "npm test -- synthetic-" + number;
  const filePath = "/workspace/synthetic-" + number + "/src/handler.ts";
  const url = "https://example.test/api/v1/synthetic-" + number + "/status";
  const error = "TypeError: synthetic failure " + number + "\n    at handler (" + filePath + ":42:7)";
  const code = ticks + "ts\nexport const synthetic" + number + " = true;\n" + ticks;
  const narration = [
    "The conversation contains historical narration that has already been resolved.",
    "The assistant restates the request, describes routine steps, and repeats old status.",
    "This paragraph is intentionally verbose synthetic benchmark material and is not a critical fact.",
    "It exists to measure conservative duplicate removal without relying on private user content.",
  ].join(" ");
  const transcript = [
    "Hello",
    "",
    "Goal: " + goal,
    "",
    "Facts:\n- " + fact + "\n- The provider URL is " + url,
    "",
    "Constraints:\n- " + constraint + "\n- Preserve the exact error and command.",
    "",
    "Decisions:\n- " + decision,
    "",
    "Completed:\n- Added validation for fixture " + number + ".",
    "",
    "Next actions:\n- Run " + command,
    "",
    "Files:\n" + filePath,
    "",
    error,
    "",
    code,
    "",
    ...Array.from({ length: 12 }, () => narration + " Session " + number + "."),
    "",
    "> " + narration + " Session " + number + ".",
    "",
    "Thank you",
  ].join("\n");
  return {
    id: "synthetic-coding-session-" + String(number).padStart(2, "0"),
    transcript,
    criticalFacts: [goal, fact, constraint, decision],
    protectedSpans: [command, filePath, url, error, code],
  };
});
