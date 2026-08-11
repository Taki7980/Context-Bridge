# Benchmarks

The release harness in `benchmarks/run.ts` uses 20 deterministic synthetic coding-session fixtures. Every fixture labels four critical facts and five protected exact spans (command, file path, URL, error/stack trace, and fenced code). No private conversation or provider API is used.

It measures:

- full source characters and approximate tokens;
- safely normalized/deduplicated characters;
- structured Context Pack characters;
- output with Lean, Ultra, and Review policies;
- critical-fact retention;
- protected-span retention;
- critical-secret findings;
- local processing time.

Run:

    npm run benchmark

Current verified release result:

| Metric | Result | Gate |
| --- | ---: | ---: |
| Fixtures | 20 | At least 20 |
| Median structured reduction | 63.92% | At least 30% |
| Aggregate critical-fact retention | 100% | At least 95% |
| Aggregate protected-span retention | 100% | 100% |
| Critical-secret exports | 0 | 0 |
| Median processing time | Environment-dependent; final release run 1.75 ms | Informational |

Token estimates use four characters per token and are explicitly approximate. Reduction is not guaranteed on real inputs: short, artifact-heavy, already-structured, or high-evidence material can become larger because the output adds headings, provenance boundaries, and safety instructions. Accuracy and complete protected spans take priority over compression.

`benchmarks/results.json` is generated locally and ignored by version control. The command exits nonzero when any correctness gate fails.
