# @pancreator/adopter-scan

Presence-only adoption scan for existing repositories. The scan reads marker files (for example `package.json`, `pyproject.toml`, `.github/workflows`) and dependency keys; it does not compile or execute project code.

## Quickstart

```bash
pnpm add @pancreator/adopter-scan
pnpm --filter @pancreator/adopter-scan run build
pnpm --filter @pancreator/adopter-scan run test
```

```typescript
import { scanRepository } from "@pancreator/adopter-scan";

const report = await scanRepository(process.cwd());
console.log(JSON.stringify(report, null, 2));
```
