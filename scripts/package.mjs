import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const release = path.join(root, "release");
const version = "1.0.0";
await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });

const coreZip = path.join(release, "context-bridge-extension-v" + version + ".zip");
const bridgeZip = path.join(release, "context-bridge-local-mcp-extension-v" + version + ".zip");
const completeZip = path.join(release, "context-bridge-complete-v" + version + ".zip");
await zipDirectory(path.join(root, "dist", "extension"), coreZip);
await zipDirectory(path.join(root, "dist", "extension-bridge"), bridgeZip);
await writeChecksums([coreZip, bridgeZip]);

const completeStage = await mkdtemp(path.join(os.tmpdir(), "context-bridge-complete-"));
await copyProject(root, completeStage);
await zipDirectory(completeStage, completeZip);
await rm(completeStage, { recursive: true, force: true });
await writeChecksums([coreZip, bridgeZip, completeZip]);

console.log("Release packages created in " + release);

async function copyProject(source, destination) {
  const excluded = new Set(["node_modules", ".git", ".test-dist", "test-results", "release"]);
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    await cp(from, to, { recursive: true });
  }
  await rm(path.join(destination, "benchmarks", "results.json"), { force: true });
  await cp(release, path.join(destination, "release"), { recursive: true });
}

async function writeChecksums(files) {
  const lines = [];
  for (const file of files) lines.push(await hashFile(file) + "  " + path.basename(file));
  await writeFile(path.join(release, "SHA256SUMS.txt"), lines.join("\n") + "\n", "utf8");
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function zipDirectory(source, output) {
  const stage = await mkdtemp(path.join(os.tmpdir(), "context-bridge-zip-"));
  await cp(source, stage, { recursive: true });
  const files = await walk(stage);
  const fixed = new Date("2020-01-01T00:00:00.000Z");
  for (const file of files) await utimes(file, fixed, fixed);
  const relativeFiles = files.map((file) => path.relative(stage, file)).sort();
  const result = spawnSync("zip", ["-X", "-q", output, ...relativeFiles], { cwd: stage, encoding: "utf8" });
  await rm(stage, { recursive: true, force: true });
  if (result.status !== 0) throw new Error("zip failed: " + (result.stderr || result.stdout));
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(target));
    else if ((await stat(target)).isFile()) output.push(target);
  }
  return output;
}
