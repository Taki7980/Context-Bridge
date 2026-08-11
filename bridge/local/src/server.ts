import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildLocalServer } from "./mcp.ts";

const handle = serveStdio(() => buildLocalServer(), {
  legacy: "serve",
  onerror: () => process.stderr.write(JSON.stringify({ event: "mcp_error", result: "failed" }) + "\n"),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handle.close().finally(() => process.exit(0));
  });
}
