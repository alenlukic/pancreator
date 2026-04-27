# @tesseract/cli

The `tess` workspace CLI composes inbox and intervention primitives. Subcommands `pause`, `resume`, and `abort` append intervention records under `<repo>/.tess/scheduler/interventions/`.

## Quickstart

```bash
pnpm add @tesseract/cli
pnpm --filter @tesseract/cli run build
pnpm --filter @tesseract/cli run test
```

```bash
pnpm exec tess --help
pnpm exec tess inbox
pnpm exec tess pause my-task-id
```

Programmatic driver:

```typescript
import { parseAndRun } from "@tesseract/cli";

const exitCode = await parseAndRun(["inbox"], { repoRoot: process.cwd() });
process.exit(exitCode);
```
