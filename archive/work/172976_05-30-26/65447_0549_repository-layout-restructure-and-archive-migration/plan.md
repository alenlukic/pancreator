# Plan — repository-layout-restructure-and-archive-migration

The implement stage SHALL execute a one-shot repository migration through scripted moves and scripted reference rewrites, so canonical runtime roots move to `archive/`, `work/`, and `lib/` without compatibility shims and without partial rollout states. The implementation SHALL preserve artifact integrity while updating CLI/runtime path resolution, Cursor agent projections, rules, docs, tests, and compliance fixtures in one bounded touch-set, then SHALL validate mapping completeness, stale-path elimination, and smoke-path operability before review. Citations: `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [41, 133], contentHash: "pending-refresh"}` and `{kind: lines, path: "work/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/touch-set.json", range: [1, 407], contentHash: "pending-refresh"}`.

## Implementation Tasks

1. **Establish migration tooling and guardrails.**
   - The implementor SHALL create `lib/internal/tools/migrate-repository-layout.mjs` with `--dry-run` and apply behavior that performs WP-1 through WP-4 path moves using `git mv` where history preservation applies.
   - The implementor SHALL create `lib/internal/tools/validate-repository-layout.mjs` to assert required canonical directories, full mapping coverage, and zero stale `lib/` path references for migrated surfaces.
   - The implementor SHALL create `lib/internal/tools/migrate-repository-layout.test.mjs` to verify mapping rules, no-shim constraints, and deterministic dry-run plans.
   - Citations: `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [121, 134], contentHash: "pending-refresh"}` and `{kind: lines, path: "work/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/touch-set.json", range: [149, 168], contentHash: "pending-refresh"}`.

2. **Execute structural tree migration.**
   - The implementor SHALL relocate `archive/inbox/**` to `archive/inbox/**` and `archive/work/**` to `archive/work/**` while preserving relative structure.
   - The implementor SHALL move active run state from `work/**` to `work/**`.
   - The implementor SHALL relocate `lib/personas/skills/**` to `lib/personas/skills/**` and rename remaining `lib/**` branches to `lib/**` per the canonical mapping table.
   - The implementor SHALL remove the `lib/` root after migration completion with no compatibility aliases.
   - Citations: `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [43, 94], contentHash: "pending-refresh"}` and `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [135, 161], contentHash: "pending-refresh"}`.

3. **Retire agent tier variants and normalize projections.**
   - The implementor SHALL keep one canonical `.cursor/agents/<name>.md` file per persona.
   - The implementor SHALL delete all `.cursor/agents/*-standard.md` and `.cursor/agents/*-complex.md` files.
   - The implementor SHALL remove `lib/memory/handbook/subagent-model-tiers.md` and any routing prose that depends on variant tier selection.
   - Citations: `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [95, 110], contentHash: "pending-refresh"}` and `{kind: lines, path: "work/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/touch-set.json", range: [72, 105], contentHash: "pending-refresh"}`.

4. **Update runtime and policy references to canonical paths.**
   - The implementor SHALL update CLI and runtime path derivation in `lib/internal/packages/@pancreator/cli/lib/` surfaces declared in the touch-set.
   - The implementor SHALL update AGENTS and handbook path contracts, docs route maps, rule globs, compliance fixtures, and tests so no canonical contract points to stale migrated paths.
   - The implementor SHALL keep `lib/inbox/notes/**` untouched while updating only references to that sandbox path.
   - Citations: `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [111, 119], contentHash: "pending-refresh"}` and `{kind: lines, path: "work/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/touch-set.json", range: [7, 238], contentHash: "pending-refresh"}`.

5. **Run dry-run, apply, and validation gates.**
   - The implementor SHALL present dry-run output before apply mode.
   - The implementor SHALL run acceptance and smoke validations listed in the touch-set, including repository tests, compliance checks, scaffold checks, context-budget checks, and migration validator checks.
   - The implementor SHALL verify `pan run`, `pan advance`, and `pan close-artifacts` smoke semantics against migrated canonical roots.
   - Citations: `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [125, 131], contentHash: "pending-refresh"}` and `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [182, 190], contentHash: "pending-refresh"}`.

## Risks and Controls

- **Risk:** Broad reference sweep misses stale `lib/` paths.  
  **Control:** Enforce validator scan plus targeted grep checks during dry-run and apply verification.
- **Risk:** Large move set breaks generated path templates.  
  **Control:** Update `feature-delivery-run.ts` and `repo-env.ts` early, then run smoke commands.
- **Risk:** Agent projection simplification regresses persona invocation.  
  **Control:** Validate one-file-per-persona invariant and remove all variant references before handoff.
- **Risk:** Existing unrelated workspace changes complicate migration diff review.  
  **Control:** Keep implementation strictly within declared touch-set and report untouched unrelated diffs.

## Validation Commands

```bash
pnpm test
node --test tests/*.test.mjs
node lib/internal/tools/check-phase-0a-scaffold.mjs
node lib/internal/tools/context-budget-report.mjs
bash -n .cursor/hooks/enforce-policy-compliance.sh
node lib/internal/tools/validate-repository-layout.mjs
pnpm -w exec pan run feature-delivery <day-bucket>/<sid_hhmm_slug>.md --dry-run
pnpm -w exec pan advance 65447_0549_repository-layout-restructure-and-archive-migration --artifact work/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/touch-set.json --dry-run
```

## Documentation Impact Decision

```yaml
documentation_impact:
  applies: true
  rationale: "The migration redefines canonical repository roots and removes projection-tier policy, which changes operator contracts and path references across docs, rules, tests, and runtime help text."
  changed-surfaces:
    - AGENTS.md
    - OPERATION.md
    - docs/**
    - lib/memory/handbook/**
    - .cursor/agents/**
    - .cursor/rules/**
    - lib/internal/packages/@pancreator/cli/**
    - tests/compliance/**
  deferred-items: []
```

## Dual-Anchor Citations

- `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [41, 62], contentHash: "pending-refresh"}`
- `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [63, 94], contentHash: "pending-refresh"}`
- `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [95, 110], contentHash: "pending-refresh"}`
- `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [111, 133], contentHash: "pending-refresh"}`
- `{kind: lines, path: "lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md", range: [135, 190], contentHash: "pending-refresh"}`
- `{kind: lines, path: "work/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/touch-set.json", range: [1, 407], contentHash: "pending-refresh"}`
