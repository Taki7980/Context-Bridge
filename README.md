# Context Bridge

Context Bridge is a local-first Chrome side-panel extension for moving compact, reviewable context between AI assistants. It captures only text the user explicitly selects, pastes, or requests through a provider helper; builds a deterministic Context Pack; scans the exact outbound revision; and waits for an explicit copy, download, insert, or temporary MCP activation.

Version 1.0.0 is a complete reference build. It does not include a hosted service, Chrome Web Store publication, a signed extension identity, or live provider credentials.

## What is included

- Manifest V3 core extension with no host permissions and no network client.
- Separate bridge-enabled extension build with only one additional permission: `nativeMessaging`.
- Selected-text capture, manual paste, and visible-conversation helpers for ChatGPT, Claude, and Gemini.
- Deterministic compaction, exact protected artifacts, provenance, revisions, per-destination deltas, and optional local output policies: Ponytail ultra for smallest safe work, Caveman ultra for terse handoffs.
- Critical-secret blocking, sensitive-data warnings, prompt-injection marking, and custom private deny patterns.
- AES-256-GCM local vault with PBKDF2-HMAC-SHA-256, fresh per-record IVs, authenticated metadata, lock/auto-lock, encrypted backups, expiry, and corruption preservation.
- Validated Context Pack JSON import, JSON/Markdown export, clipboard fallback, and insert-without-send behavior.
- Optional local stdio MCP server exposing one read-only `get_active_context` tool.
- Disabled-by-default remote Streamable HTTP MCP reference service with OIDC, scope and subject isolation, encrypted PostgreSQL rows, TTL, revocation, rate limits, and hardened headers.
- Unit, integration, security, provider-fixture, Chromium UI, benchmark, manifest, and production-build audits.

## Safety model

The core build is useful offline. It has no host permissions, API keys, analytics, remote scripts, or background page observer. `activeTab` grants temporary access only after the toolbar action or another qualifying user gesture. The injected universal capture function returns only the current selection, title, and sanitized HTTP(S) URL.

Captured agent and web text remains visibly untrusted reference data. It cannot change settings, unlock the vault, approve an outbound action, or call MCP. Critical secret patterns block save and sharing. Warnings require acknowledgement. Detection reduces risk; it cannot guarantee that every secret, personal identifier, or prompt injection will be found.

Provider insertion changes exactly one recognized composer, emits only input/change events, never presses Enter, and never clicks Send. Missing or ambiguous selectors fail safely so the reviewed text can be copied instead.

The vault passphrase cannot be recovered. Losing it makes encrypted packs unreadable. Deletion removes extension records but cannot promise physical erasure from browser or operating-system backups.

## Prerequisites

- Chrome 116 or newer.
- Node.js 22.12 or newer and npm.
- The `zip` command for release packaging.
- PostgreSQL and an OIDC provider only for the optional production remote service.

## Develop and verify

    npm ci
    npm run typecheck
    npm run lint
    npm test
    npm run test:security
    npm run test:e2e
    npm run benchmark
    npm run build
    npm run audit:permissions
    npm run audit:build
    npm run audit:dependencies

Run every release gate and create all archives:

    npm run package

Generated files:

- `release/context-bridge-extension-v1.0.0.zip` — core extension.
- `release/context-bridge-local-mcp-extension-v1.0.0.zip` — bridge-enabled extension.
- `release/context-bridge-complete-v1.0.0.zip` — source, documentation, builds, and both extension archives; dependencies are intentionally omitted.

## Load the unpacked extension

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select `dist/extension` for core mode.
6. Pin Context Bridge and click its toolbar icon.
7. Create a unique vault passphrase, then paste text or select text in an HTTP(S) page and choose Capture selected text.

Do not load the core and bridge builds simultaneously: they use separate extension storage and appear as different installs. The packaged ZIP is for distribution review; Chrome's Load unpacked flow needs the extracted directory.

## Typical workflow

1. Paste notes, capture a selection, or explicitly invoke a provider helper.
2. Choose the source trust level and scan.
3. Redact critical findings and review warnings.
4. Edit the structured goal, facts, constraints, decisions, evidence, artifacts, sensitivity, policy, and expiry.
5. Save an encrypted revision.
6. Inspect the exact full or destination delta output.
7. Copy, download, insert without sending, or activate for the local MCP bridge.

JSON imports appear as unsaved validated drafts. They are size-limited, reject dangerous keys and unsupported schema versions, and must pass the same save and outbound scans.

## Provider helpers

The adapters support exact current selector contracts for `chatgpt.com` / `chat.openai.com`, `claude.ai`, and `gemini.google.com`. They run only on the active matching HTTPS tab after a click. Provider DOMs can change without notice; local sanitized fixtures are automated, while signed-in live smoke tests remain manual. A helper failure does not change or delete a pack.

## Local MCP bridge

The local bridge uses the official MCP SDK over stdio and has no listening network port. It returns only one explicitly activated, unexpired reviewed revision through `get_active_context`. Lock, delete, revoke, and expiry clear access.

1. Build and load `dist/extension-bridge`.
2. Copy its 32-character extension ID from `chrome://extensions`.
3. Install the per-user native host:

       node dist/bridge/local/scripts/install.mjs --extension-id YOUR_EXTENSION_ID

4. Add the stdio server to an MCP client using:

       node /absolute/path/to/dist/bridge/local/server.mjs

5. In Context Bridge, review a saved pack and choose Activate for 15 minutes.

Uninstall:

    node dist/bridge/local/scripts/uninstall.mjs

The installer writes only a per-user native-messaging registration, wrapper, and local bridge state. Review `docs/MCP_BRIDGE.md` before enabling it.

## Remote MCP reference service

The remote service is separate, disabled unless `REMOTE_MCP_ENABLED=1`, and intentionally not connected to the core extension. Production startup also requires HTTPS proxy confirmation, PostgreSQL, a 32-byte encryption key, exact browser origins, and OIDC issuer/audience/JWKS settings. Apply `bridge/remote/migrations/001_active_context.sql` before startup.

    npm run build
    cp bridge/remote/.env.example .env
    node dist/bridge/remote/server.mjs

Never commit the resulting `.env`. Remote mode necessarily receives plaintext while validating and serving an active Context Pack. It is encrypted at rest, but it is not end-to-end encrypted. Deployment, OIDC registration, TLS, database backups, key rotation, monitoring, and legal review remain operator responsibilities.

## Troubleshooting

- Capture unavailable: use an HTTP(S) tab, select visible text, and reopen the panel from the toolbar so `activeTab` is granted.
- Vault unlock fails: confirm the original passphrase. There is no reset or recovery path; an encrypted backup still needs its original passphrase.
- Insert falls back: open the correct provider, keep exactly one visible composer, and copy the reviewed preview manually.
- Native host unavailable: use the bridge build, verify the extension ID passed to the installer, restart Chrome, and inspect Status without placing context in logs.
- Delta unavailable: enter a destination label previously marked after a successful outbound action; otherwise send a full pack.
- Remote service refuses startup: this is expected until every production security variable is configured.

## Data deletion

Delete an individual pack from Packs, use Delete all packs in Settings, or type the confirmation phrase for Delete vault and settings. Clear the content-free encrypted audit separately if desired. Revoke the local share before uninstalling the native host. Remote operators must call the authenticated DELETE endpoint and enforce their database backup-retention policy.

## Project map

- `extension/` — manifests, side panel, service worker, provider adapters, Chrome storage adapters.
- `shared/` — schema, compaction, delta, rendering, scanner, crypto, vault.
- `bridge/local/` — native host, encrypted active state, stdio MCP server.
- `bridge/remote/` — hardened reference service, OIDC, encrypted stores, migrations, container definition.
- `tests/` — deterministic fake-data tests and provider HTML fixtures.
- `benchmarks/` — 20-fixture release-gate corpus.
- `docs/` — architecture, data flow, threat model, permissions, MCP, provider, test, privacy, and store-readiness material.

See `CONTRIBUTING.md` for changes and `SECURITY.md` for reporting. Replace every `example.invalid` contact placeholder before public release.
