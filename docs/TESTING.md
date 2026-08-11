# Testing

All fixtures use fake or synthetic data.

| Command | Coverage |
| --- | --- |
| `npm run typecheck` | Strict TypeScript across extension, shared core, bridges, benchmarks, and tests |
| `npm run lint` | Static source guard against dynamic execution, raw HTML sinks, remote scripts, and unresolved security placeholders |
| `npm test` | Schema/migration, compaction, protected spans, rendering, delta, provider contracts, vault, official MCP client, local/remote stores, remote config/auth |
| `npm run test:security` | Fake secret corpus, PII heuristics, injection, XSS/Markdown boundary, forged messages, oversized/deep/import attacks, cipher tampering, content-free audit |
| `npm run test:e2e` | Real Chromium side-panel flow and stored provider HTML contracts |
| `npm run benchmark` | 20-fixture reduction/retention release gates |
| `npm run build` | Deterministic production directories |
| `npm run audit:permissions` | Manifest allowlists and no core native permission |
| `npm run audit:build` | Production extension contents, CSP-related code patterns, no test/dev/secret artifacts |
| `npm audit --audit-level=high` | High/critical dependency gate |
| `npm run verify` | All project gates except dependency audit |
| `npm run package` | Re-runs verification, then creates release ZIPs |

The Chromium flow covers first-run setup, manual paste, agent trust, critical-secret block/redaction, injection warning acknowledgement, structured draft, Ponytail ultra and Caveman ultra policy selection, encrypted-save message contract, exact preview, XSS inertness, narrow-width overflow, and clipboard approval. Provider tests use the real bundled adapter against ChatGPT-, Claude-, Gemini-, broken-, and ambiguous-shaped local DOM fixtures; they assert no keydown or submit event.

The official MCP client connects to the local server over linked in-memory transports and sees only `get_active_context`. Clock-controlled tests cover local/remote expiry and revocation. Remote production config tests verify disabled-by-default and fail-closed requirements.

## Manual-only verification

Automated headless Chromium verifies the extension UI as a web surface and the real bundled modules, but a developer-mode unpacked installation, Chrome native-host registration on each supported OS, and signed-in live provider pages require manual execution. Use `docs/MANUAL_TEST_PLAN.md`. No live provider account, production OIDC tenant, PostgreSQL server, TLS proxy, or Docker daemon was available to automated tests.

## Dependency advisory

As of this build, `npm audit` reports two moderate findings for the same no-fix path-traversal advisory in transitive `@hono/node-server` under `@modelcontextprotocol/node`. The affected static-serving helper is not used. The high-severity gate passes. Re-run the audit and update the official MCP packages when a fixed chain is released.
