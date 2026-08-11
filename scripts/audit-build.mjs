import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionRoot = path.join(root, "dist", "extension");
const files = await walk(extensionRoot);
const forbiddenNames = [/\.env(?:\.|$)/, /fixture/i, /\.map$/i, /test/i];
const failures = [];

for (const file of files) {
  const relative = path.relative(extensionRoot, file);
  if (forbiddenNames.some((pattern) => pattern.test(relative))) failures.push("forbidden production file: " + relative);
  if (/\.(?:js|html|json|css)$/.test(file)) {
    const text = await readFile(file, "utf8");
    if (/https?:\/\/(?:cdn|unpkg|jsdelivr)/i.test(text)) failures.push("remote code reference: " + relative);
    if (/\beval\s*\(|new\s+Function\s*\(/.test(text)) failures.push("dynamic execution: " + relative);
    if (/sourceMappingURL/.test(text)) failures.push("source map marker: " + relative);
    if (/BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/.test(text)) failures.push("private-key marker: " + relative);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Production build audit passed for " + files.length + " files.");

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(target));
    else output.push(target);
  }
  return output;
}
