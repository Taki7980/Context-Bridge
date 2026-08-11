import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildLocalServer } from "../../bridge/local/src/mcp.ts";
import { publicToolResult, readActive, revokeActive, writeActive, type ActivePayload } from "../../bridge/local/src/state.ts";
import { MemoryActiveContextStore } from "../../bridge/remote/src/store.ts";
import { makePack } from "../helpers.ts";

test("local state is encrypted, expires, and exposes only the active revision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "context-bridge-state-test-"));
  process.env.CONTEXT_BRIDGE_STATE_DIR = directory;
  try {
    const pack = await makePack();
    await writeActive({ pack, rendered: "Reviewed synthetic context", expiresAt: new Date(Date.now() + 50).toISOString() });
    const active = await readActive();
    assert.equal(active?.pack.id, pack.id);
    assert.equal(publicToolResult(active).status, "active");
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(await readActive(), undefined);
    assert.equal(publicToolResult(undefined).status, "no_active_context");
  } finally {
    await revokeActive();
    delete process.env.CONTEXT_BRIDGE_STATE_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});

test("official MCP client sees exactly one read-only tool and active/no-active results", async () => {
  const pack = await makePack();
  let active: ActivePayload | undefined = { pack, rendered: "Reviewed synthetic context", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const server = buildLocalServer(async () => active);
  const client = new Client({ name: "context-bridge-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ["get_active_context"]);
  const result = await client.callTool({ name: "get_active_context", arguments: {} });
  assert.equal((result.structuredContent as Record<string, unknown>).status, "active");
  active = undefined;
  const empty = await client.callTool({ name: "get_active_context", arguments: {} });
  assert.equal((empty.structuredContent as Record<string, unknown>).status, "no_active_context");
  await Promise.all([client.close(), server.close()]);
});

test("remote development store enforces per-subject ownership, expiry, and revocation", async () => {
  const store = new MemoryActiveContextStore(Buffer.alloc(32, 7));
  const first = await makePack({ title: "First user's pack" });
  const second = await makePack({ title: "Second user's pack" });
  await store.activate("subject-a", { pack: first, rendered: "First reviewed context", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await store.activate("subject-b", { pack: second, rendered: "Second reviewed context", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal((await store.getActive("subject-a"))?.pack.title, "First user's pack");
  assert.equal((await store.getActive("subject-b"))?.pack.title, "Second user's pack");
  assert.equal(await store.getActive("subject-c"), undefined);
  await store.revoke("subject-a");
  assert.equal(await store.getActive("subject-a"), undefined);
  assert.equal((await store.getActive("subject-b"))?.pack.id, second.id);
  await store.close();
});

test("remote development store treats an expired encrypted share as inactive", async () => {
  const store = new MemoryActiveContextStore(Buffer.alloc(32, 8));
  const pack = await makePack({ title: "Expiring remote pack" });
  await store.activate("subject-expiry", { pack, rendered: "Expiring reviewed context", expiresAt: new Date(Date.now() + 30).toISOString() });
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(await store.getActive("subject-expiry"), undefined);
  assert.equal(await store.cleanup(), 0);
  await store.close();
});
