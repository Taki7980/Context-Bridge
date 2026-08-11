import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const platform = process.platform;
const installRoot = platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "ContextBridge") : path.join(os.homedir(), ".context-bridge");
const manifestPath = platform === "win32"
  ? path.join(installRoot, "com.contextbridge.local.json")
  : platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", "com.contextbridge.local.json")
    : path.join(os.homedir(), ".config", "google-chrome", "NativeMessagingHosts", "com.contextbridge.local.json");
await rm(manifestPath, { force: true });
await rm(installRoot, { recursive: true, force: true });
if (platform === "win32") spawnSync("reg", ["delete", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.contextbridge.local", "/f"], { stdio: "inherit" });
console.log("Removed the Context Bridge native host registration and wrapper.");
