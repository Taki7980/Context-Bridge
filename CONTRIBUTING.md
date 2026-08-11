# Contributing

Use Node 22.12 or newer and create only synthetic fixtures. Never commit real conversations, access tokens, personal identifiers, vault backups, `.env` files, provider credentials, or signed-in browser state.

Before proposing a change:

    npm ci
    npm run verify
    npm audit --audit-level=high

Keep the core manifest permission allowlist unchanged unless a concrete product requirement and threat-model update justify it. Do not add host permissions, remote scripts, analytics, background capture, automatic submission, or write-capable MCP tools. New import/message/storage fields require strict schemas, size limits, migration handling, and adversarial tests. Provider selector changes require sanitized stored fixtures and a no-submit browser contract.

Security reports follow `SECURITY.md` and must use private, synthetic evidence.
