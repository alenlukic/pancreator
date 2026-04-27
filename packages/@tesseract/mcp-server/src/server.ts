#!/usr/bin/env node
import { createMcpServer } from "./create-mcp-server.js";

await createMcpServer().run();
