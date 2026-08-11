import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { RemoteAuthenticator } from "../../bridge/remote/src/auth.ts";
import { loadConfig } from "../../bridge/remote/src/config.ts";

test("remote service is disabled and fail-closed without secure production configuration", () => {
  assert.throws(() => loadConfig({}), /REMOTE_MCP_ENABLED/);
  assert.throws(() => loadConfig(baseEnvironment({ NODE_ENV: "production" })), /Secure production configuration missing/);
  assert.throws(() => loadConfig(baseEnvironment({ NODE_ENV: "development", ALLOW_INSECURE_DEV_AUTH: "0" })), /explicit/);
});

test("remote production configuration requires HTTPS, exact origins, OIDC, database, and a 32-byte key", () => {
  const environment = baseEnvironment({
    NODE_ENV: "production",
    PUBLIC_BASE_URL: "https://bridge.example.test",
    ALLOWED_ORIGINS: "https://app.example.test",
    TRUST_PROXY_HTTPS: "1",
    DATABASE_URL: "postgresql://synthetic:synthetic@db.example.test/context_bridge",
    REMOTE_ENCRYPTION_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
    OIDC_ISSUER: "https://identity.example.test/",
    OIDC_AUDIENCE: "https://bridge.example.test",
    OIDC_JWKS_URL: "https://identity.example.test/.well-known/jwks.json",
  });
  const config = loadConfig(environment);
  assert.equal(config.development, false);
  assert.deepEqual(config.allowedOrigins, ["https://app.example.test"]);
  assert.equal(config.encryptionKey.byteLength, 32);
  assert.throws(() => loadConfig({ ...environment, PUBLIC_BASE_URL: "http://bridge.example.test" }), /HTTPS/);
  assert.throws(() => loadConfig({ ...environment, REMOTE_ENCRYPTION_KEY_B64: Buffer.alloc(16).toString("base64") }), /32 bytes/);
});

test("development identity is available only behind the explicit development flag", async () => {
  const config = loadConfig(baseEnvironment({ NODE_ENV: "development", ALLOW_INSECURE_DEV_AUTH: "1" }));
  const authenticator = new RemoteAuthenticator(config);
  const request = { headers: { authorization: "Bearer dev:synthetic-user" } } as IncomingMessage;
  const auth = await authenticator.authenticate(request, "context:read");
  assert.equal(auth.extra?.subject, "synthetic-user");
  await assert.rejects(() => authenticator.authenticate({ headers: { authorization: "Bearer invalid" } } as IncomingMessage, "context:read"), /invalid_development_token/);
});

function baseEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    REMOTE_MCP_ENABLED: "1",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8787",
    PUBLIC_BASE_URL: "http://127.0.0.1:8787",
    ALLOWED_ORIGINS: "http://127.0.0.1:4173",
    ALLOW_INSECURE_DEV_AUTH: "1",
    ...overrides,
  };
}
