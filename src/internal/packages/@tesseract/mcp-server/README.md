# @tesseract/mcp-server

This package exposes the bootstrap `tess` workspace surface as an MCP server over **stdio**.

## Quickstart

1. Build the package from the repository root:

   ```bash
   pnpm install
   pnpm --filter @tesseract/mcp-server run build
   ```

2. Run the binary (installs resolve `tess-mcp-server` from `node_modules/.bin` when the package is a dependency):

   ```bash
   pnpm exec tess-mcp-server
   ```

3. List tools (from an MCP client that speaks stdio JSON-RPC; example names only):

   - `tools/list` returns `tess.init`, `tess.run`, `tess.inbox`, `tess.feature`, `tess.status`, `tess.approve`, `tess.memory`, `tess.contracts`, `tess.lint`, `tess.pause`, `tess.resume`, and `tess.abort`.

4. Call `tess.inbox` with `tools/call` and `{}` arguments while the process `cwd` is your Tesseract repository root. The result SHALL list file names under `src/inbox/in/` as JSON.

## M2 note (Q18)

Full MCP transport hardening, authentication, and multi-session routing are **deferred** to M2 per Q18. This package SHALL keep stdio as the supported transport for the bootstrap skeleton.

## Verification

```bash
pnpm --filter @tesseract/mcp-server run test
pnpm --filter @tesseract/mcp-server run typecheck
```

## See also

- `@tesseract/cli` for the matching `tess` CLI verbs.
- `docs/BOOTSTRAP.md` Phase 3 step 9 for the bootstrap scope statement.
