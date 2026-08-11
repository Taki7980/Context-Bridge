# Context Bridge benchmark

The harness uses 20 synthetic coding-session fixtures. Each fixture contains manually labelled critical facts and exact protected spans. It compares the full transcript, basic paragraph cleanup, the structured Context Pack, and the same pack with each coding-policy profile.

Run:

    npm run benchmark

The command writes benchmarks/results.json and fails if any release gate is missed:

- median context reduction below 30%;
- aggregate critical-fact retention below 95%;
- protected-span retention below 100%;
- any critical-secret export.

Token counts are explicitly approximate at four characters per token. No provider API or private transcript is used.
