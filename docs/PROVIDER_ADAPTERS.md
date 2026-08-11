# Provider adapters

Provider helpers are optional active-tab conveniences. Manual paste and reviewed copy remain the universal path.

| Adapter | Exact HTTPS hosts | Visible conversation selectors | Composer selectors |
| --- | --- | --- | --- |
| ChatGPT | `chatgpt.com`, `chat.openai.com` | `[data-message-author-role]`, conversation turns, `main article`, prose fallbacks | `#prompt-textarea`, named prompt textarea, narrow contenteditable fallback |
| Claude | `claude.ai` | named user/assistant/streaming test IDs | named composer contenteditable, ProseMirror fallback |
| Gemini | `gemini.google.com` | `user-query`, `.query-text`, `model-response .markdown`, response/query fallbacks, named test IDs | rich-textarea contenteditable, QL editor, textarea |

## Capture contract

Capture runs after the user clicks Capture. The worker resolves provider from the last-focused active tab's exact HTTPS hostname, then injects one isolated function. Named adapters require the reviewed provider host allowlist. It queries provider-local selectors, excludes elements without client rectangles or with hidden visibility, removes nested duplicate nodes, deduplicates identical visible text, joins whole messages, and rejects empty or over-1-MiB results. Restricted pages never reuse a stale cached tab.

The helper does not access cookies, storage, network traffic, JavaScript framework state, form values outside the named composer, hidden messages, account identifiers, or prior tabs.

## Insertion contract

Insertion is available only after an encrypted save, exact outbound preview, final scan, warning acknowledgement, and SHA-256 digest approval. The worker verifies that the current saved revision and preview digest still match.

The injected function:

1. Rechecks the exact provider host.
2. Finds visible, enabled candidates from that provider's narrow selector list.
3. Requires exactly one unique composer.
4. Sets the reviewed string.
5. Emits one bubbling `input` and one `change` event.
6. Returns inserted character count and `submitted: false`.

It never emits keyboard/submit events, clicks, searches for arbitrary controls, modifies prior messages, approves tools, or retries broadly. Zero or multiple composers return a safe error; the side panel copies the same reviewed string as fallback.

## Tests and maintenance

Sanitized provider-shaped fixtures live in `tests/fixtures/providers`. Chromium tests bundle the real adapter module, assert visible capture for ChatGPT/Claude/Gemini, assert input/change-only insertion, and verify missing and ambiguous selector failure. No credentials or real conversations are used.

Before changing selectors:

1. Confirm the current provider DOM manually in an account you are authorized to test.
2. Prefer stable semantics, accessibility attributes, custom elements, and named test IDs.
3. Keep candidates provider-local and narrow.
4. Sanitize and update the stored fixture.
5. Run `npm run test:e2e`.
6. Manually verify that the composer is populated but no message is submitted.

Live signed-in smoke tests are intentionally not automated and were not performed in this build. Provider DOMs may change at any time; selector failure is a known recoverable condition.
