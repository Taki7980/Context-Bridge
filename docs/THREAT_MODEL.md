# Threat model

## Assets and adversaries

Protected assets are Context Pack plaintext, vault/session keys, passphrases, outbound approvals, destination state, MCP identity, and remote encryption keys. Relevant adversaries include a malicious webpage, crafted import, prompt-injected conversation, stale/changed provider DOM, another remote user, network attacker, database reader, dependency compromise, and a person with access to an unlocked browser or OS account.

An attacker with control of the unlocked browser profile, extension code, receiving provider, local user account, TLS endpoint, OIDC provider, or production process can access plaintext within that boundary. Those compromises are not claimed to be solved.

| Threat | Control | Verification |
| --- | --- | --- |
| Silent browsing surveillance | Provider-only host allowlist; no background observer; explicit click; selection-only universal capture | Manifest audit and manual capture-before-click check |
| Restricted-page capture | Worker accepts only HTTP(S) URL and script injection failure is safe | Unit/manual cases |
| Malicious page forges privileged message | Messages accepted only from same extension side-panel URL/ID; dangerous-key and strict request schema | Security corpus |
| Oversized/deep input denial of service | Pre/post capture byte limits, import limits, bounded arrays/depth/loops, output budget | Boundary/security tests |
| XSS through captured/imported data | `textContent`/textarea rendering, no `innerHTML`, local scripts, CSP | Static lint, XSS Chromium fixture |
| Markdown/context boundary escape | Dynamic fences longer than embedded runs; explicit untrusted wrapper | Renderer/security tests |
| Secret export | Critical corpus hard blocks encrypted save and every outbound validation; complete positional redaction | Golden security and E2E tests |
| Sensitive data without consent | Warnings plus acknowledgement at source/save/final output/remote activation | Unit/E2E tests |
| Prompt injection | Agent/web provenance, warning corpus, fenced data boundary, no autonomous actions | Security and browser tests |
| Plaintext at rest | Web Crypto AES-GCM; no plaintext fallback; storage inspection | Vault tests |
| Ciphertext/metadata tampering | GCM authentication and AAD; strict canonical base64 | Wrong-key/modified-ciphertext tests |
| IV reuse | Fresh random 96-bit IV per encryption | Uniqueness test |
| Weak/recovered passphrase | 12-character minimum, strength guidance, PBKDF2-SHA-256 310k, no recovery/reset | Unit/manual checks; residual offline guessing risk documented |
| Key persistence leak | Derived key only in trusted memory or opted-in trusted session storage; lock/timeout clear | Vault/session tests and manual restart |
| Partial save destroys prior revision | Pending then final envelope; passphrase rollback; corruption preserved | Simulated persistence failure tests |
| Malicious import/prototype pollution | Size before parse, safe-object recursion, strict schema/version/date/reference checks, draft preview | Adversarial JSON tests |
| Provider domain confusion | Exact HTTPS hostname allowlist | Provider contract tests |
| Adapter drift or wrong target | Visible nodes, exactly one composer, narrow provider-local selectors, safe clipboard fallback | Stored HTML and browser tests |
| Automatic provider submission | Only value/text plus input/change; no click/keyboard/submit | Browser event contract |
| Stale outbound approval | Final text digest and current pack revision checked in worker | Integration/manual checks |
| Stale/negative delta | Destination parent required; removed constraint forces full pack | Delta tests |
| Native process protocol abuse | Per-user allowlisted extension origin, length-prefixed strict schema/limit, no stdout logs | Native-state/integration tests |
| Expired/revoked local share replay | Absolute TTL, read-time expiry deletion, lock/delete revocation | Clock-controlled integration tests |
| Cross-user remote access | OIDC issuer/audience/type/expiry/scope, server-derived subject, subject query, subject-bound AAD | Config/auth/store tests |
| CSRF/DNS rebinding | Exact Host/Origin, custom mutation header, TLS proxy requirement | Config/manual HTTP checks |
| Remote database disclosure | Encrypted payload; context key external to DB; metadata minimized | Store tests/review |
| Remote replay/retention | One active row per subject, maximum 60-minute TTL, revoke and cleanup | Integration/manual checks |
| Log leakage | Structured content-free events, masked scanner previews, no request body/token logging | Strict audit test and source audit |
| Supply-chain issue | Lockfile, pinned direct versions, CI audit, no remote scripts | `npm ci`, dependency/build audit |

## Abuse-case conclusions

- Web content cannot unlock, save, share, or activate because it has no messaging path into trusted UI events.
- A copied or inserted Context Pack can still influence the receiving agent. The wrapper labels it untrusted but cannot guarantee prompt-injection prevention.
- Encryption does not help while the vault is unlocked, content is on the clipboard, or an authorized MCP client receives it.
- Provider and MCP clients remain independent security boundaries; users must inspect their configuration and output.
- Remote deployment is reference code. Production identity, TLS, KMS/secret storage, backups, monitoring, incident response, and legal review remain required.
