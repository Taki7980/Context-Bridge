import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import { exportPublicJson } from "../../../shared/render.ts";
import { hasCriticalFindings, scanText } from "../../../shared/security.ts";
import { HttpError, RemoteAuthenticator, subjectFromAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { createStore, remoteActivationSchema } from "./store.ts";

const config = loadConfig();
const store = createStore(config);
const authenticator = new RemoteAuthenticator(config);
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const mcpHandler = createMcpHandler((context) => buildMcpServer(subjectFromAuth(context.authInfo)), {
  legacy: "stateless",
  responseMode: "json",
  onerror: () => log({ event: "mcp_handler_error", result: "failed" }),
});
const nodeMcpHandler = toNodeHandler(mcpHandler, { onerror: () => log({ event: "mcp_adapter_error", result: "failed" }) });

const server = createServer(async (request, response) => {
  const requestId = validRequestId(request.headers["x-request-id"]) ?? crypto.randomUUID();
  response.setHeader("x-request-id", requestId);
  securityHeaders(response);
  try {
    const localUrl = new URL(request.url ?? "/", "http://localhost");
    if (localUrl.pathname === "/healthz" && request.method === "GET" && isLoopback(request.socket.remoteAddress)) {
      await store.health();
      return json(response, 200, { status: "ok" });
    }
    validateHost(request);
    validateHttps(request);
    if (request.method === "OPTIONS") return handleOptions(request, response);
    applyCors(request, response);
    const url = new URL(request.url ?? "/", config.publicBaseUrl);
    if (url.pathname === "/healthz" && request.method === "GET") {
      await store.health();
      return json(response, 200, { status: "ok" });
    }
    if (url.pathname === "/mcp") {
      const auth = await authenticator.authenticate(request, "context:read");
      checkRate(subjectFromAuth(auth), 120);
      if (!request.method || !request.url) throw new HttpError(400, "invalid_request_line");
      const mcpRequest = request as IncomingMessage & { auth: AuthInfo; method: string; url: string };
      mcpRequest.auth = auth;
      if (request.method === "POST") {
        const parsed = await readJson(request, 1_048_576);
        await nodeMcpHandler(mcpRequest, response, parsed);
      } else {
        await nodeMcpHandler(mcpRequest, response);
      }
      log({ requestId, event: "mcp_request", result: "success", status: response.statusCode });
      return;
    }
    if (url.pathname === "/v1/active-context") {
      validateBrowserMutation(request);
      const auth = await authenticator.authenticate(request, "context:activate");
      const subject = subjectFromAuth(auth);
      checkRate(subject, 30);
      if (request.method === "POST") {
        const activation = remoteActivationSchema.parse(await readJson(request, 1_048_576));
        const { acknowledgeWarnings, ...payload } = activation;
        const findings = [
          ...scanText(payload.rendered, { trust: "agent" }),
          ...scanText(exportPublicJson(payload.pack), { trust: "agent" }),
        ];
        if (hasCriticalFindings(findings)) throw new HttpError(422, "critical_secret_blocked");
        if (findings.some((finding) => finding.severity === "warning") && !acknowledgeWarnings) throw new HttpError(422, "warning_acknowledgement_required");
        await store.activate(subject, payload);
        log({ requestId, event: "activate", result: "success", status: 201, revision: payload.pack.revision });
        return json(response, 201, { status: "active", expiresAt: payload.expiresAt, revision: payload.pack.revision });
      }
      if (request.method === "DELETE") {
        await store.revoke(subject);
        log({ requestId, event: "revoke", result: "success", status: 204 });
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "GET") {
        const active = await store.getActive(subject);
        return json(response, 200, active ? { status: "active", expiresAt: active.expiresAt, revision: active.pack.revision } : { status: "inactive" });
      }
      throw new HttpError(405, "method_not_allowed");
    }
    throw new HttpError(404, "not_found");
  } catch (error) {
    const httpError = error instanceof HttpError ? error : error instanceof z.ZodError ? new HttpError(400, "validation_failed") : new HttpError(500, "internal_error");
    log({ requestId, event: "request", result: "failed", status: httpError.status, code: httpError.code });
    if (!response.headersSent) json(response, httpError.status, { error: httpError.code, requestId });
    else response.end();
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, config.host, () => log({ event: "server_started", result: "success", status: 200 }));

const cleanupTimer = setInterval(() => void store.cleanup().catch(() => log({ event: "expiry_cleanup", result: "failed" })), 60_000);
cleanupTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(cleanupTimer);
    server.close(() => void Promise.all([mcpHandler.close(), store.close()]).finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

function buildMcpServer(subject: string): McpServer {
  const mcp = new McpServer({ name: "context-bridge-remote", version: "1.0.0" }, { capabilities: { tools: {} } });
  mcp.registerTool(
    "get_active_context",
    {
      title: "Get active Context Pack",
      description: "Returns only the authenticated user's single active, unexpired Context Pack revision.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const payload = await store.getActive(subject);
      const result = payload
        ? { status: "active", pack: payload.pack, rendered: payload.rendered, expiresAt: payload.expiresAt, sensitivity: payload.pack.sensitivity, trust: [...new Set(payload.pack.sources.map((source) => source.trust))] }
        : { status: "no_active_context" };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );
  return mcp;
}

function validateHost(request: IncomingMessage): void {
  const value = request.headers.host;
  if (!value) throw new HttpError(400, "missing_host");
  let hostname: string;
  try {
    hostname = new URL("http://" + value).hostname;
  } catch {
    throw new HttpError(400, "invalid_host");
  }
  if (!config.allowedHostnames.includes(hostname)) throw new HttpError(403, "host_rejected");
}

function validateHttps(request: IncomingMessage): void {
  if (config.development) return;
  if (request.headers["x-forwarded-proto"] !== "https") throw new HttpError(400, "https_required");
}

function validateBrowserMutation(request: IncomingMessage): void {
  if (["POST", "DELETE"].includes(request.method ?? "") && request.headers["x-context-bridge-request"] !== "1") throw new HttpError(403, "csrf_header_required");
}

function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (!origin) return;
  if (!config.allowedOrigins.includes(origin)) throw new HttpError(403, "origin_rejected");
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
}

function handleOptions(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.includes(origin)) throw new HttpError(403, "origin_rejected");
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization, content-type, x-context-bridge-request, x-request-id");
  response.setHeader("access-control-max-age", "600");
  response.statusCode = 204;
  response.end();
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  if (!(request.headers["content-type"] ?? "").toLocaleLowerCase().startsWith("application/json")) throw new HttpError(415, "json_required");
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > limit) throw new HttpError(413, "request_too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunkValue of request) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    size += chunk.byteLength;
    if (size > limit) throw new HttpError(413, "request_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function checkRate(subject: string, maximum: number): void {
  const now = Date.now();
  const current = rateLimits.get(subject);
  if (!current || current.resetAt <= now) {
    rateLimits.set(subject, { count: 1, resetAt: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > maximum) throw new HttpError(429, "rate_limited");
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("cache-control", "no-store");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function validRequestId(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._-]{8,80}$/.test(value) ? value : undefined;
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function log(value: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), ...value }) + "\n");
}
