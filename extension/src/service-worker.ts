import { z } from "zod";
import { LIMITS, assertSafeObject, nowIso, parseContextPack, sha256, utf8Bytes } from "../../shared/context-pack.ts";
import { exportPublicJson, renderPack } from "../../shared/render.ts";
import { hasCriticalFindings, scanText } from "../../shared/security.ts";
import { Vault } from "../../shared/vault.ts";
import { requestSchema, type ExtensionRequest, type ExtensionResponse } from "./messages.ts";
import { captureVisibleConversation, insertProviderText, resolveProvider } from "./providers/registry.ts";
import { ChromeLocalStore, ChromeSessionStore } from "./storage/chrome-store.ts";

const vault = new Vault(new ChromeLocalStore(), new ChromeSessionStore());
const ready = initialize();
const NATIVE_HOST = "com.contextbridge.local";

// Track the last active web tab — side panels have their own window,
// so window-scoped queries return no tabs when the panel is focused.
let cachedWebTab: { id: number; url: string } | undefined;

chrome.tabs.onActivated.addListener(async (info) => {
  try {
    const tab = await chrome.tabs.get(info.tabId);
    if (tab.url && /^https?:/.test(tab.url)) cachedWebTab = { id: tab.id!, url: tab.url };
    chrome.runtime.sendMessage({ type: "ACTIVE_TAB_CHANGED" }).catch(() => {});
  } catch { /* tab closed immediately */ }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url && /^https?:/.test(changeInfo.url)) {
    cachedWebTab = { id: tab.id!, url: changeInfo.url };
  }
  if (tab.active && changeInfo.url) {
    chrome.runtime.sendMessage({ type: "ACTIVE_TAB_CHANGED" }).catch(() => {});
  }
});

async function initialize(): Promise<void> {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
  await vault.restoreSession();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  void initialize();
});

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const fallbackId = raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).requestId === "string"
    ? String((raw as Record<string, unknown>).requestId).slice(0, 80)
    : crypto.randomUUID();
  void handleMessage(raw, sender)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, requestId: fallbackId, error: safeError(error) } satisfies ExtensionResponse));
  return true;
});

async function handleMessage(raw: unknown, sender: chrome.runtime.MessageSender): Promise<ExtensionResponse> {
  await ready;
  validateSender(sender);
  assertSafeObject(raw);
  const request = requestSchema.parse(raw);
  if (!["STATUS", "SETUP_VAULT", "UNLOCK", "IMPORT_BACKUP", "DETECT_PROVIDER"].includes(request.type)) {
    const locked = await vault.enforceInactivity();
    if (locked) await revokeNative().catch(() => undefined);
  }
  const data = await route(request);
  return { ok: true, requestId: request.requestId, data };
}

function validateSender(sender: chrome.runtime.MessageSender): void {
  const panelUrl = chrome.runtime.getURL("sidepanel/index.html");
  if (sender.id !== chrome.runtime.id || sender.url !== panelUrl) throw new Error("Untrusted message sender");
}

async function route(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case "STATUS":
      return { ...(await vault.status()), version: chrome.runtime.getManifest().version, permissions: chrome.runtime.getManifest().permissions ?? [], bridgeBuild: (chrome.runtime.getManifest().permissions ?? []).includes("nativeMessaging") };
    case "SETUP_VAULT":
      if (request.passphrase !== request.confirmation) throw new Error("Passphrase confirmation does not match");
      await vault.setup(request.passphrase, request.remember);
      return { unlocked: true };
    case "UNLOCK":
      await vault.unlock(request.passphrase, request.remember);
      return { unlocked: true };
    case "LOCK":
      await revokeNative().catch(() => undefined);
      await vault.lock();
      return { unlocked: false };
    case "CAPTURE_SELECTION":
      return captureSelection();
    case "CAPTURE_PROVIDER":
      return captureProvider();
    case "DETECT_PROVIDER":
      return detectProvider();
    case "SAVE_PACK":
      return savePackSecure(request.pack, request.acknowledgeWarnings);
    case "LIST_PACKS":
      return vault.listPacks();
    case "GET_PACK":
      return vault.getPack(request.id, request.revision);
    case "GET_PACK_RECORD":
      return vault.getPackRecord(request.id);
    case "DELETE_PACK":
      await revokeNative().catch(() => undefined);
      await vault.deletePack(request.id);
      return { deleted: true };
    case "DELETE_ALL_PACKS":
      await revokeNative().catch(() => undefined);
      await vault.deleteAllPacks();
      return { deleted: true };
    case "GET_SETTINGS":
      return vault.getSettings();
    case "SAVE_SETTINGS":
      return vault.saveSettings(request.settings);
    case "VALIDATE_OUTBOUND":
      return validateOutbound(request.text, request.trust, request.acknowledgeWarnings);
    case "INSERT_REVIEWED":
      return insertReviewed(request);
    case "ACTIVATE_LOCAL":
      return activateLocal(request);
    case "REVOKE_LOCAL":
      return revokeNative();
    case "LOCAL_STATUS":
      return nativeMessage({ type: "status", requestId: request.requestId });
    case "MARK_DESTINATION":
      await vault.markDestination(request.id, request.label, request.revision, request.policyRevision);
      return { marked: true };
    case "APPEND_AUDIT":
      await vault.appendAudit(request.event);
      return { recorded: true };
    case "READ_AUDIT":
      return vault.readAudit();
    case "CLEAR_AUDIT":
      await vault.clearAudit();
      return { cleared: true };
    case "EXPORT_BACKUP":
      return { json: await vault.exportBackup() };
    case "IMPORT_BACKUP":
      await revokeNative().catch(() => undefined);
      await vault.importBackup(request.json);
      return { imported: true, unlocked: false };
    case "CHANGE_PASSPHRASE":
      if (request.newPassphrase !== request.confirmation) throw new Error("New passphrase confirmation does not match");
      await vault.changePassphrase(request.currentPassphrase, request.newPassphrase);
      return { changed: true };
    case "DESTROY_VAULT":
      await revokeNative().catch(() => undefined);
      await vault.destroyVault();
      return { destroyed: true };
    case "GENERATE_MCP_SETUP":
      return generateMcpSetup();
  }
}

/**
 * Get the active web tab — works correctly even when the side panel has focus.
 * Uses last-focused window first; side-panel focus must not select another window.
 */
async function getActiveWebTab(): Promise<chrome.tabs.Tab> {
  const [focusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focusedTab?.id) {
    if (focusedTab.url && /^https?:/.test(focusedTab.url)) cachedWebTab = { id: focusedTab.id, url: focusedTab.url };
    return focusedTab;
  }
  if (cachedWebTab) {
    try {
      const tab = await chrome.tabs.get(cachedWebTab.id);
      if (tab.id) return tab;
    } catch { /* tab was closed */ }
  }
  throw new Error("No active web tab found. Open a web page and try again.");
}

async function readActivePageUrl(tab: chrome.tabs.Tab): Promise<string> {
  if (!tab.id) throw new Error("Cannot access active tab");
  if (tab.url && /^https?:/.test(tab.url)) return tab.url;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    func: () => location.href,
  });
  const url = results[0]?.result;
  if (typeof url !== "string" || !/^https?:/.test(url)) throw new Error("Open a provider conversation and try again.");
  return url;
}

/** URL-only provider detection — no script injection. */
async function detectProvider(): Promise<{ provider: string; providerName: string } | null> {
  try {
    const tab = await getActiveWebTab();
    const entry = resolveProvider(await readActivePageUrl(tab));
    if (entry.id === "generic") return null;
    return { provider: entry.id, providerName: entry.name };
  } catch {
    return null;
  }
}

async function captureSelection(): Promise<{ text: string; title: string; url: string; capturedAt: string; trust: "web" }> {
  const tab = await getActiveWebTab();
  if (!tab.id) throw new Error("Cannot access tab");
  const url = new URL(tab.url!);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Chrome and other restricted pages cannot be captured");
  const captureResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    func: () => {
      const text = window.getSelection()?.toString() ?? "";
      if (!text.trim()) return { ok: false as const, error: "Select visible page text before capturing" };
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > 1_048_576) return { ok: false as const, error: "Selection exceeds the 1 MiB limit" };
      return { ok: true as const, text, title: document.title, url: location.href };
    },
  });
  const result = captureResults[0]?.result;
  if (!result?.ok) throw new Error(result?.error ?? "Capture failed");
  if (utf8Bytes(result.text) > LIMITS.captureBytes) throw new Error("Selection exceeds the 1 MiB limit");
  return { text: result.text, title: result.title.slice(0, LIMITS.title), url: sanitizeUrl(result.url), capturedAt: nowIso(), trust: "web" };
}

async function captureProvider(): Promise<{ text: string; title: string; url: string; capturedAt: string; trust: "agent" | "web"; provider: string; providerName: string }> {
  const tab = await getActiveWebTab();
  if (!tab.id) throw new Error("Cannot access tab");
  const pageUrl = await readActivePageUrl(tab);
  const url = new URL(pageUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Chrome and restricted pages cannot be captured");
  const providerEntry = resolveProvider(pageUrl);
  const captureResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    func: captureVisibleConversation,
    args: [providerEntry],
  });
  const result = captureResults[0]?.result;
  if (!result?.ok || !result.text) throw new Error(result?.error ?? "No visible conversation content found on this page");
  if (utf8Bytes(result.text) > LIMITS.captureBytes) throw new Error("Captured content exceeds the 1 MiB limit");
  return { text: result.text, title: (tab.title ?? providerEntry.name).slice(0, LIMITS.title), url: sanitizeUrl(pageUrl), capturedAt: nowIso(), trust: providerEntry.trust, provider: providerEntry.id, providerName: providerEntry.name };
}

async function validateOutbound(text: string, trust: "user" | "agent" | "web", acknowledgeWarnings: boolean): Promise<{ digest: string; findings: ReturnType<typeof scanText>; approved: boolean }> {
  const settings = await vault.getSettings();
  const findings = scanText(text, { trust, blockedPatterns: settings.blockedPatterns });
  if (hasCriticalFindings(findings)) throw new Error("Critical secrets must be redacted before any outbound action");
  if (findings.some((finding) => finding.severity === "warning") && !acknowledgeWarnings) throw new Error("Sensitive-data warnings require explicit acknowledgement");
  return { digest: await sha256(text), findings, approved: true };
}

async function savePackSecure(packValue: unknown, acknowledgeWarnings: boolean): Promise<unknown> {
  const pack = parseContextPack(packValue);
  const settings = await vault.getSettings();
  const publicJson = exportPublicJson(pack);
  if (utf8Bytes(publicJson) > LIMITS.captureBytes) throw new Error("Validated pack exceeds the 1 MiB storage boundary");
  const rendered = renderPack(pack, { budget: settings.contextBudget });
  const findings = [
    ...scanText(publicJson, { trust: "agent", blockedPatterns: settings.blockedPatterns }),
    ...scanText(rendered.text, { trust: "agent", blockedPatterns: settings.blockedPatterns }),
  ];
  if (hasCriticalFindings(findings)) throw new Error("Critical secrets must be redacted before encrypted save");
  if (findings.some((finding) => finding.severity === "warning") && !acknowledgeWarnings) {
    throw new Error("Sensitive-data warnings require explicit acknowledgement before save");
  }
  return vault.savePack(pack);
}

async function insertReviewed(request: Extract<ExtensionRequest, { type: "INSERT_REVIEWED" }>): Promise<unknown> {
  const validation = await validateOutbound(request.text, "agent", request.acknowledgeWarnings);
  if (validation.digest !== request.digest) throw new Error("Preview changed; review and approve it again");
  const pack = await vault.getPack(request.packId);
  if (pack.revision !== request.revision) throw new Error("Pack revision changed; create a new preview");
  const tab = await getActiveWebTab();
  if (!tab.id) throw new Error("Cannot access tab");
  const providerEntry = resolveProvider(tab.url!);
  const insertionResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "ISOLATED",
    func: insertProviderText,
    args: [providerEntry, request.text],
  });
  const result = insertionResults[0]?.result;
  if (!result?.ok) return { inserted: false, fallbackRequired: true, reason: result?.error ?? "No composer input found on this page" };
  return { inserted: true, insertedCharacters: result.insertedCharacters, provider: providerEntry.id, submitted: false };
}

async function activateLocal(request: Extract<ExtensionRequest, { type: "ACTIVATE_LOCAL" }>): Promise<unknown> {
  const pack = parseContextPack(request.pack);
  const current = await vault.getPack(pack.id);
  if (current.revision !== pack.revision) throw new Error("Pack revision changed; create a new preview");
  const validation = await validateOutbound(request.rendered, "agent", request.acknowledgeWarnings);
  if (validation.digest !== request.digest) throw new Error("Preview changed; review and approve it again");
  const expiresAt = new Date(Date.now() + request.ttlMinutes * 60_000).toISOString();
  return nativeMessage({ type: "activate", requestId: request.requestId, payload: { pack, rendered: request.rendered, expiresAt } });
}

async function revokeNative(): Promise<unknown> {
  return nativeMessage({ type: "revoke", requestId: crypto.randomUUID() });
}

/**
 * Generates a self-contained PowerShell setup script, personalised with
 * this extension's actual ID, and downloads it. The user just right-clicks
 * the downloaded file → "Run with PowerShell" — no terminal, no Node.js.
 */
async function generateMcpSetup(): Promise<{ script: string; filename: string }> {
  const extensionId = chrome.runtime.id;
  const manifest = chrome.runtime.getManifest();
  const nativeHostName = "com.contextbridge.local";
  const appdata = "%LOCALAPPDATA%";

  // This PowerShell script is entirely self-contained — it creates the
  // native host wrapper, the native manifest JSON, and registers it in
  // the Windows registry. Requires only PowerShell (built into Windows).
  const script = [
    "# Context Bridge — MCP Bridge Setup",
    `# Extension: ${manifest.name} v${manifest.version}`,
    `# Extension ID: ${extensionId}`,
    "# Generated by Context Bridge. Run once with PowerShell.",
    "",
    "$ErrorActionPreference = 'Stop'",
    `$appDir = Join-Path $env:LOCALAPPDATA 'ContextBridge'`,
    "New-Item -ItemType Directory -Force -Path $appDir | Out-Null",
    "",
    "# Bundled native host script (Node.js MCP bridge)",
    `$hostScript = Join-Path $appDir 'native-host.mjs'`,
    "$hostContent = @'",
    generateNativeHostScript(),
    "'@",
    "Set-Content -Path $hostScript -Value $hostContent -Encoding UTF8",
    "",
    "# Wrapper .cmd file (Chrome needs a .cmd on Windows)",
    `$wrapper = Join-Path $appDir 'context-bridge-native-host.cmd'`,
    "$wrapperContent = \"@echo off`r`nnode `\"$hostScript`\"`r`n\"",
    "Set-Content -Path $wrapper -Value $wrapperContent -Encoding ASCII",
    "",
    "# Native messaging manifest",
    `$manifest = @{`,
    `  name = '${nativeHostName}'`,
    `  description = 'Context Bridge local MCP bridge'`,
    `  path = $wrapper`,
    `  type = 'stdio'`,
    `  allowed_origins = @('chrome-extension://${extensionId}/')`,
    "} | ConvertTo-Json -Depth 5",
    `$manifestPath = Join-Path $appDir '${nativeHostName}.json'`,
    "Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8",
    "",
    "# Register in Windows registry",
    `$regKey = 'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${nativeHostName}'`,
    "New-Item -Path $regKey -Force | Out-Null",
    "Set-ItemProperty -Path $regKey -Name '(Default)' -Value $manifestPath",
    "",
    "Write-Host ''",
    "Write-Host '✓ Context Bridge MCP Bridge installed!' -ForegroundColor Green",
    "Write-Host ''",
    "Write-Host 'Reload the Context Bridge extension in Chrome, then'",
    "Write-Host 'restart Claude Desktop / Cursor / your AI tool.'",
    "Write-Host ''",
    "Write-Host 'Press any key to close...' -NoNewline",
    "$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')",
  ].join("\n");

  return { script, filename: "setup-context-bridge-mcp.ps1" };
}

/** Inlines a minimal native host stub directly into the PowerShell script. */
function generateNativeHostScript(): string {
  return `// Context Bridge Native Host — minimal MCP bridge
// Reads from stdin (Chrome native messaging protocol) and responds.
// Stores active context at %LOCALAPPDATA%/ContextBridge/active-context.json
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const stateDir = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'ContextBridge');
const stateFile = path.join(stateDir, 'active-context.json');
const keyFile = path.join(stateDir, 'bridge.key');

async function ensureKey() {
  await mkdir(stateDir, { recursive: true });
  try {
    const k = Buffer.from((await readFile(keyFile, 'utf8')).trim(), 'base64');
    if (k.byteLength === 32) return k;
  } catch {}
  const k = randomBytes(32);
  await writeFile(keyFile, k.toString('base64'), { encoding: 'utf8', flag: 'wx' });
  return k;
}

let buf = Buffer.alloc(0);
let proc = Promise.resolve();
process.stdin.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); proc = proc.then(drain); });
process.stdin.on('end', () => { void proc.finally(() => process.stdout.end()); });

async function drain() {
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (len === 0 || len > 1_500_000) { process.exitCode = 1; buf = Buffer.alloc(0); return; }
    if (buf.length < len + 4) return;
    const msg = JSON.parse(buf.subarray(4, len + 4).toString('utf8'));
    buf = buf.subarray(len + 4);
    const rid = msg.requestId ?? crypto.randomUUID();
    try {
      if (msg.type === 'activate') {
        const key = await ensureKey();
        const iv = randomBytes(12);
        const c = createCipheriv('aes-256-gcm', key, iv);
        c.setAAD(Buffer.from('context-bridge-active-v1', 'utf8'));
        const ct = Buffer.concat([c.update(JSON.stringify(msg.payload), 'utf8'), c.final()]);
        const env = { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ciphertext: ct.toString('base64'), writtenAt: new Date().toISOString() };
        const tmp = stateFile + '.pending-' + process.pid;
        await writeFile(tmp, JSON.stringify(env), { encoding: 'utf8', flag: 'w' });
        await rename(tmp, stateFile);
        send({ ok: true, requestId: rid, status: 'active', expiresAt: msg.payload?.expiresAt });
      } else if (msg.type === 'revoke') {
        await rm(stateFile, { force: true });
        send({ ok: true, requestId: rid, status: 'revoked' });
      } else {
        send({ ok: true, requestId: rid, status: 'ok' });
      }
    } catch (e) {
      send({ ok: false, requestId: rid, error: e?.message ?? 'error' });
    }
  }
}

function send(v) {
  const p = Buffer.from(JSON.stringify(v), 'utf8');
  const h = Buffer.alloc(4); h.writeUInt32LE(p.length, 0);
  process.stdout.write(Buffer.concat([h, p]));
}`;
}


async function nativeMessage(message: Record<string, unknown>): Promise<unknown> {
  const manifestPermissions = chrome.runtime.getManifest().permissions ?? [];
  if (!manifestPermissions.includes("nativeMessaging")) throw new Error("Local MCP requires the separate bridge-enabled extension build and installed native host");
  const result: unknown = await chrome.runtime.sendNativeMessage(NATIVE_HOST, message);
  if (!result || typeof result !== "object") throw new Error("Local MCP native host returned an invalid response");
  const response = result as Record<string, unknown>;
  if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error.slice(0, 180) : "Local MCP native host rejected the request");
  return response;
}

function sanitizeUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP(S) page URLs are accepted");
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().slice(0, 2_048);
}

function safeError(error: unknown): string {
  if (error instanceof z.ZodError) return "Validation failed: " + error.issues[0]?.message;
  if (error instanceof Error) return error.message.replace(/(?:file|chrome-extension):\/\/\S+/g, "[internal path]").slice(0, 240);
  return "The operation failed safely";
}
