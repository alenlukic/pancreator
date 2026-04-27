# @tesseract/policy

Compatibility helpers for legacy threshold-policy JSON/YAML files and the versioned upgrade path used by `tess upgrade --apply`.

## Quickstart

```bash
pnpm add @tesseract/policy
pnpm --filter @tesseract/policy run build
pnpm --filter @tesseract/policy run test
```

```typescript
import { loadLegacyPolicyConfig, upgradePolicyConfig } from "@tesseract/policy";

const legacy = await loadLegacyPolicyConfig("./tesseract.yaml");
const v1 = await upgradePolicyConfig("./tesseract.yaml");
```

## Migration contract

- `loadLegacyPolicyConfig(path)` parses JSON (`.json`) or YAML (`.yaml`/`.yml`), returns the raw document, and prints a **deprecation** line to stderr referencing Bootstrap Phase 3 policy migration (internal Q23). Use it only while bridging older repos.
- `upgradePolicyConfig(path)` reads the same files, returns `PolicyConfigV1` with `schemaVersion: 1`, and maps legacy **snake_case** keys (`risk_tier`, `contract_bundle`, `telemetry_gates`, `gates_on_failure`) to **camelCase** fields. It performs **no** filesystem writes; the caller persists after human review (for example `tess upgrade --apply`).
