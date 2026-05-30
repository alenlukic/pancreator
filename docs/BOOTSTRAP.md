# Pancreator Bootstrap Sequence

> **Intent.** Carry Pancreator from a bare git repo to a self-hosting Delivery Pipeline that
> implements the rest of M1 under its own Contracts + Personas + Pipelines. Each phase
> has named owner(s), explicit inputs/outputs, and a hard exit criterion that the next
> phase depends on. Phases are intentionally incremental — the bootstrap closes its own
> chicken-and-egg loop one substrate at a time, and the human is the in-loop reviewer
> at every phase boundary (mirrors PRD §10 `Authorizer = LocalUserAuthorizer` default).

> **Cross-references.** PRD §3.5 (US-1, US-8, US-9, US-10), §4 (glossary), §4.5 (Contract
> Specification Language), §4.6 (Contract Style Discipline), §5.5 (monorepo layout), §6
> (persona roster + Anthropic Claude Agent SDK 16-field spec), §7 (`feature-delivery`
> pipeline), §11 (MVP scope), §12 (M0/M1), §13 (Q1–Q26 + R-class risks).


## Phase −1 — M0: Spec ratification & roster lock  *(human)*

Inputs: PRD v0.5. Outputs: ratified deltas committed to the PRD; locked MVP scope.

- Ratify or override Q1–Q26 (PRD §13). Defaults are reasonable; record any overrides in
  `/lib/memory/adr/0001-q-ratification.md` so future agents can cite them.
- Lock the **MVP persona roster as 10**: PRD §6's 8 (`supervisor`, `adopter`,
  `intake-analyst`, `tech-lead`, `coder`, `reviewer`, `librarian`, `tech-writer`) +
  two **bootstrap-canonical meta-personas** added here:
  - `persona-designer` — owns persona-spec authoring (Phase 1; ongoing whenever
    Librarian proposes a new SME or a human wants a fresh persona).
  - `contract-writer` — owns contract authoring against §4.5 + §4.6 (Phase 2; ongoing
    as a coach persona other personas can consult; complements — does not replace —
    the distributed `/lib/personas/skills/author-contract.md` pattern in PRD §6).
- Confirm Q3 = *stage diffs locally; never push without human gate* — phases 4 and 5
  rely on this default.

**Exit criterion.** Q-ratification ADR merged; persona roster delta noted in PRD §6.


## Phase 0 — Foundations  *(human, mechanical)*

Three sub-phases; do them in order. None of them require an LLM.

### 0a. Monorepo + repo scaffold (per §5.5 + §11)

- pnpm workspace + pnpm catalogs + Turborepo + Changesets (`linked: [["@pancreator/*"]]`)
  + `@arethetypeswrong/cli` + `publint` + `tsup --dts` + sub-path exports.
- ESLint rule `@pancreator/no-horizontal-primitive-deps` + a CI conformance check that
  fails on any horizontal dep between `@pancreator/<primitive>` packages, except
  `@pancreator/cli`, which MAY depend on other primitives as the workspace composer
  for `pan` (Phase 3 step 8).
- `@pancreator/mcp-server` uses the same composer carveout as `@pancreator/cli` so it
  MAY compose other workspace primitives for the MCP bridge (Phase 3 step 9).
- Empty package skeletons (just `package.json` + `README.md` + `lib/index.ts` stub) for
  every M1 `@pancreator/*` listed in PRD §11. Boundaries from day 1; rich features
  ratchet up later (PRD R13).
- Top-level dirs: `AGENTS.md` (sole root agent operating card per PRD §4 glossary),
  `.cursor/rules/`, `lib/personas/`, `lib/personas/skills/`,
  `lib/pipelines/`, `lib/ensembles/`, `lib/memory/{handbook,adr,rfc,prd,features,smes,backlog,debt,checkpoints,adoption,runbooks,postmortems,research}/`,
  `lib/inbox/{in,out,threads,notes}/` (where `lib/inbox/notes/` is a human-only
  operator sandbox excluded from agent traversal per
  `/lib/memory/handbook/inbox-lifecycle.md` §1a), `work/`,
  `.pan/{worktrees,sandboxes,scheduler}/`.
- `pancreator.yaml` + `pancreator-defaults.yaml` placeholders (one working default
  contract bundle per risk tier lands in Phase 2).

### 0b. Handbook seed (the canon Persona Designer + Contract Writer will read)

Without these, Phase 0c personas have nothing to anchor to. Each is a small,
hand-authored Markdown file that subsequent phases will *cite* (dual-anchor) but
not edit casually.

- `/lib/memory/handbook/constitution.md` — org charter; cites PRD §1, §2 (G1–G7), §3.5.
- `/lib/memory/handbook/glossary.md` — PRD §4 terms verbatim; the ubiquitous-language
  source of truth for Layer 1 lint.
- `/lib/memory/handbook/index.md` — MemoryRouter routing table (≤200 lines, intent → topic
  files; PRD §8 MVP retrieval).
- `/lib/memory/handbook/persona-spec.md` — Anthropic Claude Agent SDK 16-field YAML
  reference + the 5-line Cursor `.mdc` shim recipe (PRD §6).
- `/lib/memory/handbook/agents-md-authoring.md` — AGENTS.md authoring guide.
- `/lib/memory/handbook/contract-style.md` — PRD §4.6 Layers 1+2+3 reference.
- `/lib/memory/handbook/contract-templates/` — the 6 MVP scaffolds verbatim from PRD §4.6
  Layer 3: `ux-spec.template.md`, `api-spec.template.md`, `security.template.md`,
  `performance.template.md`, `behavior-preservation.template.md`, `llm-judge.template.md`.
- `/lib/memory/handbook/run-log-schema.md` — OpenInference + OTel GenAI semconv reference
  (so Phase 3's `@pancreator/run-logger` has a spec to conform to).
- `/lib/memory/handbook/contract-format.md` — PRD §4.5 wrapper schema reference.

### 0c. Bootstrap meta-personas + meta-skills  *(hand-authored)*

- `/lib/personas/skills/author-persona/SKILL.md` — Agent Skills open spec; loop: load persona-spec.md
  → fill 16-field YAML → emit `.cursor/rules/<name>.mdc` shim → human review.
- `/lib/personas/skills/author-contract/SKILL.md` — PRD §6's existing meta-skill, authored now.
- `lib/personas/persona-designer.md` — Anthropic 16-field; `skills: [author-persona]`;
  `metadata.bootstrap-only: false` (persists post-bootstrap for SME spawning).
- `lib/personas/contract-writer.md` — Anthropic 16-field; `skills: [author-contract]`;
  `metadata.bootstrap-only: false`.
- Both auto-emit `.cursor/rules/{persona-designer,contract-writer}.mdc` shims.

**Round-trip verification gate.** `persona-designer` authors the simplest persona
(`tech-writer`) end-to-end. Human reviews format conformance + content + auto-emitted
shim. Iterate until clean. **This catches BR1 (format drift) before Phase 1 multiplies
the error across 8 personas.**

**Exit criterion.** `git status` shows monorepo scaffold + handbook seed + 2 meta-personas
+ 2 meta-skills + a green `tech-writer` round-trip; CI green on lint + dep-rule + ATTW
+ publint.


## Phase 1 — Persona Designer → MVP roster  *(persona-designer, run in Cursor directly)*

Inputs: handbook from 0b; meta-lib/personas/skills from 0c. Outputs: 8 PRD §6 MVP persona
specs + their `.cursor/rules/*.mdc` shims.

- Author each of the 8 PRD MVP personas: `supervisor`, `adopter`, `intake-analyst`,
  `tech-lead`, `coder`, `reviewer`, `librarian`, `tech-writer`.
- Each spec: Anthropic 16-field; passes Layer 1 lint by hand-checklist (RFC 2119,
  EARS, atomic, active voice, glossary discipline, dual-anchor citations into PRD §6
  + relevant US-* in §3.5); declares `metadata.pancreator-pipeline-stages` so Phase 3's
  pipeline runtime can load it correctly; declares `skills:` referencing only skills
  that exist or are scheduled in the same phase.
- Auto-emit `.cursor/rules/<persona>.mdc` shims (single-source from `lib/personas/<name>.md`
  per PRD §6).
- Author MVP-required skills referenced by these personas (PRD §11): `write-adr`,
  `write-rfc`, `modern-code-review`, `blameless-postmortem`, `canonicalize-spec`,
  `adopt-existing-repo` — all to Agent Skills open spec.

**Exit criterion.** 10 persona files + 10 `.mdc` shims + 6 new skill packs (8 total
including the 2 from Phase 0c); human-reviewed for format + content + cross-references.


## Phase 2 — Contract Writer → M1 substrate contracts  *(contract-writer, run in Cursor directly)*

Inputs: PRD §5.5 (package layout), §11 (MVP scope), §4.5 (wrapper schema), §4.6 (style),
handbook templates. Outputs: per-package feature folders with delivery contracts.

- For each M1 `@pancreator/*` package in PRD §11, author a feature folder
  `/lib/memory/features/<package-slug>/` with Spec-Kit-aligned files: `spec.md` (canonical
  engineering spec, US-1 shape), `plan.md` (architecture + touch-set), `tasks.md`
  (decomposed task list), and `contracts/` (extracted sidecar contract clauses).
- Allowed contract `kind`s in M1: `kind: rego` (via Conftest — repo-shape, config
  invariants, telemetry gates) and `kind: llm-judge` (qualitative review of READMEs,
  DX, API ergonomics, with mandatory `quorum: 2-of-3 [haiku, haiku, sonnet]` +
  `cost_ceiling_usd: 0.50` per PRD §4.5 + R28).
- Package-shape conformance (which would naturally want `kind: ts-predicate`, an
  M3 kind) is expressed as `kind: rego` over JSON output of standard tools:
  `tsc --noEmit --pretty false`, `vitest --reporter=json`, `publint --json`,
  `attw --format json`, `eslint --format json`. The toolchain is the SOTA conformance
  surface (PRD §5.5 cross-cutting design rules) — Pancreator just gates on it.
- Seed `pancreator.yaml` + `pancreator-defaults.yaml` with one working contract bundle
  per risk tier (low/medium/high) using `kind: rego` for the telemetry gates from
  PRD §7's worked example (coverage floor, bundle-size delta, feature-contracts-pull).
- Author the contracts in **dependency order** (Phase 3 builds in this order; getting
  the order right means Coder always has runnable contracts to gate against):
  1. `@pancreator/core`
  2. `@pancreator/contract` + `@pancreator/contract-runner-rego` + `@pancreator/contract-runner-llm-judge` + `@pancreator/contract-style`
  3. `@pancreator/run-logger` + `@pancreator/checkpointer-fs`
  4. `@pancreator/memory` + `@pancreator/inbox` + `@pancreator/notifier`
  5. `@pancreator/persona` + `@pancreator/pipeline` + `@pancreator/runner-cursor`
  6. `@pancreator/worktree` + `@pancreator/env-isolation`
  7. `@pancreator/intervention`
  8. `@pancreator/adopter-scan` + `@pancreator/policy` (compat shim) + `@pancreator/cli`
  9. `@pancreator/mcp-server` (skeleton)

**Exit criterion.** Every M1 substrate package has a feature folder with spec/plan/
tasks/contracts; every `severity: block` clause passes Layer 1 lint by hand-checklist;
every contract has a named `owner` persona that exists from Phase 1; each clause's
`applies_to` anchor resolves cleanly against the scaffolded package. Human reviewed
for the contracts that gate the contract spine itself (mitigates BR2).


## Phase 3 — Coder → Substrate (the self-hosting step)  *(coder, hand-orchestrated in Cursor)*

Inputs: contracts from Phase 2. Outputs: working `@pancreator/*` packages + a runnable
Delivery Pipeline + green CI conformance suite.

> **Why hand-orchestrated.** Until 3.5 lands, the AgentRunner that would invoke Coder
> is itself one of the things being built. The Coder runs through Cursor's native
> harness directly; the contract runners from 3.2 are the gating substrate. From 3.5
> onward, Pancreator-native invocation becomes possible; Phase 4 is the first
> end-to-end pipeline-driven step.

Build in the dependency order from Phase 2. Each step's package contracts must run
green (gated by 3.2's runners from step 3.2 onward) before moving to the next:

1. **`@pancreator/core`** — types only, zero runtime deps.
2. **Contract spine** — `@pancreator/contract` + `@pancreator/contract-runner-rego` +
   `@pancreator/contract-runner-llm-judge` + `@pancreator/contract-style`. Once green,
   every subsequent package's contracts run automatically — this is the moment the
   bootstrap stops being purely hand-checked.
3. **Observability + state** — `@pancreator/run-logger` (OpenInference + OTel GenAI;
   conformance check: a sample run-log opens cleanly in **Phoenix** *and* **Langfuse**
   without adapter code — KPI A20 day 1) + `@pancreator/checkpointer-fs` (conformance
   check: passes LangGraph's own `BaseCheckpointSaver` v1 test suite verbatim).
4. **Memory + I/O surface** — `@pancreator/memory` (FileMemoryStore + MemoryRouter +
   dual-anchor citation methods) + `@pancreator/inbox` (FileInbox) + `@pancreator/notifier`
   (Console + Inbox).
5. **Persona / pipeline / runner — closes the harness loop** — `@pancreator/persona`
   (16-field parser + `.mdc` shim emitter) + `@pancreator/pipeline` (YAML →
   LangGraph.js `StateGraph` compiler) + `@pancreator/runner-cursor`. After this lands,
   pipelines can run end-to-end through Pancreator.
6. **Worktree + env isolation** — `@pancreator/worktree` (`GitWorktreePool`,
   single-pipeline-at-a-time per Q7) + `@pancreator/env-isolation`
   (`PortRegistryEnvIsolation` — closes the silent-collision US-6 gap from PRD §7).
7. **Intervention** — `@pancreator/intervention` wired to LangGraph
   `interrupt()` / `Command(goto)` / `checkpoint_id` time-travel; MVP CLI surfaces:
   `pan pause | resume | abort` (full 7-lever spectrum is M2 per PRD US-10).
8. **User surface** — `@pancreator/adopter-scan` + `@pancreator/policy` (compat shim
   per Q23 with deprecation warning + `pan upgrade --apply`) + `@pancreator/cli`
   (`pan init/run/lib/inbox/feature/status/approve/lib/memory/contracts/pause/resume/abort/lint`).
9. **MCP skeleton** — `@pancreator/mcp-server` skeleton (stdio transport; full wire-up
   is M2 per Q18). Publishes MVP `pan.*` verbs as MCP Tools and `/lib/memory/`,
   `/lib/inbox/`, `/work/run-log` as MCP Resources.

**CI conformance gates** (each becomes blocking from the moment its target package
lands; protects against PRD R18/R19 transitive-dep drift):

- LangGraph `BaseCheckpointSaver` v1 test suite green (own-suite-as-conformance).
- OpenInference + OTel GenAI sample run-log opens cleanly in Phoenix and Langfuse.
- `@arethetypeswrong/cli` + `publint` green on every published package.
- `@pancreator/no-horizontal-primitive-deps` ESLint rule green.
- Cursor `.mdc` shim emitter round-trip (parse → emit → re-parse) is identity.

**Exit criterion.** All 9 build steps green; CI conformance gates green; one manual
`pan inbox` + `pan feature new` + `pan pause`/`pan resume`/`pan abort` smoke
works against an empty pipeline.


## Phase 4 — US-1 dogfood (bootstrap verification)  *(supervisor + delivery pipeline)*

Inputs: substrate from Phase 3 + personas from Phase 1 + contracts from Phase 2.
Outputs: a single staged PR with delivery report = the empirical proof Pancreator works.

- Compile and register the five PRD §11 pipeline YAML definitions under
  `lib/pipelines/`: `feature-delivery`, `chat-with-persona` (skeleton only),
  `knowledge-curation`, `init-greenfield`, `adopt`. M1 runtime scope covers
  `feature-delivery` execution; `chat-with-persona` runtime is backlog-deferred to M2.
- Drop a real semi-formal spec into `lib/inbox/in/`. Walk PRD §3.5 US-1 end-to-end:
  - `intake-analyst` runs the canonicalization dialogue to `/lib/memory/features/<id>/spec.md`.
  - `tech-lead` drafts `plan.md` + `adr-draft.md` + `touch-set.json` + per-feature
    `contract:` block.
  - `coder` implements; `reviewer` runs the `style:contracts` step + contracts-runner
    pass; `tech-writer` drafts `delivery-report.md`; `supervisor` stages PR (no
    auto-push per Q3); `librarian` indexes; checkpoints persist at every stage boundary.
  - Manually exercise `pan pause` mid-implement → `pan resume` → `pan abort` on a
    second run.
- Verify the run-log file renders cleanly in Phoenix or Langfuse (KPI A20 banked from
  day one — proves "we conform, not parallel-design" per PRD §5.5).

**Exit criterion** = PRD's `dogfood-us1` todo green: a staged PR + delivery report in
`lib/inbox/out/` + a clean run-log trace in an external observability tool.


## Phase 5 — Rest of M1 (self-hosted)  *(delivery pipeline)*

The Delivery Pipeline now implements its own remaining M1 deliverables. From this
point forward Pancreator is dogfooding itself; humans only act at the gates Q3 / risk
tiers / `pancreator.yaml` declare.

- Use `feature-delivery` to flesh out and harden:
  - `init-greenfield` and `adopt` pipelines on real targets (US-9 — pick a TS
    monorepo, a Python service, and a Next.js app per KPI A17).
  - `knowledge-curation` cron seed + Librarian's anti-rot loop.
- Optional but recommended: persist the 6 founding research reports (PRD §15) to
  `/lib/memory/research/` so future agents can cite them.
- Baseline KPIs A1–A18 + A22–A27 on the dogfood repo; record gaps in
  `/lib/memory/adr/0002-m1-baseline.md`.

**Exit criterion = M1 done.** PRD §11 MVP scope items closed; CI conformance suite
green; KPIs baselined; ready for M2 (US-2, US-3, US-6 basic, US-10 full spectrum).


## Cross-cutting conventions  *(every phase)*

- **Phase exit criteria are non-negotiable.** Mirrors the PRD's R-class circuit-breaker
  pattern; the bootstrap's correctness ratchet is its own contract.
- **Dual-anchor citations everywhere.** Every persona, contract, skill, and handbook
  page cites its sources as `{kind: 'symbol', path, symbol, contentHash}` (preferred)
  or `{kind: 'lines', path, range, contentHash}` (fallback). PRD §4 + §8.
- **Commit trailer:** `Bootstrap-Phase: <N>` on every commit so the bootstrap is
  replayable end-to-end and `pan re-adopt` can later rebuild the lineage.
- **Human is the in-loop reviewer at every phase boundary.** Cedar `Authorizer` MVP
  default = `LocalUserAuthorizer` (PRD §10). Ombudsperson is M5; until then, the
  human plays that role at the gates.
- **Goodhart guard.** Capture *what failed* at each verification, not just pass-rate.
  Phase 4's dogfood is the only gate that matters; Phases 1–3 merely make it possible.
- **Bootstrap-only affordances are tagged.** Anything pulled forward (e.g.,
  hand-authored meta-personas, manual phase boundaries before the runner exists) gets
  `metadata.bootstrap-only: <true|false>` in its YAML so it can be retired or
  formalized later without scavenger-hunt archaeology.


## Bootstrap-specific risks (R-class extension)

- **BR1 — Persona format drift between hand-authored meta-personas and Phase 1
  outputs.** *Mitigation:* the round-trip verification gate at the end of Phase 0c
  (persona-designer authors `tech-writer`, human ratifies) catches it before Phase 1
  multiplies the error 8×.
- **BR2 — Contract Writer authors its own gating contracts in Phase 2 with no
  Pancreator-native peer reviewer.** *Mitigation:* human review at the Phase 2
  boundary, focused specifically on the contract-spine packages
  (`@pancreator/contract*`); Phase 4 dogfood is the empirical ratification.
- **BR3 — Coder runs ahead of Contract Writer on a substrate package.** *Mitigation:*
  the Phase 2 → Phase 3 build order is non-negotiable; CI refuses to build a package
  whose feature folder is missing a `contracts/` subdirectory.
- **BR4 — Phase 3 hand-orchestration drifts from how the runner will eventually
  invoke Coder.** *Mitigation:* Phase 3 step 5 (`@pancreator/runner-cursor`) lands a
  CLI smoke test that re-runs the same prompts that drove Coder by hand, asserting
  byte-equivalent inputs/outputs. From step 5 onward, prefer Pancreator-native
  invocation; Phase 4 is the first fully pipeline-driven run.
- **BR5 — Phase 0b handbook seed contains errors that propagate through every
  subsequent artifact via dual-anchor citations.** *Mitigation:* the handbook seed
  files are explicitly marked `stability: experimental` with a Phase-5 review item to
  promote to `stable` once the dogfood validates them.
