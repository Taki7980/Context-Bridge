# MCP bridge guide

Both bridge modes expose exactly one read-only MCP tool:

    get_active_context({})

The result is either `{"status":"no_active_context"}` or the single explicitly active, unexpired pack with its reviewed rendering, expiry, trust labels, and sensitivity. There is no activation, filesystem, browser, shell, prompt-history, or write tool.

## Local bridge

### Components

- The bridge extension sends `activate`, `revoke`, and `status` through Chrome native messaging.
- The native host validates a length-prefixed message, applies a maximum size, rescans critical secrets, and writes authenticated encrypted state.
- The independent MCP server reads the state and serves `get_active_context` over stdio using the official SDK.
- Locking the vault, deleting a pack, explicit revoke, or TTL expiry removes availability.

The active share TTL is at most 60 minutes; the UI defaults to 15. There is no listening socket. Native host stdout is reserved for Chrome's framed protocol and contains no diagnostics.

### Install

1. Run `npm run build`.
2. Load `dist/extension-bridge` and copy its Chrome extension ID.
3. Register the per-user host:

       node dist/bridge/local/scripts/install.mjs --extension-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

   Replace the example with the exact 32-letter ID from Chrome.

4. Restart Chrome.
5. Configure an MCP client with an absolute command:

```json
{
  "mcpServers": {
    "context-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/context-bridge/dist/bridge/local/server.mjs"]
    }
  }
}
```

6. Save and preview a pack, then choose Activate for 15 minutes.
7. Call `get_active_context` from the MCP client.

The installer chooses these per-user registration locations:

- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.contextbridge.local.json`
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.contextbridge.local.json`
- Windows: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.contextbridge.local` pointing to a per-user manifest

State defaults to the OS user-state directory and contains `bridge.key` plus `active-context.json` while active. `CONTEXT_BRIDGE_STATE_DIR` is available for isolated testing. Restrictive file modes are applied where supported.

Uninstall:

    node dist/bridge/local/scripts/uninstall.mjs

Uninstalling removes the per-user native registration and local bridge directory. Revoke first so connected MCP clients immediately see no active context.

## Remote reference service

Remote mode is a separate deployment, has no default URL, and is not invoked by the core extension. It uses current official MCP HTTP handling and is disabled unless all applicable configuration is present.

### Production configuration

| Variable | Requirement |
| --- | --- |
| `REMOTE_MCP_ENABLED` | Must equal `1` |
| `NODE_ENV` | `production` |
| `HOST` / `PORT` | Bind address and port |
| `PUBLIC_BASE_URL` | Public HTTPS origin |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins; never `*` |
| `TRUST_PROXY_HTTPS` | Must equal `1` in production |
| `DATABASE_URL` | PostgreSQL connection |
| `DATABASE_SSL` | `1` by default with certificate verification |
| `REMOTE_ENCRYPTION_KEY_B64` | Exactly 32 random bytes, base64 encoded; keep outside DB |
| `OIDC_ISSUER` | Exact token issuer |
| `OIDC_AUDIENCE` | Expected resource audience |
| `OIDC_JWKS_URL` | HTTPS JWKS endpoint |
| `OIDC_REQUIRED_TYP` | Defaults to `at+jwt` |

Apply `bridge/remote/migrations/001_active_context.sql`, build, configure a TLS reverse proxy that overwrites `X-Forwarded-Proto`, and run `dist/bridge/remote/server.mjs` as an unprivileged user. The included Dockerfile switches to the image's `node` user.

Production tokens must validate issuer, audience, signature, `typ`, `sub`, `iat`, `exp`, and scope. MCP reads need `context:read`; activation management needs `context:activate`. The server derives ownership only from the verified subject.

### HTTP lifecycle

- `GET /healthz` — dependency health. Loopback container checks are accepted; public requests still pass host/TLS validation.
- `POST /v1/active-context` — activate one revision. Requires Bearer authentication, exact allowed Origin when present, `X-Context-Bridge-Request: 1`, JSON content type, future expiry within 60 minutes, and `acknowledgeWarnings`.
- `GET /v1/active-context` — content-free active/inactive status for the subject.
- `DELETE /v1/active-context` — revoke the subject's active row; requires the custom mutation header.
- `POST /mcp` — authenticated Streamable HTTP MCP request with `context:read`.

Example development activation using synthetic data:

```json
{
  "pack": { "schemaVersion": 1, "...": "complete validated public pack" },
  "rendered": "# CONTEXT PACK\n\nReviewed synthetic output",
  "expiresAt": "future ISO timestamp within 60 minutes",
  "acknowledgeWarnings": false
}
```

Development mode is intentionally awkward to enable: set `NODE_ENV=development` and `ALLOW_INSECURE_DEV_AUTH=1`. It uses in-memory encrypted rows and only accepts synthetic Bearer identities shaped as `dev:subject`. Those identities cannot be enabled in production.

### Remote security notes

Rows are queried by verified subject and encrypted with AES-256-GCM AAD bound to that subject. PostgreSQL still exposes pack ID, revision, subject, timestamps, and lifecycle flags. The service handles plaintext during validation and authorized responses, so it is not end-to-end encrypted.

Operators must supply TLS, identity registration, secret/KMS storage, key rotation, database migration/backup policy, monitoring, rate limits at the edge, incident response, and privacy/legal review. Never put bearer tokens, request bodies, or decrypted packs in proxy logs. The included application logs are content-free.

The generic MCP client configuration and authorization details depend on the consuming product. Follow the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and the client's current documentation.
