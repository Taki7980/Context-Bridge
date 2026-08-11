# Chrome Web Store readiness checklist

This build is packaged for review but has not been submitted. Complete every open item before publication.

## Package and identity

- [x] Manifest V3, minimum Chrome 116, icons 16/32/48/128, side-panel entry, production CSP.
- [x] Core ZIP contains no bridge permission, test fixture, source map, remote script, `.env`, or user content.
- [x] Permission and production-build audits gate packaging.
- [ ] Establish publisher account, verified domain, stable extension ID, signing/recovery controls, and release ownership.
- [ ] Rebuild from reviewed clean commit, record SHA-256, inspect ZIP file list, and archive verification evidence.
- [ ] Do not submit the bridge build as though it were the core build; decide whether native messaging warrants a separate listing/distribution.

## Permission disclosures

- [x] `activeTab`: capture the current selection or operate an explicitly selected provider helper after a click.
- [x] `scripting`: run minimal isolated capture/insertion functions on the temporary active tab.
- [x] `sidePanel`: primary product interface.
- [x] `storage`: encrypted local vault and opted-in trusted browser-session key.
- [x] No core host permissions.
- [ ] Copy the final explanations into the Developer Dashboard and confirm they match store UI wording.
- [ ] Reassess every permission after any source change.

## Privacy and Limited Use

- [x] Actual behavior documented in `PRIVACY.md` and `docs/DATA_FLOW.md`.
- [x] No sale, advertising, analytics by default, background surveillance, or provider keys.
- [x] Explicit user gesture and review before outbound actions.
- [x] Remote-mode plaintext and deletion/clipboard/backup residual risks disclosed.
- [ ] Replace placeholder organization, contact, jurisdiction, effective date, retention, subprocessors, and hosting details.
- [ ] Have qualified counsel review `docs/PRIVACY_POLICY_DRAFT.md`.
- [ ] Host the final policy on a stable HTTPS public URL.
- [ ] Complete Chrome Web Store data-use disclosures and verify the [Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use) against final operations.
- [ ] Document support response, deletion requests, breach handling, and remote operator process.

## Listing and UX

- [ ] Prepare accurate name, short description, detailed description, category, support URL, homepage, and version notes.
- [ ] Capture screenshots of onboarding, capture, security review, editor, preview, packs, and settings using synthetic content.
- [ ] Avoid guaranteed savings, perfect secret/injection detection, end-to-end-encryption, compliance, or secure-erasure claims.
- [ ] State that live provider selectors can change and insertion never submits.
- [ ] Include vault no-recovery warning and core/offline value.
- [ ] Provide reviewer steps that need no paid account; describe optional provider and MCP flows separately.

## Security and operations

- [x] Threat model, security policy, manual test plan, dependency audit, and third-party notices included.
- [ ] Replace `security@example.invalid` and `privacy@example.invalid` with monitored private channels.
- [ ] Run clean-machine unpacked tests on current stable Chrome for Windows, macOS, Linux, and ChromeOS where supported.
- [ ] Complete signed-in live smoke tests for each provider using authorized synthetic accounts.
- [ ] Review native-host installer/uninstaller on each supported OS if distributed.
- [ ] Resolve or formally accept the documented moderate transitive MCP advisory; rerun audit immediately before submission.
- [ ] Establish dependency/update cadence, incident response, vulnerability intake, rollback, and key custody.

## Remote service

- [ ] Decide whether remote mode is offered. If not, exclude it from store claims and production operations.
- [ ] If offered, complete independent OIDC, authorization, TLS/proxy, database isolation, key/KMS rotation, backups, retention, monitoring, rate-limit, penetration, and privacy reviews.
- [ ] Publish exact remote data controller/processor/subprocessor and deletion details.
- [ ] Never describe remote storage as end-to-end encrypted.

## Release decision

- [ ] All automated gates pass on the exact archive.
- [ ] Every manual test is passed or an approved residual risk is recorded.
- [ ] Store/legal/security/operations owners approve the exact version.
- [ ] Publication is performed manually; CI must not auto-publish.
