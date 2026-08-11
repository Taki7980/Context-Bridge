# Privacy policy draft — legal review required

Effective date: [INSERT DATE]  
Operator: [INSERT LEGAL ENTITY AND ADDRESS]  
Privacy contact: [INSERT MONITORED EMAIL]  
Service URL: [INSERT URL]

This draft reflects Context Bridge 1.0.0 but must be reviewed and completed by qualified counsel before any public launch. Bracketed terms are unresolved.

## 1. Scope

Context Bridge is a browser extension that lets a user create, review, encrypt, and share structured Context Packs between AI tools. The core extension operates locally. Optional local and remote MCP bridge modes have additional behavior described below. This policy does not govern independent AI providers, browsers, operating systems, clipboard managers, downloaded-file storage, MCP clients, identity providers, or websites the user chooses to use.

## 2. Information processed

At the user's direction, the core extension processes selected or pasted text, visible messages matched by an explicitly invoked supported-provider helper, page title, sanitized page URL, source trust choice, structured Context Pack fields, exact artifacts, sensitivity, expiry, revisions, destination labels, encrypted settings, and content-free operation records.

Universal capture does not intentionally collect page bodies, passwords, cookies, browsing history, hidden page state, local/session storage, or network traffic. Provider helpers read only visible nodes matching documented selectors after a click. The extension does not request or store provider API keys.

Technical encrypted-envelope metadata includes record identifier, cryptographic parameters, creation time, and optional expiry. Source hashes support local deduplication. Audit records contain action/time/result, identifiers/labels, counts, and mode, not prompt text or detected secret values.

## 3. Purposes

Information is processed only to capture user-chosen material, identify potential secrets or sensitive data, deterministically compact and render Context Packs, maintain the encrypted local vault, perform user-requested outbound actions, diagnose content-free status, and, when enabled, provide a temporary authorized MCP context.

The operator does not sell Context Pack data, use it for behavioral advertising, or use it to train models. [DISCLOSE ANY FUTURE ANALYTICS OR REMOVE THEM.]

## 4. Local processing and storage

Core Context Packs and related settings/history are encrypted in browser-managed local storage using authenticated encryption. A key is derived from the user's passphrase. The passphrase is not stored and cannot be recovered by the operator. If selected, the derived key can remain in browser session storage until Chrome closes. Plaintext exists while the extension is unlocked and during a user-requested operation.

## 5. User-directed disclosures

The user may copy content to the operating-system clipboard, download a file, insert it into one supported provider composer without automatic submission, or activate a bridge. These actions disclose content to systems selected by the user. Those systems may retain or use it under their own terms and policies.

## 6. Optional local MCP

When separately installed and activated, the local bridge keeps one reviewed revision in encrypted per-user operating-system state for a user-selected limited period, no more than 60 minutes, and serves it to locally configured MCP clients through a read-only stdio tool. Lock, revoke, deletion, and expiry end application access.

## 7. Optional remote MCP

If [OPERATOR] offers and the user enables remote MCP, the service receives plaintext over TLS, verifies identity/authorization, scans and encrypts one active Context Pack row, and decrypts it for an authorized MCP client. It is not end-to-end encrypted. PostgreSQL metadata may include authenticated subject, pack ID, revision, lifecycle timestamps, and status. Remote records expire within 60 minutes and can be revoked.

Remote subprocessors: [IDENTITY PROVIDER], [HOST], [DATABASE], [LOG/MONITORING], [SUPPORT].  
Processing locations/transfers: [INSERT].  
Encryption-key and backup retention: [INSERT].  
Legal basis and controller/processor roles: [INSERT AFTER COUNSEL REVIEW].

## 8. Retention and deletion

Local packs remain until user deletion or configured expiry. Users can delete one/all packs, clear the local encrypted audit, destroy vault/settings, revoke local shares, and uninstall the extension/host. Application deletion cannot guarantee physical erasure from browser, OS, clipboard, file, or backup systems.

Remote active rows expire in at most 60 minutes and can be revoked. [INSERT DATABASE CLEANUP, BACKUP RETENTION, LOG RETENTION, ACCOUNT DELETION, AND REQUEST PROCESS.] Independent recipients may retain exported content.

## 9. Security

The product uses least-privilege manifests, strict validation, local authenticated encryption, user review, secret blocking, and optional bridge authentication controls. No scanner or security measure is perfect. Users should not intentionally place real credentials in Context Packs and should lock the vault on shared devices.

Security reports must use the private process in `SECURITY.md` and must not include real secrets without a separately agreed secure channel.

## 10. Children's data and prohibited use

[INSERT AGE LIMIT AND REGIONAL REQUIREMENTS.] Context Bridge is not designed for covert monitoring, credential transfer, bypassing provider controls, or processing data without authorization.

## 11. Rights and choices

Users control local capture, edits, expiry, outbound actions, and deletion. Depending on jurisdiction and remote operations, individuals may have access, correction, deletion, restriction, objection, portability, or complaint rights. Contact [PRIVACY CONTACT]. [INSERT IDENTITY VERIFICATION AND RESPONSE PROCESS.]

## 12. Changes

Material changes should be disclosed in release notes and this policy before new collection or remote behavior begins. The effective date and version history must be maintained.

## 13. Contact

[LEGAL ENTITY]  
[POSTAL ADDRESS]  
[PRIVACY EMAIL]  
[SUPERVISORY AUTHORITY / REPRESENTATIVE IF APPLICABLE]
