# Pancreator v0 Dashboard (`client/`)

Operator-local Next.js dashboard for exploring repository relationships, reading and editing authorized files, and viewing reverse-chronological activity.

## Startup

From the repository root:

```bash
pnpm --filter client dev
```

The dev server starts on `http://localhost:3000` with hot reload enabled.

## Validation

```bash
pnpm --filter client lint
pnpm --filter client typecheck
pnpm --filter client test
pnpm --filter client test:coverage
pnpm --filter client build
```

If `next build` fails with a missing `pages-manifest.json` under `client/node_modules/.cache/next`, clear the Next cache and rebuild:

```bash
rm -rf client/node_modules/.cache/next
pnpm --filter client build
```

## v0 limitations

- No authentication or multi-tenant isolation; intended for a trusted local operator only.
- File access denies `src/inbox/notes/**`, path traversal, and symlink escapes.
- Activity feed combines recent domain file updates with structured write-log entries.
- UI polish and deployment packaging are intentionally out of scope for this subordinate QA exercise.
