import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname);
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "extension", "sidepanel"), { recursive: true });
await mkdir(path.join(dist, "extension", "assets"), { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  treeShaking: true,
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(root, "extension/src/service-worker.ts")],
    outfile: path.join(dist, "extension/service-worker.js"),
  }),
  build({
    ...common,
    entryPoints: [path.join(root, "extension/src/sidepanel/index.ts")],
    outfile: path.join(dist, "extension/sidepanel/index.js"),
  }),
]);

await Promise.all([
  cp(path.join(root, "extension/src/sidepanel/index.html"), path.join(dist, "extension/sidepanel/index.html")),
  cp(path.join(root, "extension/src/sidepanel/styles.css"), path.join(dist, "extension/sidepanel/styles.css")),
  cp(path.join(root, "extension/assets"), path.join(dist, "extension/assets"), { recursive: true }),
  cp(path.join(root, "extension/manifest.json"), path.join(dist, "extension/manifest.json")),
]);

await cp(path.join(dist, "extension"), path.join(dist, "extension-bridge"), { recursive: true });
await cp(path.join(root, "extension/manifest.bridge.json"), path.join(dist, "extension-bridge/manifest.json"));

for (const target of ["extension", "extension-bridge"]) {
  const manifestPath = path.join(dist, target, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

const nodeCommon = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  minify: false,
  sourcemap: false,
  legalComments: "eof",
  logLevel: "info",
};

await mkdir(path.join(dist, "bridge/local"), { recursive: true });
await mkdir(path.join(dist, "bridge/remote"), { recursive: true });

await Promise.all([
  build({ ...nodeCommon, entryPoints: [path.join(root, "bridge/local/src/server.ts")], outfile: path.join(dist, "bridge/local/server.mjs") }),
  build({ ...nodeCommon, entryPoints: [path.join(root, "bridge/local/src/native-host.ts")], outfile: path.join(dist, "bridge/local/native-host.mjs") }),
  build({
    ...nodeCommon,
    entryPoints: [path.join(root, "bridge/remote/src/server.ts")],
    outfile: path.join(dist, "bridge/remote/server.mjs"),
    banner: { js: "import { createRequire as __contextBridgeCreateRequire } from 'node:module'; const require = __contextBridgeCreateRequire(import.meta.url);" },
  }),
]);

await Promise.all([
  cp(path.join(root, "bridge/local/install-manifests"), path.join(dist, "bridge/local/install-manifests"), { recursive: true }),
  cp(path.join(root, "bridge/local/scripts"), path.join(dist, "bridge/local/scripts"), { recursive: true }),
  cp(path.join(root, "bridge/remote/.env.example"), path.join(dist, "bridge/remote/.env.example")),
  cp(path.join(root, "bridge/remote/Dockerfile"), path.join(dist, "bridge/remote/Dockerfile")),
  cp(path.join(root, "bridge/remote/migrations"), path.join(dist, "bridge/remote/migrations"), { recursive: true }),
]);
