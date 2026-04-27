import * as path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

import { listResourceDefinitions, listToolDefinitions, type TessToolName } from "./definitions.js";
import { executeTessTool, readTesseractResource, type TessExecutionContext } from "./tess-execute.js";

export interface CreateMcpServerOptions {
  /**
   * Repository root; defaults to `process.cwd()`.
   */
  repoRoot?: string;
}

export interface McpServerHandle {
  server: Server;
  /**
   * Connects the stdio transport. The returned promise settles when the transport closes.
   */
  run: () => Promise<void>;
}

function callToolTextResult(payload: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function pathResolveRepoRoot(repoRoot?: string): string {
  return repoRoot !== undefined ? path.resolve(repoRoot) : process.cwd();
}

/**
 * Wires a `Server` and `StdioServerTransport` for the Tesseract MCP surface.
 */
export function createMcpServer(
  options?: CreateMcpServerOptions,
): McpServerHandle {
  const repoRoot = pathResolveRepoRoot(options?.repoRoot);
  const ctx: TessExecutionContext = { repoRoot };

  const server = new Server(
    { name: "tesseract-mcp-server", version: TESSERACT_CORE_VERSION },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: false },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    return {
      tools: listToolDefinitions().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name as TessToolName;
    const known = new Set(
      listToolDefinitions().map((d) => d.name),
    ) as Set<TessToolName>;
    if (!known.has(name)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${request.params.name}`,
          },
        ],
        isError: true,
      };
    }
    const args = request.params.arguments ?? {};
    try {
      const out = await executeTessTool(name, args, ctx);
      return callToolTextResult(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
  });

  const staticResources = () =>
    listResourceDefinitions()
      .filter((d) => !d.uriTemplate.includes("{"))
      .map((d) => ({
        name: d.name,
        uri: d.uriTemplate,
        description: d.description,
        mimeType: d.mimeType,
      }));

  const templateResources = () =>
    listResourceDefinitions()
      .filter((d) => d.uriTemplate.includes("{"))
      .map((d) => ({
        name: d.name,
        uriTemplate: d.uriTemplate,
        description: d.description,
        mimeType: d.mimeType,
      }));

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: staticResources(),
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates: templateResources(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    try {
      const { mimeType, text } = await readTesseractResource(uri, ctx);
      return {
        contents: [
          {
            uri,
            mimeType,
            text,
          },
        ],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: msg,
          },
        ],
      };
    }
  });

  return {
    server,
    run: () => runStdio(server),
  };
}

async function runStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    const prev = transport.onclose;
    transport.onclose = () => {
      prev?.();
      resolve();
    };
  });
  await server.connect(transport);
  await closed;
}

/**
 * Exposes the same `executeTessTool` path the MCP `tools/call` handler uses (tests, scripts).
 */
export async function callTessToolMcp(
  name: TessToolName,
  args: Record<string, unknown> | undefined,
  options?: CreateMcpServerOptions,
): Promise<Record<string, unknown>> {
  const repoRoot = pathResolveRepoRoot(options?.repoRoot);
  return executeTessTool(name, args, { repoRoot });
}

/**
 * Exposes the same `readTesseractResource` path the `resources/read` handler uses.
 */
export async function readTesseractResourceMcp(
  uri: string,
  options?: CreateMcpServerOptions,
): Promise<{ mimeType: string; text: string }> {
  const repoRoot = pathResolveRepoRoot(options?.repoRoot);
  return readTesseractResource(uri, { repoRoot });
}
