import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { RemoteConfig } from "./config.ts";

export class RemoteAuthenticator {
  readonly #jwks;

  constructor(private readonly config: RemoteConfig) {
    this.#jwks = config.oidc ? createRemoteJWKSet(config.oidc.jwksUrl) : undefined;
  }

  async authenticate(request: IncomingMessage, requiredScope: string): Promise<AuthInfo> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "authentication_required");
    const token = authorization.slice(7);
    if (token.length < 4 || token.length > 8_192) throw new HttpError(401, "invalid_token");
    if (this.config.development) return this.developmentToken(token, requiredScope);
    if (!this.config.oidc || !this.#jwks) throw new HttpError(503, "authentication_unconfigured");
    try {
      const verified = await jwtVerify(token, this.#jwks, {
        issuer: this.config.oidc.issuer,
        audience: this.config.oidc.audience,
        requiredClaims: ["sub", "exp", "iat"],
        clockTolerance: 5,
      });
      if (verified.protectedHeader.typ?.toLocaleLowerCase() !== this.config.oidc.requiredTyp.toLocaleLowerCase()) throw new Error("token type rejected");
      const subject = verified.payload.sub;
      if (!subject || subject.length > 255) throw new Error("subject rejected");
      const expiresAt = verified.payload.exp;
      if (typeof expiresAt !== "number") throw new Error("expiry rejected");
      const scopes = parseScopes(verified.payload.scope, verified.payload.scp);
      if (!scopes.includes(requiredScope)) throw new HttpError(403, "insufficient_scope");
      return {
        token: "[validated-access-token]",
        clientId: typeof verified.payload.client_id === "string" ? verified.payload.client_id.slice(0, 255) : "unknown-client",
        scopes,
        expiresAt,
        resource: new URL(this.config.oidc.audience),
        extra: { subject },
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, "invalid_token");
    }
  }

  private developmentToken(token: string, requiredScope: string): AuthInfo {
    const match = token.match(/^dev:([A-Za-z0-9._-]{1,100})$/);
    if (!match?.[1]) throw new HttpError(401, "invalid_development_token");
    return {
      token: "[development-token]",
      clientId: "context-bridge-development",
      scopes: ["context:read", "context:activate"],
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      extra: { subject: match[1], development: true },
      resource: this.config.publicBaseUrl,
    };
  }
}

function parseScopes(scope: unknown, scp: unknown): string[] {
  const values = typeof scope === "string"
    ? scope.split(/\s+/)
    : Array.isArray(scp)
      ? scp.filter((item): item is string => typeof item === "string")
      : [];
  return [...new Set(values.filter(Boolean))];
}

export function subjectFromAuth(auth: AuthInfo | undefined): string {
  const subject = auth?.extra?.subject;
  if (typeof subject !== "string" || !subject) throw new HttpError(401, "missing_subject");
  return subject;
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}
