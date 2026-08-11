import { randomBytes } from "node:crypto";
import { z } from "zod";

export interface RemoteConfig {
  development: boolean;
  host: string;
  port: number;
  publicBaseUrl: URL;
  allowedOrigins: string[];
  allowedHostnames: string[];
  encryptionKey: Buffer;
  databaseUrl?: string;
  databaseSsl: boolean;
  oidc?: {
    issuer: string;
    audience: string;
    jwksUrl: URL;
    requiredTyp: string;
  };
}

const envSchema = z.object({
  REMOTE_MCP_ENABLED: z.literal("1"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  PUBLIC_BASE_URL: z.url(),
  ALLOWED_ORIGINS: z.string(),
  REMOTE_ENCRYPTION_KEY_B64: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(["0", "1"]).default("1"),
  OIDC_ISSUER: z.url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  OIDC_JWKS_URL: z.url().optional(),
  OIDC_REQUIRED_TYP: z.string().default("at+jwt"),
  TRUST_PROXY_HTTPS: z.enum(["0", "1"]).default("0"),
  ALLOW_INSECURE_DEV_AUTH: z.enum(["0", "1"]).default("0"),
}).passthrough();

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): RemoteConfig {
  const env = envSchema.parse(environment);
  const development = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  const publicBaseUrl = new URL(env.PUBLIC_BASE_URL);
  const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((value) => new URL(value.trim()).origin);
  if (!allowedOrigins.length || allowedOrigins.some((value) => value === "*")) throw new Error("ALLOWED_ORIGINS must contain exact origins");
  if (!development) {
    const missing = [
      ["DATABASE_URL", env.DATABASE_URL],
      ["REMOTE_ENCRYPTION_KEY_B64", env.REMOTE_ENCRYPTION_KEY_B64],
      ["OIDC_ISSUER", env.OIDC_ISSUER],
      ["OIDC_AUDIENCE", env.OIDC_AUDIENCE],
      ["OIDC_JWKS_URL", env.OIDC_JWKS_URL],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error("Secure production configuration missing: " + missing.join(", "));
    if (publicBaseUrl.protocol !== "https:") throw new Error("PUBLIC_BASE_URL must use HTTPS in production");
    if (env.TRUST_PROXY_HTTPS !== "1") throw new Error("TRUST_PROXY_HTTPS=1 is required behind the production TLS proxy");
  } else if (env.ALLOW_INSECURE_DEV_AUTH !== "1") {
    throw new Error("Development mode requires the explicit ALLOW_INSECURE_DEV_AUTH=1 flag");
  }
  const encryptionKey = env.REMOTE_ENCRYPTION_KEY_B64
    ? Buffer.from(env.REMOTE_ENCRYPTION_KEY_B64, "base64")
    : randomBytes(32);
  if (encryptionKey.byteLength !== 32) throw new Error("REMOTE_ENCRYPTION_KEY_B64 must decode to 32 bytes");
  return {
    development,
    host: env.HOST,
    port: env.PORT,
    publicBaseUrl,
    allowedOrigins,
    allowedHostnames: [...new Set([publicBaseUrl.hostname, ...(development ? ["localhost", "127.0.0.1", "[::1]"] : [])])],
    encryptionKey,
    ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
    databaseSsl: env.DATABASE_SSL === "1",
    ...(!development && env.OIDC_ISSUER && env.OIDC_AUDIENCE && env.OIDC_JWKS_URL ? {
      oidc: {
        issuer: env.OIDC_ISSUER,
        audience: env.OIDC_AUDIENCE,
        jwksUrl: new URL(env.OIDC_JWKS_URL),
        requiredTyp: env.OIDC_REQUIRED_TYP,
      },
    } : {}),
  };
}
