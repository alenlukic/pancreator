# Review squad

Use when a shepherd review under `SHEPHERD-001` must cover several review
dimensions at once.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

## Principle

One reviewer reading a whole diff carries every review lens at once and drops
some of them. A squad splits the lenses. The reviewer stays the coordinator: it
delegates one narrow charter per dimension, then joins the returned findings into
one ranked set.

The squad changes only how findings are gathered. The coordinator still owns
the verdict, the remediation boundary, and routing.

## Lineup

Core dimensions run on every squad review:

| Dimension      | Expected yield                      |
| -------------- | ----------------------------------- |
| correctness    | few findings, mostly hard           |
| security       | few findings, mostly hard           |
| architecture   | many findings, mostly medium        |
| simplification | many findings, mostly medium or low |
| operations     | few findings, sometimes hard        |

Conditional dimensions run only when the diff touches their surface. Each charter
below states its activation rule. A conditional dimension the operator names runs
whether or not its rule matches.

| Dimension | Runs when                                                |
| --------- | -------------------------------------------------------- |
| frontend  | the diff touches UI source or generated API client types |

## Process

1. Capture the review target once to a scratch file under the run's runtime
   directory. Every dimension agent reads that same captured diff.
2. Read the card, the plan, the acceptance criteria, and the implementation
   record. Write a short intent brief: what the change does, why, and which
   follow-ups the plan defers.
3. Resolve the lineup. State which conditional dimensions activated and which
   ones the diff skipped.
4. Delegate one subagent per dimension in the lineup, in one message, so they run
   at the same time. Each prompt MUST carry the captured diff path, the intent
   brief, the dimension charter text, and the finding shape. These dimension
   agents are nested spawns, so Cursor runs them on its default model by
   platform behavior — that is accepted for charter-scoped finding work — and
   they sit at the nesting limit: a dimension agent MUST NOT spawn further
   subagents.
5. When a subagent cannot start, apply that charter yourself before you join the
   results. Do not drop a dimension from a stated lineup without saying so.
6. Join the findings. Merge duplicates, drop what the intent brief already
   answers, then rank.
7. Judge the ranked set as the coordinator: repair what falls inside your
   remediation boundary, amend any acceptance criterion the findings prove
   unworkable as written, and route the rest. Criterion amendment belongs to
   the coordinator, never to a dimension agent.

### Repeat reviews

A repeat review on the same run covers the delta, not the whole change again.
Anchor on the prior review artifact, then review what changed after it.
Mark each prior finding as resolved, unresolved, or worse than before. When the
delta rewrites most of the change, review the whole change again and say why.

## Calibration

Every dimension agent and the coordinator MUST hold this bar:

- Verify a finding against the surrounding code before you report it. An
  unverified finding carries low confidence and MUST NOT be raised above it.
- Give a concrete alternative, not an objection. Name the existing helper, the
  rewrite, or the query.
- Put a number on cost where one exists. A counted cost lands, and "this is
  complex" does not.
- Stay proportional. Debt the change only touches is a note. A risk the declared
  scope already absorbs is not a finding.
- Keep severity legible as blocking or not blocking.

## Finding shape

Each dimension agent returns raw findings in this shape and nothing else:

```yaml
label: <dimension>
confidence: high|medium|low
location: <file:line>
problem: <the concrete defect>
why: <the failure scenario or the concrete maintenance cost>
fix: <the specific change, actionable without a follow-up question>
```

A dimension with nothing to report returns "no findings". The coordinator maps
the joined set onto `data.review.findings` and records each dropped finding with
its reason.

## Charters

Give the matching charter verbatim to each dimension agent.

### Correctness

Find defects that produce wrong behavior under some input, state, failure, or
retry. This is not a style, taste, or speed review. Hold a high bar: few
findings, each one verified.

- **Divergent multi-store writes.** One unit of work writes two stores. Ask
  whether a retry after the first write reconstructs the same state.
- **Swallowed errors in retryable work.** A logged-and-continued failure hides
  missing state from the retry machinery.
- **Asymmetric edge cases.** List the input shapes the code claims to handle,
  then check each one. Empty, absent, zero, negative, and reset paths diverge
  most often.
- **Contract drift across paired files.** A caller changed without its schema, a
  model changed without its generated types, a schema changed without its
  migration.
- **Half-applied changes.** One call site of several updated, or a rename left
  partly done.
- **Check-then-write races.** A read, then a decision, then a write, with no
  transaction or lock across them.
- **Missing negative coverage.** A rejection or denial path with no test that
  asserts the rejection.

Method: read the whole diff first and build a model of the intent. For each hunk,
ask which input or failure makes it wrong, and follow that into the surrounding
code. Trace the failure-then-retry path for anything that writes more than one
store.

### Security

Find vulnerabilities, authorization gaps, data exposure, and blast radius the
change introduces. This is not a correctness or speed review. Findings here are
rare and almost always blocking.

- **Missing or wrong authorization.** A new entry point with no explicit
  authorization dependency. Read the actual decorators and middleware rather than
  assuming a check upstream.
- **Unscoped permissions.** A permission object built once and reused on a path
  where access depends on the caller.
- **Auth that cannot name a user.** A service-to-service path that reaches
  per-user resources without carrying the acting user.
- **Secrets in shared artifacts.** Credentials, internal hostnames, or revealing
  comments inside published images, public repositories, or build output.
- **Leaky errors.** Raw exception text, statements, or parameters returned to a
  caller.
- **Logged sensitive content.** User input, prompts, document text, model output,
  or tool arguments written to logs. Metadata only.
- **Injection.** Unchecked interpolation into a query, a shell command, or a file
  path.
- **Tenancy.** A query or cache key with no customer or tenant scope.
- **Infra blast radius.** A job an untrusted event can trigger against
  infrastructure, or a permission set broader than the task needs.

Proportionality governs this dimension. Do not report a risk the declared threat
model already absorbs. Local development tooling carries a relaxed bar, where the
correct finding is to record the scope rather than to harden the code. "An
attacker who already controls the backend could do this" is not a finding.

Method: map the trust boundaries the change adds. For each path from input to a
sensitive sink, name what the attacker controls and which check stands in the
way.

### Architecture

Enforce the layering and structural conventions of the target repository. Read
them from the target's `AGENTS.md` and its applicable handbooks. This is not a
bug, speed, or taste review.

- **Logic in a wiring layer.** Branching, storage access, or business rules
  inside a router, an entry point, or a data model. Behavior belongs to the
  service or repository that owns it.
- **Optional dependencies.** A parameter typed as optional with a default of
  none, then used on the main path or guarded by a skip. The repair updates every
  call site to pass it. Gate the mutation, not the dependency.
- **Hidden import cycles.** A deferred import, a type-checking-only import, or a
  quoted forward reference added to dodge a cycle. The repair restructures the
  modules.
- **Data shaping outside the query.** A merge, sort, filter, or pagination in
  application code that one query could do. Sketch the query in the fix.
- **Kitchen-sink modules.** A new utility or helper file of unrelated functions.
  Each function belongs to the type that owns its data.
- **Sibling coupling.** Two entry points that depend on each other instead of on
  one shared service.
- **Reflection where explicit code works.** Annotation-driven dispatch or heavy
  type inspection that couples the code to library internals.
- **Leaked mechanism.** Internal configuration state exported when the consumer
  needs one derived flag.
- **Test structure.** A test of a private method, a test of wiring, a fresh mock
  where a shared fake exists, or a test that asserts every field.

Method: for each new function and type, ask which layer owns it and whether it
landed there. Check the call sites behind each optional parameter. Confirm a
violation against the surrounding code, and lower the priority when the pattern
predates the change.

### Simplification

Find code in the change that should not exist. This is the highest-volume
dimension, so keep each finding cheap to act on and honest about priority.

- **This already exists.** A new helper, constant, fake, or type that duplicates
  something in the repository or in a dependency already present. Search before
  you accept a new utility.
- **Machinery with no current need.** A cache with no measured volume, a
  configuration knob with no reader, an unused flag, speculative generality.
- **Defensive code for excluded states.** A guard for a state the caller already
  rules out. When the state is truly reachable, the repair belongs upstream.
- **Hunks outside the goal.** A rename, comment churn, whitespace noise, or a
  drive-by refactor that no acceptance criterion needs. Record it as a follow-up.
- **Test bloat.** Assert-everything tests, tests of configuration, and files that
  should split per module.
- **Docs that lie.** A comment describing behavior that no longer exists, or
  instructions that do not work as written.
- **Low-priority sweep.** A name whose meaning does not match its value domain, a
  dense expression that deserves a named constant, or a non-obvious branch with
  no explanation. Report these as low.

Method: read the acceptance criteria first, then measure every hunk against them.
Search the repository for an equivalent before you call anything new. Count the
cost where you can. Mess the change only touches is a note.

### Operations

Find what the change does at volume, on failure, to the schema over time, and to
whoever carries the page. This is not a style or business-logic review. Think in
numbers.

- **Capacity against limits.** A concurrency, batch, or memory setting that does
  not fit the deployed resource limits. Read the deployment configuration.
- **Unbounded fan-out.** Many jobs, requests, or messages dispatched at once with
  no batching, throttle, or backpressure.
- **High-volume data in the wrong store.** Large or high-cardinality payloads in
  a relational table, or stored with no retention path. Estimate rows per day.
- **Missing infrastructure half.** A new queue with no worker, a new setting with
  no deployment wiring, a new service with no monitor.
- **Generated artifact drift.** This dimension owns it. A schema or interface
  change whose generated artifacts are stale or absent from the diff.
- **Schema safety.** A merge migration where re-pointing the parent revision
  works, or an index that ships without the query that needs it.
- **Schema shape.** A whole serialized object in one column, a string reference
  where a foreign key belongs, a missing uniqueness key on a natural identity, or
  an ambiguous nullable boolean.
- **Observability hygiene.** A logger other than the repository's own, or error
  level on a state that is expected.
- **Alerting and log volume.** Failure alerting through bespoke plumbing rather
  than the metrics pipeline, or per-item logging inside a hot loop.

Method: for every knob, queue, loop, and table, ask what the count is now and
what breaks at one hundred times that count. Put that number in the finding, and
read the real limits rather than assuming them. When you cannot confirm a
capacity concern, say which number would settle it.

### Frontend

Activation: the diff touches UI source, stylesheets, or generated API client
types.

Review how the change uses the UI framework, the type layer, and the design
system. This is not a second correctness or simplification pass. A logic defect
that happens to live in a UI file belongs to correctness.

- **Generated types are the contract.** No hand-written enum, response shape, or
  parallel type that will drift from the interface it mirrors. A changed backend
  model brings its regenerated types in the same change.
- **The library already does it.** Check the framework and the installed
  dependencies before you accept hand-rolled UI mechanics. Read the canonical
  example of the API before you approve a workaround.
- **Render-path hygiene.** State or effects recomputed with no need, an effect
  doing the work of derived state, or an unstable identity feeding a list. Report
  one only with a scenario where it visibly misbehaves or measurably costs.

Method: read each changed component in full rather than only its hunks. Confirm a
type exists in the generated output before you tell the author to use it. Name
the exact API for a "the library already does it" finding.

## Boundaries

- A dimension agent MUST NOT edit any file. It returns findings only.
- Bounded remediation belongs to the coordinator, and it MUST be disclosed in
  the review artifact.
- Do not report a style preference. Every finding needs a failure scenario or a
  counted maintenance cost.
- A dimension that returns nothing MUST appear in the review artifact as empty
  rather than absent.
- Raise anything that touches credentials, data loss, or an authorization bypass
  to the top of the ranking.
