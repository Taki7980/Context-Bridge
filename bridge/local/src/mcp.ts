import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { publicToolResult, readActive, type ActivePayload } from "./state.ts";

export function buildLocalServer(reader: () => Promise<ActivePayload | undefined> = readActive): McpServer {
  const server = new McpServer(
    { name: "context-bridge-local", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.registerTool(
    "get_active_context",
    {
      title: "Get active Context Pack",
      description: "Returns only the single Context Pack revision explicitly activated by the user, or a no-active-context status.",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const result = publicToolResult(await reader());
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  return server;
}
