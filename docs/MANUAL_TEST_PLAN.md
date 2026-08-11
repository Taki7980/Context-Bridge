# Manual test plan

Record Chrome/OS versions, commit or archive SHA-256, tester, date, and pass/fail evidence. Use only synthetic content and accounts you are authorized to test. Never paste a real credential.

## 1. Build and installation

- [ ] Run `npm ci` and `npm run package` from a clean checkout; confirm all gates pass.
- [ ] Extract `context-bridge-extension-v1.0.0.zip` and compare it with `dist/extension`.
- [ ] Load `dist/extension` through `chrome://extensions` with Developer mode.
- [ ] Confirm Chrome reports only activeTab, scripting, sidePanel, and storage; confirm no site-access host list.
- [ ] Confirm clicking the toolbar icon opens the side panel and no popup or new tab.
- [ ] Inspect the service worker console before any action: no context, secret, network, or repeated error log.
- [ ] With DevTools Network open for the extension, exercise core flows and confirm no extension-origin network request.

## 2. Onboarding and lock

- [ ] Confirm onboarding explains local-only operation, explicit capture, encryption, and no recovery.
- [ ] Enter fewer than 12 characters; confirm setup is rejected.
- [ ] Enter mismatched confirmations; confirm setup is rejected.
- [ ] Create a vault with a unique synthetic passphrase and Remember unchecked.
- [ ] Save a pack, lock, and confirm title/content/list metadata disappear from the UI.
- [ ] Enter a wrong passphrase; confirm no record is modified.
- [ ] Unlock correctly, set auto-lock to five minutes, wait idle, and confirm automatic lock.
- [ ] Repeat setup in a disposable profile with Remember checked; restart Chrome and confirm session behavior matches browser-session semantics.

## 3. Capture boundaries

- [ ] Open an HTTP(S) test page with visible and hidden synthetic text. Before clicking capture, confirm nothing appears in Context Bridge.
- [ ] Click Capture selected text with no selection; confirm safe error and no fallback body capture.
- [ ] Select one visible paragraph and capture; confirm only selection, title, sanitized URL without query/fragment, and trusted timestamp appear.
- [ ] Put text in a password/input field without selecting it; confirm capture never reads it.
- [ ] Try `chrome://settings` or the Chrome Web Store; confirm restricted-page capture fails safely.
- [ ] Paste Markdown and HTML into manual input; confirm it renders as text, not UI.
- [ ] Confirm live character and approximate-token labels and the 250-KiB large-input indication.
- [ ] Test a synthetic input over 1 MiB; confirm rejection without truncation.

## 4. Scanner and trust boundary

- [ ] Paste each fake pattern from `tests/security/security.test.ts` individually; confirm critical status and disabled continuation/save/share.
- [ ] Choose Redact critical secrets; confirm the full match is replaced and cannot be reconstructed from the preview.
- [ ] Paste synthetic email, Indian phone, PAN-like, Aadhaar-like, IP, local path, and Luhn-valid test card; confirm warnings and acknowledgement.
- [ ] Set trust to Agent or Web and paste “ignore previous instructions”; confirm injection warning and untrusted-data wrapper.
- [ ] Set trust to My own notes with the same sentence; confirm it is not automatically classified as third-party injection.
- [ ] Add a mixed-case private deny pattern in Settings; confirm a case-insensitive warning.
- [ ] Modify a reviewed draft after acknowledgement; confirm final approval is invalidated and required again.

## 5. Compaction, editor, export, and revisions

- [ ] Use labelled goal/facts/constraints/decisions/completed/next-action sections; confirm deterministic structured extraction.
- [ ] Include fenced code, URL, command, file path, version, and stack trace; compare every protected byte in the preview.
- [ ] Include duplicated paragraphs and quoted history; confirm only high-confidence duplicates are removed.
- [ ] Use unstructured prose; confirm it remains evidence instead of fabricated facts.
- [ ] Set a budget smaller than protected material; confirm rendering blocks with an actionable size reason and does not split a fence.
- [ ] Select Off, Lean, Ultra, and Review; confirm policy text is separate and only explicit selection adds it.
- [ ] Save, edit, and save again; confirm revision and parent revision increase.
- [ ] Mark a synthetic destination through a successful outbound action, then edit facts and preview Delta; confirm parent requirement and additions/removals.
- [ ] Remove a safety constraint; confirm delta blocks and requires full pack.
- [ ] Download Markdown and JSON; confirm both match the same shown revision and JSON omits vault/audit/destination/session internals.
- [ ] Import valid exported JSON; confirm an unsaved preview. Try unknown keys, future schema, dangerous keys, invalid dates, and over-2-MiB file; confirm safe rejection.

## 6. Clipboard and provider adapters

- [ ] Copy a clear final preview and compare the clipboard byte-for-byte.
- [ ] Deny clipboard permission or simulate failure; confirm the exact preview is selected for manual copy.
- [ ] In authorized live ChatGPT, Claude, and Gemini test accounts, click each Capture helper and compare visible matched messages with the review source.
- [ ] For each provider, insert a unique synthetic reviewed string; confirm exactly one composer changes.
- [ ] Confirm no message is sent, Enter is not simulated, no tool is approved, and prior messages do not change.
- [ ] Open the wrong provider domain; confirm exact-host rejection.
- [ ] Create zero or multiple visible composer candidates in a local test fixture; confirm safe clipboard fallback and no pack mutation.
- [ ] Record selector/version results in `docs/PROVIDER_ADAPTERS.md` if a provider changed.

## 7. Vault lifecycle and deletion

- [ ] Inspect `chrome.storage.local` after saving a unique synthetic phrase; confirm the phrase/title are absent and records are AES-GCM envelopes.
- [ ] Save identical content twice and confirm ciphertext/IV differ.
- [ ] Export encrypted backup, create a disposable change, import backup, and confirm the vault locks and original passphrase is required.
- [ ] Change passphrase; confirm old fails, new succeeds, and all revisions remain.
- [ ] Set an expiry to today/future as appropriate, advance/wait in a test profile, unlock, and confirm expiry sweep.
- [ ] Corrupt a disposable ciphertext byte; confirm record is reported unreadable, preserved for backup, and not overwritten.
- [ ] Delete one pack; confirm it disappears and an active share is revoked.
- [ ] Delete all packs, clear audit, then Delete vault and settings; confirm records are removed while the UI does not claim physical erasure.

## 8. Local MCP

- [ ] Load only `dist/extension-bridge` and confirm the additional permission is nativeMessaging.
- [ ] Run the per-user installer with the exact extension ID and restart Chrome.
- [ ] Start the stdio MCP server from an authorized client; list tools and confirm only `get_active_context`.
- [ ] Before activation, call it and confirm `no_active_context`.
- [ ] Activate a reviewed revision for 15 minutes; confirm exact pack/revision/rendered output plus trust/sensitivity.
- [ ] Edit/save without reactivation; confirm MCP still returns only the explicitly activated revision.
- [ ] Lock, revoke, delete, and expire in separate trials; each must return `no_active_context`.
- [ ] Send a malformed/oversized native frame in an isolated test; confirm rejection and no plaintext stdout log.
- [ ] Run the uninstall script and confirm registration, wrapper, and local state are removed.

## 9. Remote reference service

- [ ] Start with no environment; confirm immediate refusal.
- [ ] Try production HTTP URL, missing DB/key/OIDC, wildcard origin, bad key length, or missing proxy flag; confirm refusal.
- [ ] Apply migration to a disposable PostgreSQL database and start behind a test TLS proxy with an unprivileged account.
- [ ] Confirm loopback/public health behavior and hardened response headers.
- [ ] Test missing, malformed, expired, wrong issuer/audience/type, and wrong-scope tokens; confirm 401/403 without token logs.
- [ ] Test two OIDC subjects; confirm neither can read, status, revoke, or overwrite the other's active context.
- [ ] Test disallowed Host/Origin, missing custom mutation header, wrong content type, and over-limit body.
- [ ] Activate with critical fake secret and unacknowledged warning; confirm rejection.
- [ ] Activate for under 60 minutes, read through MCP, revoke, and wait for expiry in separate trials.
- [ ] Inspect PostgreSQL; confirm context/rendered fields are ciphertext and metadata matches documented disclosure.
- [ ] Rotate/discard the disposable key and database; confirm no test service remains deployed.

## 10. Accessibility and visual QA

- [ ] At 320, 440, and 760 CSS pixels, confirm no horizontal page overflow, clipped action label, or hidden focused control.
- [ ] Navigate every view and action by keyboard only; confirm visible focus and logical order.
- [ ] Use a screen reader to verify headings, form labels, status announcements, findings, and navigation names.
- [ ] Test 200% zoom, system light/dark themes, forced colors, and reduced motion.
- [ ] Confirm error/status meaning does not rely only on color.

## Completion

- [ ] Attach no real content to the test record.
- [ ] Document every failed or skipped item, including Chrome/OS/provider version.
- [ ] Do not publish or deploy until store/legal, signed identity, live-provider, native-host OS, OIDC, PostgreSQL, TLS, and backup controls are independently reviewed.
