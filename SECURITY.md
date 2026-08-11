# Security policy

## Supported versions

Security fixes are currently applied to the latest 1.0.x release only. This repository is a reference build, not a hosted security service.

## Reporting a vulnerability

Before public launch, replace this placeholder and establish a monitored private channel: `security@example.invalid`.

Do not open a public issue for a suspected vulnerability. Do not include real API keys, passwords, private conversations, personal data, production URLs, database records, vault exports, or decrypted Context Packs in a report. Use synthetic fixtures and describe the smallest reproducible case. If evidence itself is sensitive, ask for a secure transfer method before sending it.

Include the affected version, core or bridge mode, platform, expected boundary, observed behavior, and a safe reproduction. Allow maintainers reasonable time to confirm and remediate before disclosure.

## Safe testing expectations

- Test only installations and accounts you own or are explicitly authorized to assess.
- Use fake credentials that cannot authenticate.
- Do not test live provider accounts in CI.
- Do not bypass browser, OS, identity-provider, or database permissions.
- Do not publish decrypted vault material or active MCP responses.
- Stop if a test could affect another user or external service.

## Implemented controls

- Least-privilege split manifests and an automated permission allowlist.
- Exact trusted side-panel sender checks and strict discriminated message schemas.
- Size, depth, dangerous-key, URL, date, and revision validation.
- No dynamic execution, remote scripts, extension host permissions, or core network client.
- Secret blocking and warning acknowledgement at save and each outbound boundary.
- User/agent/web provenance with fenced untrusted evidence.
- AES-GCM authentication with fresh 96-bit IVs and metadata AAD; PBKDF2-SHA-256 at 310,000 iterations by default.
- Trusted-context-only Chrome local/session storage; no passphrase persistence.
- Expiry, lock, revocation, encrypted backup, atomic save, and corruption preservation.
- Exact provider domains, visible nodes, one-composer requirement, input/change only, and no auto-submit.
- Read-only local MCP with one active revision and no listening port.
- Remote OIDC issuer/audience/type/expiry/scope checks, exact host/origin checks, subject-bound ciphertext, PostgreSQL row ownership, TTL, rate and body limits, and content-free logs.

## Residual risks

Pattern scanners have false positives and false negatives. Browser/OS backups may retain deleted ciphertext. Clipboard managers and the destination provider can retain copied context. A compromised unlocked browser profile or host operating system can access plaintext. Provider DOM updates can break helpers. PBKDF2 resistance depends on passphrase quality and device performance. The local bridge key and ciphertext are protected by per-user OS filesystem permissions, not hardware-backed key storage. Remote operators and authorized agents necessarily process plaintext.

The dependency audit currently reports a moderate path-traversal advisory in `@hono/node-server`, transitively included by `@modelcontextprotocol/node`, with no published fix. Context Bridge does not use the affected static-file serving helper. High-severity audit gates pass, but operators should update the MCP packages when a fixed dependency becomes available.

See `docs/THREAT_MODEL.md` and `docs/DATA_FLOW.md` for boundary details.
