# @pancreator/policy

Compatibility helpers for legacy threshold-policy JSON/YAML files and the versioned upgrade path used by `pan upgrade --apply`.

## Quickstart

```bash
pnpm add @pancreator/policy
pnpm --filter @pancreator/policy run build
pnpm --filter @pancreator/policy run test
```

```typescript
import { loadLegacyPolicyConfig, upgradePolicyConfig } from "@pancreator/policy";

const legacy = await loadLegacyPolicyConfig("./pancreator.yaml");
const v1 = await upgradePolicyConfig("./pancreator.yaml");
```

## Migration contract

- `loadLegacyPolicyConfig(path)` parses JSON (`.json`) or YAML (`.yaml`/`.yml`), returns the raw document, and prints a **deprecation** line to stderr referencing Bootstrap Phase 3 policy migration (internal Q23). Use it only while bridging older repos.
- `upgradePolicyConfig(path)` reads the same files, returns `PolicyConfigV1` with `schemaVersion: 1`, and maps legacy **snake_case** keys (`project_root`, `risk_tier`, `contract_bundle`, `telemetry_gates`, `gates_on_failure`) to **camelCase** fields. It defaults `projectRoot` to `.` for self-hosted repos. It performs **no** filesystem writes; the caller persists after human review (for example `pan upgrade --apply`).
