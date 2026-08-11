import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, values) => value.startsWith("--") ? [value.slice(2), values[index + 1]] : ["", ""]).filter(([key]) => key));
const extensionId = args["extension-id"];
const bundledHost = path.join(import.meta.dirname, "../native-host.mjs");
const sourceBuildHost = path.join(import.meta.dirname, "../../../dist/bridge/local/native-host.mjs");
const hostModule = path.resolve(args["host-module"] ?? (existsSync(bundledHost) ? bundledHost : sourceBuildHost));
if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) throw new Error("Pass --extension-id with the 32-character Chrome extension ID");
if (!existsSync(hostModule)) throw new Error("Built native host not found at " + hostModule + ". Run npm run build first or pass --host-module.");

const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
const templatePath = path.join(import.meta.dirname, "../install-manifests", platform, "com.contextbridge.local.template.json");
const installRoot = platform === "windows"
  ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "ContextBridge")
  : path.join(os.homedir(), ".context-bridge");
await mkdir(installRoot, { recursive: true, mode: 0o700 });

const wrapper = platform === "windows" ? path.join(installRoot, "context-bridge-native-host.cmd") : path.join(installRoot, "context-bridge-native-host.sh");
const wrapperContent = platform === "windows"
  ? "@echo off\r\n\"" + process.execPath + "\" \"" + hostModule + "\"\r\n"
  : "#!/bin/sh\nexec \"" + process.execPath + "\" \"" + hostModule + "\"\n";
await writeFile(wrapper, wrapperContent, { encoding: "utf8", mode: 0o700 });
if (platform !== "windows") await chmod(wrapper, 0o700);

const manifest = (await readFile(templatePath, "utf8"))
  .replace("__EXTENSION_ID__", extensionId)
  .replace("__HOST_WRAPPER_PATH__", wrapper.replace(/\\/g, "\\\\"));
const manifestPath = nativeManifestPath(platform);
await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, manifest, "utf8");

if (platform === "windows") {
  const result = spawnSync("reg", ["add", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.contextbridge.local", "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Windows registry registration failed");
}
console.log("Installed the per-user Context Bridge native host manifest at " + manifestPath);

function nativeManifestPath(platformName) {
  if (platformName === "windows") return path.join(installRoot, "com.contextbridge.local.json");
  if (platformName === "macos") return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", "com.contextbridge.local.json");
  return path.join(os.homedir(), ".config", "google-chrome", "NativeMessagingHosts", "com.contextbridge.local.json");
}
