# Task List - @daedaline/policy

- [x] T1: Implement `loadLegacyPolicyConfig` (JSON/YAML) with stderr deprecation referencing Bootstrap Phase 3 policy migration / Q23; implement `upgradePolicyConfig` returning `PolicyConfigV1` without FS write.
- [x] T2: README Quickstart + migration contract section (`daedaline.policy.readme_ergonomics`).
- [x] T3: `yaml` runtime dependency; `vitest` for upgrade + legacy warning behavior.
- [x] T4: `typecheck`, `test`, `attw`, `publint` scripts aligned with other primitives.
- [ ] T5 (deferred): Rego/Conftest evaluation, Cedar `Authorizer` adapter, and CLI `ddl upgrade --apply` persistence (Phase 4 / M2 per plan).
