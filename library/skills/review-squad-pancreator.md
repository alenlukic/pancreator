# Review squad (Pancreator)

Use when a squad review reads a change to the Pancreator harness itself, whether
it arrives from a shepherd review under `SHEPHERD-001` or a standalone
`/pan-review` session under `REVIEW-001`. `review-squad.md` supplies the method;
this file supplies the lineup.

This skill ships only in a Pancreator source checkout. `bin/install` drops it
from the staged payload, so a target installation never carries the file and
never resolves the swap described below.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

## Principle

The core lineup reads a product change: a feature, the layer it landed in, the
blast radius it opens. Pancreator ships something else. Its product is
governance text, projected agent prompts, workflow contracts, and the CLI that
executes them. A defect here is seldom a crash. It is a clause that contradicts
another clause, an instruction no agent can act on, or a cost that every run
afterward pays.

Three dimensions cover that surface. They are not the core five renamed. Each
reads the diff for a failure mode no core charter names.

## Activation and swap

- The lineup MUST swap to these three dimensions when the review target is the
  Pancreator repository, in a self-development checkout or a worktree of one.
  Any other target keeps the core lineup.
- These three dimensions take the place of the core lineup and its conditional
  frontend dimension for that review.
- Everything else in `review-squad.md` holds unchanged: capture the diff once,
  hold the same calibration bar, return the same finding shape, respect the same
  boundaries. Read that file first, then this one.
- The operator MAY name a core charter as well. A named charter runs beside
  these three rather than replacing one of them.
- The lineup carries no security charter by operator decision on 2026-08-28,
  while the harness is not in broader use. Name the core security charter for a
  review that needs it, and revisit the decision when the harness ships beyond
  this repository.
- State the swap in the review artifact and name the core dimensions it
  removed, so a reader knows which lenses produced the finding set and which
  were never applied.

## Lineup

| Dimension                 | Expected yield                       |
| ------------------------- | ------------------------------------ |
| correctness & consistency | few findings, mostly hard            |
| agentic practice          | many findings, mostly medium         |
| performance               | few findings, each carrying a number |

## Charters

Give the matching charter verbatim to each dimension agent.

### Correctness & consistency

Answer two questions about the change. Does it do what the card says it does?
And does the repository still agree with itself afterward? A contradiction
between two normative surfaces is a defect of the same class as wrong output,
because an agent resolves it by guessing.

- **Behavior against stated intent.** Take each acceptance criterion, or each
  claim in the intent brief when the target carries no criteria, and name the
  code path that satisfies it and the input that defeats it. A claim satisfied
  only on the happy path is not satisfied.
- **Contradicted directive.** A clause added or changed here that a clause
  elsewhere already forbids or already requires differently. Quote both, with
  both paths. Search `governance/policies/`, `library/personas/`,
  `library/skills/`, `library/workflows/`, and the operating cards.
- **Card asymmetry.** Pancreator carries four operating surfaces: `AGENTS.md`,
  `library/templates/embedded-AGENTS.md`,
  `library/cursor/rules/pancreator-self-development.mdc`, and
  `library/cursor/rules/pancreator-embedded.mdc`. A rule that belongs to all
  modes and landed in one of them is a finding. So is a rule that belongs to one
  mode and leaked into another.
- **Canonical source without its projection.** A change under `library/cursor/`
  or to a projected policy that ships without the regenerated `.cursor/` output,
  or a projection manifest entry whose source or target moved.
- **Mirrored implementation drift.** The installer restates renderers the
  compiled library also owns, and `src/lib/governance-card.ts` restates policy
  prose. A change to one copy that skips the other is a finding, and the
  registered disposition names which copies are in the set.
- **Registry and reference integrity.** A policy with no lookup row or a lookup
  row with no policy, a `guidance_sources` path or `start_heading` that does not
  resolve, a required file added to validation that the payload never ships, a
  disposition whose sources no longer exist.
- **Harness-relative path handling.** A path an embedded install must reach
  through `.pancreator/` that the change emits bare, or a CLI argument that
  wrongly carries the prefix.
- **Half-applied change.** One call site of several updated, one mode of three
  covered, a rename left partly done.
- **State integrity.** A unit of work that writes run state and an artifact
  without a retry path that reconstructs both, a logged-and-continued failure
  that hides missing state from the retry machinery, or a read-decide-write
  sequence with nothing serializing it.
- **Instruction-text conformance.** A durable operator artifact, or an
  agent-facing instruction, that breaks a writing rule `STE-001` names: a
  sentence past the length bound, a semicolon carrying two instructions, a
  directive keyword used loosely. This dimension owns that duty by operator
  decision on 2026-08-28. Quote the rule and the sentence.
- **Coverage shape.** A new rejection path with no test that asserts the
  rejection. Also the inverse defect: a test that pins prose bytes of a policy or
  persona, which fails on any legitimate rewording and teaches the next author to
  edit the test instead of thinking.

Method: read the whole diff and build a model of the intent before judging any
hunk. For every normative sentence the change adds or edits, search the
repository for the subject of that sentence and confirm nothing already says the
opposite. For every mirrored surface the change touches, confirm each copy
moved. Verify against the surrounding code, not against memory of it.

### Agentic practice

Judge the change as harness design. The question is whether an agent reading
this repository afterward can execute it, verify it, and fail loudly when it
cannot. This is not a correctness pass and not a prose review.

- **Instruction an agent cannot execute.** A directive with no observable action,
  no input it names, or no artifact it produces. Every added MUST needs an actor,
  a trigger, and something a reader can check afterward.
- **Prose where a check belongs.** Behavior that must not go wrong, stated in a
  paragraph and enforced nowhere. Push it down: prose, then persona, then policy,
  then validator, then CLI. Name the layer it should have landed in.
- **Judgment asked of the wrong layer.** Normative behavior belongs in policy
  JSON, role judgment in personas, task procedure in stage prompts and skills. A
  charter that tells an agent what to conclude, rather than where to look and
  what would settle it, is misplaced judgment.
- **Model work a command already answers.** A step that asks an agent to derive
  something `./bin/pan` computes deterministically. The harness should spend the
  model on judgment and nothing else.
- **Delegation shape.** Fan-out issued across several messages instead of one,
  nesting that exceeds the platform's limit, a subagent given authority its role
  does not need, `disallowedTools` that no longer matches the persona's stated
  boundary, or a model override on an ad-hoc call that should inherit.
- **Output contract gaps.** A declared output with no schema or validator, a
  worker that can report success with no evidence, or a gate that accepts an
  assertion in place of a captured artifact.
- **Failure and resumption.** A step that cannot be re-run after an interruption
  without duplicating work or corrupting state, a loop with no bound, a wait with
  no quiescence condition, or a path where an agent can stall with nothing
  written for the operator to act on.
- **Context discipline.** A prompt that carries a whole file where a path and a
  heading would do, a reference chain that expands without a bound, or text
  copied across surfaces that one reference would serve. Duplication that is
  deliberate belongs in `governance/registries/context_bloat_dispositions.json`
  with its rationale.
- **Operator surface.** A new failure mode with no operator-facing message that
  names the next action, or a decision the harness takes silently that the
  operator owns.

Method: for each instruction the change adds or edits, ask who executes it, with
which tools, on which input, producing which artifact, and how it reports
failure. A missing answer is the finding. Prefer the repair that moves the rule
one layer down, and say which layer.

### Performance

Read the change for what it costs on the critical path of a run and of the test
suite. Every finding carries a number: measured, or estimated with the
arithmetic shown. A cost with no number is not a finding here.

- **Work the run already did.** A check, suite, probe, or build executed again
  against an unchanged workspace fingerprint. Name the earlier execution that
  already holds the evidence.
- **Rebuild on dispatch.** A compile or code-generation step gating a command
  whose inputs have not changed since the last one.
- **Fixture cost per test.** Setup that copies trees, syncs projections, or
  initializes a repository once per test where one template per suite run plus a
  cheap clone would serve. Multiply the per-test cost by the test count and put
  that product in the finding.
- **Replay where a state assertion suffices.** An end-to-end lifecycle run
  asserting one routing decision that a state-transition test could assert in
  milliseconds. Keep the few replays that genuinely cover the lifecycle and say
  which ones those are.
- **Whole-repository work for a scoped question.** Validation, audit, or scan
  over everything to surface one diagnostic, repeated per case, where one shared
  baseline plus scoped checks answers the same thing.
- **Large or repeated reads and writes.** A whole-file read where a bounded read
  works, a registry re-parsed per call instead of loaded once, an artifact
  rewritten per iteration where one write at the end would do.
- **Context bloat on the critical path.** Prompt or card text that grows on every
  run without adding a decision. Count the tokens or the bytes.
- **Serial work that is independent.** Checks or subagents run one after another
  with no data dependency between them.
- **Unbounded fan-out.** Jobs, requests, or subagents dispatched at once with no
  batching, throttle, or backpressure.
- **Lock and gate scope.** A lock held across a whole run that guards one step,
  or a gate whose scope is the full profile where the change can only affect part
  of it.

Method: for each loop, gate, fixture, and read, ask what it costs now and what it
costs at a hundred times the current input. Prefer a measurement to an estimate
and name the command that would produce it. Rank by absolute cost removed from
the critical path, and separate one-time cost from cost paid every run. No
suite-duration ceiling is in force. Judge a suite-cost change by its delta
against the base revision, not against a fixed bound. Cost that sits off the
critical path is a note.

## Joining

The coordinator ranks the joined set with these tie-breaks:

- A contradiction between two normative surfaces and a wrong-behavior defect both
  block. Rank the contradiction first when an agent would have to guess to
  proceed.
- An agentic-practice finding blocks when it lets a run finish wrong or
  unrecoverable without saying so. Otherwise it is a note with a named repair
  layer.
- A performance finding blocks when it regresses a stated ceiling or adds
  duplicate execution to the critical path. Other cost findings are follow-ups
  with their numbers recorded.

Record the swap and the core dimensions it removed. Then record the three
dimensions and any core charter the operator named, each with its findings or
with an explicit empty result.
