import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = await walk(root);
const sourceFiles = files.filter((file) => /\.(?:ts|mjs|html)$/.test(file) && !file.includes("node_modules") && !file.includes("/dist/") && !file.includes("/release/"));
const failures = [];

for (const file of sourceFiles) {
  const text = await readFile(file, "utf8");
  const relative = path.relative(root, file);
  for (const [name, pattern] of [
    ["dynamic evaluation", /\beval\s*\(|new\s+Function\s*\(/],
    ["captured HTML sink", /\.innerHTML\s*=|insertAdjacentHTML\s*\(/],
    ["remote extension script", /<script[^>]+https?:\/\//i],
    ["unsafe TODO placeholder", /\bTODO:\s*(?:security|implement|placeholder)/i],
  ]) {
    if (pattern.test(text)) failures.push(relative + ": " + name);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Static lint passed for " + sourceFiles.length + " files.");

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "release"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(target));
    else output.push(target);
  }
  return output;
}
