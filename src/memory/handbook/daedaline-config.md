# Daedaline Config

`daedaline.yaml` is the live operator-facing configuration file for this repository.
`daedaline-defaults.yaml` contains default policy values and historical bootstrap defaults; it is not the live bootstrap phase tracker.

## `project_root`

`daedaline.yaml` MUST include a top-level `project_root` property.

The value is either:

- an absolute path to the repository or project where the Daedaline harness is embedded, or
- a relative path from the Daedaline harness root to that embedded project root.

When Daedaline is being used to develop itself, `project_root` MUST be the special value `.`:

```yaml
project_root: "."
```

The `.` value means the harness root and target project root are the same directory.

## Adoption responsibility

The adopter persona owns proposing `project_root` during existing-repository adoption.

During adoption, the adopter SHOULD:

1. identify the target repository root,
2. propose the appropriate `project_root` value,
3. use `.` for self-hosting/self-development setups,
4. avoid writing `daedaline.yaml` directly unless the operator has ratified config-write mode.

## Bootstrap tracking

Live bootstrap state belongs in `daedaline.yaml` under the `bootstrap` block.

For this repository, the current live state is Phase 5 in progress with phases `-1`, `0`, `1`, `2`, `3`, and `4` completed.

`docs/BOOTSTRAP.md` remains the phase-contract and milestone reference. `docs/M1.index.md` is the compact route for M1/bootstrap context before loading the full bootstrap or PRD documents.

## CLI invocation in this workspace

The `@daedaline/cli` package exposes the `ddl` binary, but this repository
does **not** install `ddl` on the operator shell `PATH`. Agents and operators
SHALL invoke the CLI from the repository root with the workspace exec prefix:

```bash
pnpm -w exec ddl <subcommand> [arguments...]
```

Rules:

- Every **runnable** command an agent emits for an operator MUST use the full
  form `pnpm -w exec ddl …`, not bare `ddl …`.
- Prose MAY refer to the logical verb (`ddl advance`, `ddl run`) when
  describing behavior; **How** clauses in **Next operator steps** and runbooks
  MUST use the prefixed invocation.
- Node maintenance scripts (`node src/internal/tools/…`) are unchanged; only
  the `ddl` CLI requires the prefix.
- Agents that run `ddl` in a shell themselves SHALL use the same prefix unless
  a ratified global install is documented in an ADR.

### `feature-delivery` inbox entry argument

`pnpm -w exec ddl run feature-delivery <inbox-entry>` and `pnpm -w exec ddl
feature new <inbox-entry>` resolve the directive under `src/inbox/in/`. The
operator MUST pass `<inbox-entry>` as a path **relative to that directory**—the
day bucket and filename only, not the `src/inbox/in/` prefix.

Canonical form:

```text
<day-bucket>/<SID>_<HHMM>_<slug>.md
```

Example: `172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md` for
`src/inbox/in/172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md`.

The CLI MAY accept a legacy argument that still includes the `src/inbox/in/`
prefix and SHALL normalize it to the bucket-relative form in `state.json`; new
documentation and agent **How** clauses MUST use the canonical form.

Examples:

```bash
pnpm -w exec ddl run feature-delivery 172981_05-25-26/71701_0613_ci-best-practices-batch.md
pnpm -w exec ddl advance <task-id> --artifact src/work/<day>/<task-id>/review.md
pnpm -w exec ddl refresh-active-memory --dry-run
pnpm -w exec ddl status <task-id>
```

### `runner.cursor.invocation` (feature-delivery)

`daedaline.yaml` MAY declare how the feature-delivery CLI invokes stage work:

```yaml
runner:
  cursor:
    invocation: manual  # manual | sdk
```

Rules:

- When the key is omitted, the CLI SHALL resolve `manual` (handoff-and-paste; no
  `@cursor/sdk` transport).
- When set to `sdk`, `pnpm -w exec ddl run feature-delivery` and
  `pnpm -w exec ddl advance` SHALL invoke `CursorRunner` for the entering stage
  after ledger validation, using persona markdown from `src/personas/<name>.md`.
- The CLI SHALL load repo-root `.env` before constructing `CursorRunner` when
  the file exists; secret values MUST NOT be written to stdout, stderr, or
  `run.log.jsonl`.
- SDK-only automatic `review` / `test` loopbacks, the cumulative retry budget
  (max 3), retry-limit halt artifacts, and the report approval gate are defined
  in `OPERATION.md` and apply only under `sdk` mode.

## Bootstrap tracking invariants

The `bootstrap` block MUST keep three fields internally consistent:

| Field | Rule |
|---|---|
| `phase` | Current active bootstrap phase as a string integer (`"5"`). |
| `status` | MUST be `phase-<N>-in-progress` where `<N>` equals `phase`. |
| `completed_phases` | MUST list every phase from `"-1"` through `<N - 1>` with no gaps. |

Ratifying a phase boundary is an **atomic advance**. Operators MUST NOT leave
`status: phase-<N>-ratified` as a stable end state. After human ratification of
phase `N`, update all three fields together:

1. Append `"N"` to `completed_phases`.
2. Set `phase` to `"N + 1"`.
3. Set `status` to `phase-<N + 1>-in-progress`.

`@daedaline/policy` exports `validateBootstrapTracking()` and
`nextBootstrapAfterRatification()` for the expected post-ratification shape.
Repository tests call the validator against live `daedaline.yaml` so partial
updates fail CI instead of drifting.

## Operator documentation (`OPERATION.md`)

When a change affects operator-facing interfaces (CLI flags or subcommands,
documented paths under `src/inbox/`, `src/work/`, or `src/memory/features/`,
default values, or environment variables), the author SHALL update
`OPERATION.md` in the same change set. `README.md` SHALL remain a short entry
point that routes to `OPERATION.md` for procedure. `AGENTS.md` and
`docs/M1.index.md` SHALL keep a pointer to `OPERATION.md` in operator-routing
sections.

## Editing guidance

When changing `daedaline.yaml`:

- preserve the top-level `project_root` property,
- update bootstrap phase tracking only after checking `docs/BOOTSTRAP.md`,
- apply phase ratification as one atomic change across `phase`, `status`, and
  `completed_phases` per the invariants above,
- keep defaults in `daedaline-defaults.yaml` separate from live tracking,
- route adoption-related changes through `src/personas/adopter.md` and `src/skills/adopt-existing-repo/SKILL.md`.
