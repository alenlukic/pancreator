# ADR Draft — Normalize feature-folder shape and collapse Cursor agent suffix variants

- Status: proposed
- Date: 2026-05-26
- Deciders: tech-lead (plan stage), human operator (ratification gate)
- Task: `54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants`

## Context

The batch intake requests one coordinated cleanup across two noisy surfaces:

1. `src/memory/features/pancreator-*/` folders that must be dispositioned and brought to a maintainable Phase-2 shape.
2. `.cursor/agents/` per-persona suffix variants (`-standard`, `-complex`) that duplicate tier semantics already documented in handbook policy.

At plan time, the 20 `pancreator-*` feature folders already contain authored package contracts (`contracts/`) and planning scaffolds (`plan.md`, `tasks.md`). The remaining structural gap is missing per-folder `index.json` and `delivery-report.md` surfaces in the reference shape used by normalized features.

## Decision

The implementation stage SHALL execute this two-part strategy:

1. **Feature-folder normalization without destructive deletion.**  
   Classify all 20 `pancreator-*` folders as `author`; preserve current contract and planning artifacts; add missing `index.json` and `delivery-report.md`; then update `src/memory/features/index.json` in lockstep.

2. **Single Cursor projection file per persona.**  
   Keep only `.cursor/agents/<persona>.md` plus `.cursor/agents/general-purpose.md`; delete all `-standard` and `-complex` files in one change set; update docs/tests so tier choice remains standard-by-default with explicit complex escalation but no filename-suffix dependency.

## Consequences

### Positive

- Removes two recurring audit noise sources while avoiding high-risk contract-surface rewrites.
- Preserves existing package-level contract artifacts and minimizes migration blast radius.
- Reduces per-persona projection maintenance from three files to one file.
- Keeps tiering policy explicit in canonical docs instead of duplicated path conventions.

### Negative / trade-offs

- Requires coordinated updates across handbook and test surfaces in the same batch.
- Leaves tier selection as policy/invocation guidance rather than file-path affordance, so operator docs must be precise.
- Increases one-time implementation touch-set size because all suffix files must be removed atomically.

### Follow-up obligations

- Reviewer stage SHALL verify zero stale references to deleted suffix files across handbook, `AGENTS.md`, and active-memory/documentation surfaces.
- Report stage SHALL publish a deletion manifest for the 24 removed suffix files and a completed list of all 20 normalized feature folders.

## Alternatives considered

1. **Delete all 20 `pancreator-*` feature folders.** Rejected because current folders already contain package contract artifacts and planned work structure.
2. **Consolidate all 20 folders into one umbrella feature.** Rejected for this batch because it couples cleanup with a larger information-architecture migration.
3. **Keep suffix files and only edit docs.** Rejected because three-file projection maintenance is the operational cost driver.

## References

- `{kind: lines, path: src/inbox/in/172981_05-25-26/71700_0612_bootstrap-cruft-cleanup-batch.md, range: [34, 137], contentHash: ec6a02d}`
- `{kind: lines, path: src/memory/features/bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/spec.md, range: [61, 135], contentHash: 0158529}`
- `{kind: lines, path: src/memory/features/json-formatting/spec.md, range: [1, 179], contentHash: 697b305}`
- `{kind: lines, path: src/memory/handbook/subagent-model-tiers.md, range: [1, 93], contentHash: 6d90e18}`
- `{kind: lines, path: src/memory/adr/0004-documentation-impact-contract.md, range: [66, 100], contentHash: 1fa849a}`
