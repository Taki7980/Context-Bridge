# Privacy

Context Bridge is designed to minimize collection. This document describes version 1.0.0 as built; it is not a certification or legal opinion.

## Core extension

The core extension does not run analytics, advertising, telemetry, cloud synchronization, or a network client. It requests access only to ChatGPT, Claude, and Gemini provider hosts. It processes page text only after the user pastes it, explicitly captures the current selection, or clicks a named provider helper.

Universal selection capture returns selection text, page title, sanitized HTTP(S) URL, and a trusted-zone timestamp. It does not read page bodies, form values, passwords, cookies, browser history, local/session storage, hidden state, or network traffic. Provider helpers may read only visible nodes matching their documented conversation selectors after an explicit click.

## Local storage

Context Packs, revision history, destination labels, settings, and the content-free audit trail are stored in `chrome.storage.local` as authenticated AES-GCM ciphertext. A key derived from the user's passphrase is kept in trusted extension memory and, only when requested, in `chrome.storage.session` until Chrome closes. The passphrase is never stored. Encrypted envelopes expose technical metadata such as record identifier, KDF parameters, creation time, and optional expiry; pack titles and contents remain encrypted.

Source content hashes are used as deduplication identifiers, not as security proofs or tracking identifiers. No provider API keys are accepted or stored.

## Sharing

Nothing is sent automatically. The user reviews the exact revision before copying, downloading, inserting into one provider composer, or activating MCP. Clipboard managers, downloaded files, destination providers, and receiving agents are outside the extension's storage boundary and may retain the content under their own policies.

The optional local bridge stores one reviewed active revision in per-user encrypted OS state for at most 60 minutes and serves it through a read-only stdio MCP tool. Lock, revoke, delete, and expiry remove active access.

The optional remote reference service is separate and disabled by default. When operated, it authenticates users and receives plaintext Context Packs, encrypts active rows at rest, and decrypts them to serve authorized agents. This is not end-to-end encryption. The operator controls identity, database, logs, backups, retention, key management, subprocessors, and legal notices.

## Logs

The extension has no analytics log. Its optional encrypted audit contains operation type, time, pack/revision identifiers, destination label, counts, mode, and result—not prompt content or matched secret values. Bridge logs contain request IDs, event/result/status, and revision where relevant; they intentionally omit bearer tokens and context text.

## Retention and deletion

Packs remain until their expiry or user deletion. The local MCP share expires within the selected TTL. Remote shares expire within 60 minutes and can be revoked. Deletion removes application records, but browser, operating-system, database, or operator backups may retain prior encrypted copies until their retention windows end.

## Use of data

The project does not sell data, use it for advertising, or use it to train models. No analytics is enabled by default. Public operators must verify and disclose any changes before release.

Questions: replace `privacy@example.invalid` with a monitored contact before launch. A publication-ready draft requiring legal review is in `docs/PRIVACY_POLICY_DRAFT.md`.
