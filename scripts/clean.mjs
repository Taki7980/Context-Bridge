import { rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
await Promise.all([
  rm(path.join(root, "dist"), { recursive: true, force: true }),
  rm(path.join(root, ".test-dist"), { recursive: true, force: true }),
]);
