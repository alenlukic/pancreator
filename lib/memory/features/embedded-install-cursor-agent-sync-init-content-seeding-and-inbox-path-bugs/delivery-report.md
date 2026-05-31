# Delivery report — embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs

Task id: `72723_0347_embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs`  
Feature id: `embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs`

## Delivery summary

This feature delivered the embedded-install fixes for cursor-agent sync, init content seeding, and inbox path resolution. The shipped scope promotes `cursor-sync` into the CLI runtime, wires `pan init --apply` to seed persona and handbook content before syncing agents, makes `pan intake new` honor `project_root`, updates the embedded SDK default and operator docs, and keeps the follow-on embedded-install manifest linked for the remaining rollout path.

## Validation status

Validation remained green on the implemented slice and the review gate passed with no must-fix findings. The recorded evidence includes:

- `node --test tests/cursor-sync.test.mjs tests/pan-init.test.mjs tests/project-root-resolution.test.mjs` - pass (14/14)
- `pnpm --filter @pancreator/cli typecheck` - pass
- `pnpm --filter @pancreator/cli build` - pass
- `bash -n .cursor/hooks/enforce-policy-compliance.sh` - pass

The review summary also confirmed that the staged diff stayed within the declared touch-set boundary and that no unresolved defects remained for this delivery slice.

## Delivery notes

- `lib/internal/packages/@pancreator/cli/src/cursor-sync.ts` now owns the cursor-agent projection logic that used to live in the bridge script.
- `lib/internal/packages/@pancreator/cli/src/pan-init.ts` now seeds embedded persona and handbook content and reports cursor-sync outcomes in the init envelope.
- `lib/internal/packages/@pancreator/cli/src/run.ts` and `lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts` now resolve inbox paths using the project root semantics required by embedded mode.
- `OPERATION.md` documents the embedded install checklist and the manual `pan cursor-sync` procedure.

## Operator follow-up

What: Accept this delivery report, then advance the task state once the staged artifact is approved.

How:

```bash
pnpm -w exec pan advance 72723_0347_embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs --artifact lib/memory/features/embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs/delivery-report.md
```
