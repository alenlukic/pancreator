---
feature-id: json-formatting
thread-id: json-formatting
round: 2
status: closed
kind: operator-ratification
supersedes-partial: lib/memory/features/json-formatting/spec.md
pipeline-task-id: 67055_0522_json-formatting
source:
  kind: lines
  path: lib/inbox/in/json_formatting.md
  range: [1, 3]
  contentHash: ebfc73c552f1feeeda24951ad0808b63f47e07956e36e4119862bd6c076a7955
operator-note: |
  Ledger repaired to intake after operator found the ratified spec narrowed scope
  to .json files only. This round records the authoritative scope correction.
---

# Operator scope correction — round 2 — `json-formatting`

The human operator ratifies the following corrections. The intake-analyst SHALL
fold this round into `lib/memory/features/json-formatting/spec.md` and treat
plan, ADR, touch-set, implementation, review, and delivery-report artifacts from
the prior narrowed-scope pass as **superseded** until plan re-runs against the
revised spec.

## Why this round exists

The informal directive at `lib/inbox/in/json_formatting.md` line 1 requires
pretty-formatted JSON for **all JSON that agents or scripts write**, including
output files, terminal/CLI, and the agent chat window. The canonical spec at
`lib/memory/features/json-formatting/spec.md` incorrectly limited enforcement
to in-scope `.json` files and deferred terminal/chat rendering (spec out-of-scope
lines 89–91). That narrowing was **not** operator intent.

Round-1 answer **Q3** (“every JSON file produced/maintained…”) was misapplied as
the sole scope boundary. Q3 answered which **files** participate in bulk
migration and compliance scanning; it did **not** revoke line 1’s requirement
that **any JSON surface** agents emit MUST use the canonical pretty-print shape.

## Ratified requirements (authoritative)

### R1 — Surfaces in scope

The Feature SHALL require canonical JSON formatting on **every surface** where an
agent or automated script emits JSON, including:

1. **Repository `.json` artifacts** (existing acceptance criteria remain, with
   exclusions for `node_modules/`, vendored paths, and tooling-regenerated
   files unchanged).
2. **JSON embedded in Markdown and other non-`.json` artifacts** — including
   dual-anchor citations in delivery reports, persona examples, handbook
   prose, inbox threads, and work-stage markdown when those citations are JSON
   objects.
3. **Terminal/CLI output** when an agent or script prints JSON to the operator.
4. **Agent chat window output** when an agent prints JSON in a response.

### R2 — Canonical shape (not “valid JSON” alone)

“Pretty-formatted” means the output MUST match the repository canonical printer
in `lib/internal/tools/migrate-json-formatting.mjs` (`formatCanonicalJson`):

- `indent=2`
- One object key-value pair per line
- Pretty-printer default array layout (inline short primitive arrays allowed;
  object arrays multiline per existing migration tests)
- **Not** JavaScript object-literal syntax (single-quoted keys, unquoted keys)
- **Not** compact single-line JSON blobs used as a substitute for pretty-print
  when the emitted value is a JSON object with multiple keys

For **inline** dual-anchor citations in Markdown prose, the object MUST still
serialize with indent 2 and one key per line. Acceptable forms are:

- A fenced `json` code block containing the full pretty-printed object, or
- A backtick-wrapped multiline pretty-printed object when the renderer preserves
  newlines

Compact `{"kind":"lines",...}` single-line blobs in prose are **out of policy**
after this correction.

### R3 — Hash abbreviation on all JSON surfaces

Any JSON field carrying a git commit hash or SHA-256 `contentHash` (including
dual-anchor citations in markdown) MUST use the abbreviated prefix whose length
equals `git rev-parse --short HEAD` at write time, on **all** surfaces in R1 —
not only inside `.json` files.

Placeholder values such as `TBD-on-commit` in citation JSON are **not**
acceptable in ratified stage artifacts.

### R4 — Enforcement

- Compliance under `tests/compliance/` remains the primary automated gate.
- The compliance descriptor and tests SHALL be extended (or supplemented) so
  violations on non-`.json` agent-output surfaces are detectable where
  practical (for example: lint persona/delivery-report examples, or a dedicated
  prose-json conformance check). Pre-commit hooks and Cursor rules remain out of
  scope.
- The bulk migration script remains responsible for `.json` files; separate
  migration or remediation steps for markdown-embedded JSON MAY be planned in
  touch-set when non-file surfaces require one-shot cleanup.

### R5 — What stays deferred

- Citation-verifier **prefix comparison** implementation remains a companion
  downstream feature (unchanged from spec deferrals).
- External/third-party JSON, `node_modules/`, and tooling-regenerated lockfiles
  remain excluded.

### R6 — What the intake-analyst MUST change in `spec.md`

1. Remove or rewrite acceptance criteria that apply pretty-print **only** to
   “in-scope JSON files” without covering R1 surfaces 2–4.
2. Remove out-of-scope bullet that defers terminal/CLI and agent-chat-window
   formatting (spec lines 89–91).
3. Add acceptance criteria for markdown-embedded dual-anchor citations and
   chat/terminal JSON matching R2–R3.
4. Add an explicit **Superseded work** note: artifacts under
   `work/172983_05-23-26/67055_0522_json-formatting/` from plan through
   report reflect the pre-correction spec and MUST be replanned after spec
   ratification.
5. Set `## Open questions` to unresolved items only; if enforcement mechanics
   for chat/terminal need one clarifying question, ask at most one.

## Operator answers (no further rounds required unless intake finds a blocker)

| Topic | Answer |
|---|---|
| Inline vs fenced citations in Markdown | Pretty-print is mandatory; prefer fenced `json` blocks for citations in delivery reports and long-form artifacts. |
| Round-1 Q3 scope | File inventory for migration/compliance only; does not limit R1 surfaces. |
| Prior delivery report | Superseded; tech-writer re-runs after implement/review pass on corrected spec. |
| `repair-state` reason | Confirmed: operator-directed return to intake for spec correction only. |

## Intake-analyst next action

1. Read this file, `lib/inbox/in/json_formatting.md`, and the current
   `lib/memory/features/json-formatting/spec.md`.
2. Overwrite `spec.md` per R6.
3. Post no new clarifying round unless a genuine blocker remains; operator
   considers this round ratified.
4. Leave `pnpm -w exec pan advance 67055_0522_json-formatting --artifact lib/memory/features/json-formatting/spec.md` to the human operator after spec review.
