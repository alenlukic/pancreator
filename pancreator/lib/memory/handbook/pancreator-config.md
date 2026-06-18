# Operator section
- 👀 **In this file:** pancreator-config
- ⚖️ **Why it matters:** Quick orientation for pancreator-config before agents load the full contract.
- 🧭 **See also:**
  - an absolute path to the repository or project where the Pancreator harness is embedded, or
  - a relative path from the Pancreator harness root to that embedded project root.
  - Every **runnable** command an agent emits for an operator MUST use the full
<!-- pancreator-section-index
format: operator-agent-v1
agent_section_start_line: 12
-->
# Pancreator Config

`pancreator.yaml` is the live operator-facing configuration file for this repository.
It also carries the bundled threshold-policy defaults under a top-level `defaults:` block.

## `project_root`

`pancreator.yaml` MUST include a top-level `project_root` property.

The value is either:

- an absolute path to the repository or project where the Pancreator harness is embedded, or
- a relative path from the Pancreator harness root to that embedded project root.

When Pancreator is being used to develop itself, `project_root` MUST be the special value `.`:

```yaml
project_root: "."
```

The `.` value means the harness root and target project root are the same directory.

## Harness root vs project root

The **harness root** is the directory that contains harness-owned `pancreator.yaml`
and (when required) local repo-root `.cursor/` projections. The **project root**
is where operational trees (`lib/inbox/`, `lib/memory/`, `.pan/work/`, `.pan/archive/`,
`.pan/`) live. When `project_root` is `.pancreator`, those trees resolve under
`<harnessRoot>/.pancreator/` while `pancreator.yaml` stays at the harness root.

Canonical Cursor sources live under `<project_root>/lib/personas/` (agents and
rules). Materialize the runtime tree
with `pnpm -w exec pan cursor-sync` or `pan init --apply` (embedded).

Self-hosting (daedaline):

```bash
pnpm -w exec pan run feature-delivery 172976_05-30-26/13329_2017_embedded-harness-project-root-install.md
```

Embedded adopt (host repo with existing `AGENTS.md`; scaffold under `.pancreator/`;
delivery card at `.pancreator/AGENTS.md`, procedures at `.pancreator/OPERATION.md`):

```bash
cd /path/to/host-repo
pnpm -w exec pan init --apply
pnpm -w exec pan run feature-delivery <day-bucket>/<inbox-entry>.md
```

The inbox entry argument is always relative to `<project_root>/lib/inbox/in/`, not
the harness root.

## Adoption responsibility

The adopter persona owns proposing `project_root` during existing-repository adoption.

During adoption, the adopter SHOULD:

1. identify the target repository root,
2. propose the appropriate `project_root` value,
3. use `.` for self-hosting/self-development setups,
4. avoid writing `pancreator.yaml` directly unless the operator has ratified config-write mode.

## Closed bootstrap history

Bootstrap phases −1 through 5 are closed (M1 ratified 2026-05-31). Phase
sequencing, exit criteria, and ratification evidence live in `.docs/BOOTSTRAP.md`
and `lib/memory/features/bootstrap-phase-*`. `pancreator.yaml` does not carry a
`bootstrap` tracking block; do not use closed-phase status as a live behavior gate.
`.docs/M1.index.md` is the compact route for M1 scope before loading full PRD sources.

When upgrading legacy workspaces that still contain a `bootstrap` block,
`@pancreator/policy` exports optional `validateBootstrapTracking()` and
`nextBootstrapAfterRatification()` helpers for consistency checks during migration.

## CLI invocation in this workspace

The `@pancreator/cli` package exposes the `pan` binary, but this repository
does **not** install `pan` on the operator shell `PATH`. Agents and operators
SHALL invoke the CLI from the repository root with the workspace exec prefix:

```bash
pnpm -w exec pan <subcommand> [arguments...]
```

Rules:

- Every **runnable** command an agent emits for an operator MUST use the full
  form `pnpm -w exec pan …`, not bare `pan …`.
- Prose MAY refer to the logical verb (`pan advance`, `pan run`) when
  describing behavior; **How** clauses in **Next operator steps** and runbooks
  MUST use the prefixed invocation.
- Node maintenance scripts (`node lib/internal/tools/…`) are unchanged; only
  the `pan` CLI requires the prefix.
- Agents that run `pan` in a shell themselves SHALL use the same prefix unless
  a ratified global install is documented in an ADR.

### `feature-delivery` inbox entry argument

`pnpm -w exec pan run feature-delivery <inbox-entry>` and `pnpm -w exec pan
feature new <inbox-entry>` resolve the directive under `lib/inbox/in/`. The
operator MUST pass `<inbox-entry>` as a path **relative to that directory**—the
day bucket and filename only, not the `lib/inbox/in/` prefix.

Canonical form:

```text
<day-bucket>/<SID>_<HHMM>_<slug>.md
```

Example: `172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md` for
`lib/inbox/in/172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md`.

The CLI MAY accept a legacy argument that still includes the `lib/inbox/in/`
prefix and SHALL normalize it to the bucket-relative form in `state.json`; new
documentation and agent **How** clauses MUST use the canonical form.

Examples:

```bash
pnpm -w exec pan run feature-delivery 172981_05-25-26/71701_0613_ci-best-practices-batch.md
pnpm -w exec pan advance <task-id> --artifact .pan/work/<day>/<task-id>/review.md
pnpm -w exec pan refresh-active-memory --dry-run
pnpm -w exec pan status <task-id>
```

### `runner.cursor.invocation` (feature-delivery)

`pancreator.yaml` MAY declare how the feature-delivery CLI invokes stage work:

```yaml
runner:
  cursor:
    invocation: manual  # manual | sdk
```

Rules:

- When the key is omitted, the CLI SHALL resolve `manual` (handoff-and-paste; no
  `@cursor/sdk` transport).
- When set to `sdk`, `pnpm -w exec pan run feature-delivery` and
  `pnpm -w exec pan advance` SHALL invoke `CursorRunner` for the entering stage
  after ledger validation, using persona markdown from `lib/personas/<name>.md`.
- The CLI SHALL load repo-root `.env` before constructing `CursorRunner` when
  the file exists; secret values MUST NOT be written to stdout, stderr, or
  `run.log.jsonl`.
- SDK-only automatic `review` / `test` loopbacks, the cumulative retry budget
  (max 5), retry-limit halt artifacts, and the report approval gate are defined
  in `OPERATION.md` and apply only under `sdk` mode.
- While a stage runs, the CLI emits progress on stderr every 2 minutes and on
  each stage transition. Agents that invoke `pan` from chat on the operator's
  behalf SHALL set `PAN_FD_PROGRESS=ndjson`, monitor stderr for
  `feature_delivery_progress` events, and relay concise status lines to chat per
  `AGENTS.md` §5. Operators running in a TTY receive `[pan fd] …` on stderr
  automatically; see `OPERATION.md` § SDK mode.

`runner.cursor.model_escalation.config` MAY name which entry under
`pancreator-model-escalation.yaml` `configs` is active for SDK runs. When omitted,
the file-level `active_config` scalar applies. `PAN_MODEL_ESCALATION_CONFIG` overrides
both. Escalation applies only when `invocation` is `sdk`; see `OPERATION.md` § SDK mode
for tier resolution, fallback order, and `run.log.jsonl` field names.

## Operator documentation (`OPERATION.md`)

When a change affects operator-facing interfaces (CLI flags or subcommands,
documented paths under `lib/inbox/`, `.pan/work/`, or `lib/memory/features/`,
default values, or environment variables), the author SHALL update
`OPERATION.md` in the same change set. `README.md` SHALL remain a high-level
external landing page with a pointer to `OPERATION.md`. Agent obligations live
in `AGENTS.md` (self-host) or `.pancreator/AGENTS.md` (embedded). Product
spec and bootstrap history: `.docs/` (internal).

## Editing guidance

When changing `pancreator.yaml`:

- preserve the top-level `project_root` property,
- update bootstrap phase tracking only after checking `.docs/BOOTSTRAP.md`,
- apply phase ratification as one atomic change across `phase`, `status`, and
  `completed_phases` per the invariants above,
- keep reusable threshold-policy presets under the top-level `defaults:` block,
- route adoption-related changes through `lib/personas/adopter.md` and `lib/personas/skills/adopt-existing-repo/SKILL.md`.
