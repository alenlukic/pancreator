# Validation framework

**State:** Active single-source architecture for policy-bound automation and validation.

**Outcome:** Pancreator resolves validator and automation requirements from policy metadata and a canonical registry, snapshots them on each invocation, and reruns authoritative checks at submit time.

**Next action:** Add new validators by registering a handler, adding a registry entry, and referencing the registry id from the owning policy's `requirements[]`.

Governance registries are indexed in [`governance/registries/index.md`](../governance/registries/index.md).

## Architecture

1. **Canonical registry** — `governance/registries/validation_registry.json` defines every durable automation and validator by stable id (handler, version, targets, timeout, side-effect declaration).
2. **Policy metadata** — each `governance/policies/*.json` MAY declare `requirements[]` that reference registry ids (never executable paths).
3. **Resolver** — `resolveRequirements` derives applicability from `resolvePolicies` output only; no second lookup table exists.
4. **Invocation manifest** — `prepareInvocation` snapshots the resolved manifest into `Invocation.requirements` and renders an agent requirements table plus a separate harness-owned checks section.
5. **Execution** — in-process typed handlers behind `./bin/pan` produce versioned validation-result artifacts under `runtime/logs/workflows/<run>/validations/`.
6. **Generated map** — `./bin/pan validation-map` joins policy lookup, requirement metadata, and registry for operator audits.

## Authoring a new validator

1. Implement a handler in `src/lib/requirements/handlers.ts` (or `src/lib/validators/`).
2. Add a registry entry to `governance/registries/validation_registry.json`.
3. Add a `requirements[]` item to the owning policy JSON referencing the registry id.
4. Add unit tests for success and failure cases.
5. Run `npm run check`.

## Failure semantics

Failure routes (`retry`, `stage_failure`, `blocked`, `operator_decision`) are declared on each policy requirement and applied by the harness at submit time. See `VALID-001` and `AUTO-001` for normative rules.

## CLI surfaces

- `./bin/pan requirements resolve --persona <p> --workflow <w> --stage <s>`
- `./bin/pan output scaffold|validate`
- `./bin/pan assessment scaffold`
- `./bin/pan governance audit-directives`
- `./bin/pan validation-map`

## Standalone artifact validation

Standalone personas can resolve and run their policy-bound validators without creating a workflow run:

```sh
./bin/pan requirements run \
  --persona decomposer \
  --workflow standalone \
  --stage decompose \
  --kind decomposition \
  --registry DECOMPOSITION-VALIDATE-001 \
  --target runtime/inbox/decomposition-<id>.md \
  --json
```

The command only runs a validator that resolves from the supplied policy context and accepts the inferred target type. It exits nonzero when validation does not pass.
