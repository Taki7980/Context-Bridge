import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = path.resolve(import.meta.dirname, "../..");

test("built native host drains a framed one-shot status response", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "context-bridge-native-build-"));
  try {
    const child = spawn(process.execPath, [path.join(root, "dist/bridge/local/native-host.mjs")], {
      env: { ...process.env, CONTEXT_BRIDGE_STATE_DIR: directory },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const body = Buffer.from(JSON.stringify({ type: "status", requestId: crypto.randomUUID() }));
    const frame = Buffer.alloc(body.length + 4);
    frame.writeUInt32LE(body.length);
    body.copy(frame, 4);
    child.stdin.end(frame);
    const [output, errorOutput] = await Promise.all([collect(child.stdout), collect(child.stderr)]);
    assert.equal(errorOutput.length, 0);
    assert.ok(output.length >= 4);
    const length = output.readUInt32LE(0);
    assert.equal(length, output.length - 4);
    const response = JSON.parse(output.subarray(4).toString("utf8"));
    assert.equal(response.ok, true);
    assert.equal(response.status, "inactive");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("built local stdio MCP exposes only inactive read-only context", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "context-bridge-local-build-"));
  const client = new Client({ name: "context-bridge-built-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "dist/bridge/local/server.mjs")],
    cwd: root,
    env: { ...process.env, CONTEXT_BRIDGE_STATE_DIR: directory },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["get_active_context"]);
    const result = await client.callTool({ name: "get_active_context", arguments: {} });
    assert.deepEqual(result.structuredContent, { status: "no_active_context" });
  } finally {
    await client.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("built remote service starts only in explicit dev mode and isolates HTTP subjects", async () => {
  const port = await freePort();
  const publicBaseUrl = `http://127.0.0.1:${port}`;
  const allowedOrigin = "http://127.0.0.1:4173";
  const child = spawn(process.execPath, [path.join(root, "dist/bridge/remote/server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      REMOTE_MCP_ENABLED: "1",
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_BASE_URL: publicBaseUrl,
      ALLOWED_ORIGINS: allowedOrigin,
      ALLOW_INSECURE_DEV_AUTH: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += String(chunk); });
  child.stderr.on("data", (chunk) => { logs += String(chunk); });
  await waitForStart(child, () => logs.includes("server_started"));
  const pack = await syntheticPack();
  const reviewed = "# CONTEXT PACK\n\nSynthetic built-server smoke context";
  const headers = {
    "content-type": "application/json",
    authorization: "Bearer dev:smoke-user",
    origin: allowedOrigin,
    "x-context-bridge-request": "1",
  };
  try {
    const health = await fetch(publicBaseUrl + "/healthz");
    assert.equal(health.status, 200);
    const activation = await fetch(publicBaseUrl + "/v1/active-context", {
      method: "POST",
      headers,
      body: JSON.stringify({ pack, rendered: reviewed, expiresAt: new Date(Date.now() + 60_000).toISOString(), acknowledgeWarnings: false }),
    });
    assert.equal(activation.status, 201, await activation.text());
    assert.equal(activation.headers.get("access-control-allow-origin"), allowedOrigin);
    const own = await fetch(publicBaseUrl + "/v1/active-context", { headers: { authorization: "Bearer dev:smoke-user", origin: allowedOrigin } });
    assert.equal((await own.json()).status, "active");
    const other = await fetch(publicBaseUrl + "/v1/active-context", { headers: { authorization: "Bearer dev:other-user", origin: allowedOrigin } });
    assert.equal((await other.json()).status, "inactive");
    const revoke = await fetch(publicBaseUrl + "/v1/active-context", { method: "DELETE", headers });
    assert.equal(revoke.status, 204);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  assert.equal(logs.includes(reviewed), false);
  assert.equal(logs.includes(pack.title), false);
  assert.equal(logs.includes("dev:smoke-user"), false);
});

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForStart(child, ready) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Built remote server startup timed out")), 5_000);
    const interval = setInterval(() => {
      if (!ready()) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolve();
    }, 10);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      clearInterval(interval);
      reject(new Error("Built remote server exited early with code " + code));
    });
  });
}

async function syntheticPack() {
  const timestamp = new Date().toISOString();
  const sourceId = crypto.randomUUID();
  const evidence = "Synthetic built-server evidence.";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(evidence));
  const contentHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    revision: 1,
    title: "Synthetic remote build smoke",
    createdAt: timestamp,
    updatedAt: timestamp,
    goal: "Verify the built remote service.",
    facts: ["The fixture is synthetic."],
    constraints: ["Do not log context."],
    decisions: [],
    completed: [],
    nextActions: [],
    blockers: [],
    unresolved: [],
    artifacts: [],
    evidence: [{ id: crypto.randomUUID(), sourceId, text: evidence }],
    sources: [{ id: sourceId, provider: "built-smoke", capturedAt: timestamp, trust: "user", contentHash }],
    sensitivity: "normal",
    policyProfile: "off",
  };
}
