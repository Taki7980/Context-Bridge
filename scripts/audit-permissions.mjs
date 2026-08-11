import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const forbidden = new Set(["cookies", "history", "webRequest", "unlimitedStorage", "clipboardRead", "downloads", "alarms", "tabs"]);
const coreAllowed = ["activeTab", "scripting", "sidePanel", "storage"];
const bridgeAllowed = [...coreAllowed, "nativeMessaging"];

for (const [name, allowed] of [["extension", coreAllowed], ["extension-bridge", bridgeAllowed]]) {
  const manifest = JSON.parse(await readFile(path.join(root, "dist", name, "manifest.json"), "utf8"));
  const permissions = manifest.permissions ?? [];
  if (JSON.stringify(permissions) !== JSON.stringify(allowed)) throw new Error(name + " permissions differ from the reviewed allowlist");
  if (manifest.host_permissions && manifest.host_permissions.length > 0) throw new Error(name + " should not have host permissions for privacy compliance");
  for (const permission of permissions) if (forbidden.has(permission)) throw new Error(name + " contains forbidden permission " + permission);
  if (name === "extension" && permissions.includes("nativeMessaging")) throw new Error("Core build contains nativeMessaging");
}
console.log("Manifest permission audit passed.");
