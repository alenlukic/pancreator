# Task List - @pancreator/env-isolation

- [x] T1: `PortRegistry` + `PortRegistryEnvIsolation`; atomic writes to `.pan/sandboxes/port-registry.json`; collision detection on load; contiguous block allocation with configurable inclusive range.
- [x] T2: README Quickstart with explicit `pnpm --filter` commands (package shape + ergonomics intent).
- [x] T3: Vitest coverage for reserve, idempotent reserve, block-size change guard, release/reuse, corrupt duplicate-port file.
- [ ] T4: **Deferred:** full PRD `EnvIsolation` surface (`DB_NAME`, `COMPOSE_PROJECT_NAME`, `.env.pan`, cleanup hooks); migration path if registry schema version increments.
