# Data flow and plaintext lifetime

The design minimizes where context can exist as plaintext, but an unlocked user interface and a receiving agent necessarily process it.

| Stage | Plaintext location | Entry | Lifetime / exit |
| --- | --- | --- | --- |
| Manual paste | Side-panel textarea and JS state | User paste | Until cleared, navigation/reload, lock, or panel process teardown |
| Selection capture | Active page selection, isolated injected return value, Chrome message, worker, panel | Explicit click with temporary `activeTab` | Returned once; retained in panel until cleared/locked |
| Provider capture | Visible matched DOM nodes, isolated return value, worker, panel | Explicit provider Capture click on exact host | Same as selection; hidden DOM/state is not read |
| Security/compaction | Panel memory | User chooses Scan and build | Draft remains in panel memory until lock/reload; deterministic local computation only |
| Encrypted save | Worker memory, Web Crypto input | Explicit Save | Plaintext objects remain only in live extension memory; persistent local record is ciphertext |
| Unlocked read | Worker and panel memory | Passphrase unlock or opted-in session key | Until manual/inactivity/browser-session lock |
| Clipboard | OS/browser clipboard | Explicit Copy or safe adapter fallback | Controlled by OS/clipboard manager; extension cannot enforce deletion |
| Download | Browser download buffer and chosen file | Explicit Download | Controlled by filesystem/user |
| Provider insertion | Active provider composer | Explicit Insert after exact preview approval | Controlled by provider page/account; never submitted automatically |
| Native activation | Worker message, native-host process memory | Explicit confirmation and final scan | Written as encrypted per-user OS state; plaintext exists during encrypt/decrypt and MCP response |
| Local MCP response | Local server process and MCP client | Client calls read-only tool while share is active | Receiving client controls retention; share expires in at most 60 minutes |
| Remote activation | TLS proxy, Node process, OIDC subject store operation | Authenticated POST with CSRF header and acknowledgement | Encrypted subject-bound row; process handles plaintext during validation/encryption |
| Remote MCP response | Node process, TLS, authorized MCP client | Valid OIDC token with `context:read` | Receiving client controls retention; service returns only active unexpired subject row |

## Persistent local metadata

Chrome local storage exposes envelope version, record ID, PBKDF2 parameters including salt/work factor, AES-GCM IV, ciphertext, creation time, and optional expiry. Pack title, content, revisions, destination labels, settings, and audit events are inside ciphertext. The vault-verifier ciphertext confirms a correct derived key without storing the passphrase.

Chrome session storage may hold an exported 256-bit derived key only when the user selects Remember until Chrome closes. Both local and session storage access levels are set to `TRUSTED_CONTEXTS`. Manual lock clears it.

## Local bridge state

The native host writes a random 32-byte key and authenticated ciphertext to a platform-specific per-user state directory with restrictive modes where supported. The key is not uploaded and there is no listening port. This protects casual at-rest inspection, not a compromised user account or host.

## Remote persistence

Production PostgreSQL stores subject, encrypted payload, pack ID, revision, created/expiry times, active flag, and revocation time. Context fields and rendered output are AES-256-GCM ciphertext bound to the authenticated subject as AAD. Operators must protect the environment key, TLS termination, database snapshots, and OIDC configuration. Remote mode is not end-to-end encrypted because the service decrypts content for authorized MCP responses.

## Content-free logs

Extension audit records include event type/time/result, pack and revision identifiers, optional destination label, character/finding counts, and full/delta mode. Remote logs include timestamp, request ID, event, result, status/code, and sometimes revision. Scanner previews are masked. No component intentionally logs text, matched credentials, bearer tokens, passphrases, encryption keys, or ciphertext plaintext.
