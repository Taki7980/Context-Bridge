# Chrome permissions

The project produces two reviewed manifests so optional MCP support cannot silently expand the core extension.

| Permission | Core | Bridge build | Reason |
| --- | :---: | :---: | --- |
| `activeTab` | Yes | Yes | Temporary active-page access after a user gesture; avoids persistent host access |
| `scripting` | Yes | Yes | Inject the minimal isolated selection/provider capture or reviewed composer insertion function |
| `sidePanel` | Yes | Yes | Display the primary review and vault interface |
| `storage` | Yes | Yes | Store encrypted envelopes and opted-in session key; both access levels restricted to trusted contexts |
| `nativeMessaging` | No | Yes | Send activation/revoke/status to the separately installed per-user local host |
| Host permissions | Four provider hosts | Four provider hosts | Provider capture/insertion remains explicit; no all-sites access |

The manifests explicitly exclude history, cookies, webRequest, tabs, downloads, clipboardRead, unlimitedStorage, alarms, all-sites host access, and background capture. Provider hosts are limited to ChatGPT, Claude, and Gemini. The worker uses `activeTab` plus the reviewed provider allowlist for explicit capture/insertion.

## User-gesture behavior

Provider capture/insertion requires an explicit named control. Manual paste works without page access. No provider DOM is read in the background.

## Content Security Policy

Extension pages use:

    script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'

All JavaScript is bundled locally. There are no remote scripts, inline executable scripts, `eval`, or `new Function`. Captured text is written only through `textContent` or form values.

## Incognito and storage

Incognito is `not_allowed`. Persistent and session storage are explicitly set to `TRUSTED_CONTEXTS`, so injected page functions and other untrusted contexts cannot read them. The core manifest has no network origin access; native messaging is isolated in a separately named build.

## Audit

`scripts/audit-permissions.mjs` compares each production manifest against an ordered allowlist, rejects host permissions and known high-risk permissions, and verifies that the core build omits `nativeMessaging`. `npm run package` cannot complete unless this audit passes.
