# Scope custody

The scope gate compares the isolated workspace against its invocation baseline.
Workspace delta, absorbed path ownership, and permitted release metadata retain
their existing rules. The same controller attribution logic runs for verification
and release preparation.

## Evidence

Copilot launches resolve `stageWriteRoots` independently of read access and
`--add-dir`. Enforcement and validation share the lightweight executor custody
module; validation does not import the workflow executor engine.
The relay wraps the actual child with `resolveWriteSandbox`. Its
live record stores the granted write roots, all effective roots (including
agent state exceptions), enforcement mode, and the reason enforcement is
unavailable. The final delegation tool policy retains these fields and links to
the live record. These optional additions preserve older record readers.

Each launch binds the run, invocation, role, attempt, executor, relay PID and
start identity, and child PID and start identity. Resume attempts have separate
records. Attribution requires custody for the stage and each declared evidence
worker, including every recorded failed or resumed launch, rather than trusting
the last successful process alone. Write boundaries cannot
change during a launch; observations are append only.

Preparation freezes the invocation's scope identity and evidence roles under
`runtime/custody/<run>/<invocation>/`. It first writes the same identity to
the protected sibling `<invocation>.prepared.json`, so a missing inventory
directory cannot turn a current invocation into a legacy invocation.
The controller relay registers every
launch there before starting its child, and updates its own authoritative
boundary, process, terminal, and observation snapshot. The inventory includes
failed launches and resumes. Public live records remain compatible observation
copies; they are not the authority. Validation enumerates the protected
inventory, checks public copies against it, and retains authoritative denied
attempts even if a child replaces or removes the public record.

On macOS, worker sandboxes explicitly deny writes to the custody tree, including
through symlinks, and deny unlinking or renaming its ancestors. These exclusions
override the runtime grant and temporary/state exceptions. Disabling task write
enforcement still applies the custody exclusion; the task boundary remains
`none`, with its explicit reason, and cannot establish foreign attribution.
The same exclusion applies to Cursor CLI children sharing the installation.
Unsupported hosts or an unavailable sandbox cannot establish independent custody.
Invocations prepared before the protected inventory existed retain the clean
workspace fallback described below. An existing protected directory, preparation
record, or public launch prevents that fallback when its protected identity is
missing. Damaged current authority fails even without source changes. Existing
public records are never promoted to trusted snapshots. Older protected
inventories without the sibling record still undergo all inventory checks.

Relay cleanup sends SIGKILL to the child process group once, including
descendants that retain its pipes. After successful termination, later cleanup
does not signal the dead group again. Signal errors still surface as failures.

The invocation persona must match the effective persona that preparation selects
from trusted run history and the workflow's verdict mapping. A severe remediation
verdict can select its authorized remediator; an arbitrary persona or a mapped
persona without the selecting verdict cannot establish custody.

Tool completion events retain successful file writes and denied write attempts
with their event source. A shell denial without a resolvable path is an
unresolved attempt. Read failures are not write evidence. Tool events provide
positive observations, never proof that no other write occurred.

## Decisions

A controller snapshot is an observation, not an actor identity. It includes
untracked edits and committed changes since the baseline. An unchanged isolated
workspace does not by itself prove that a controller edit belongs elsewhere.

A controller path is foreign only when every launch has complete, matching
custody and a recorded enforced boundary that excludes that path. Effective
agent state exceptions count as writable: a controller inside one is not
excluded. Actual or denied own writes outside stage authority fail even when
the same path also has a foreign observation. Existing path resolution checks
the real existing ancestor, so nonexistent leaves and symlinks cannot escape
the granted roots.

Missing, malformed, mismatched, interrupted, or truncated evidence cannot prove
foreign ownership. Wrong attempt or invalid evidence fails the scope gate.
Unavailable enforcement reports its reason. A potentially relevant controller
delta then fails with **unverified attribution**, the missing evidence, and a
collection remedy, rather than assigning it to the worker or silently passing.
Independent actor evidence is not inferred from a commit author or a worker's
declaration.

Older invocations without custody retain a conservative fallback: controller
changes are unverified. No observed controller delta leaves the existing
workspace decision intact, with an explicit custody advisory. Collect complete
launch identities and rerun with enforcement to settle attribution. If the host
cannot enforce the boundary, an independent collector must establish every actor
before foreign ownership can be accepted; this gate does not invent such proof.

The boundary does not alter source authority, release landing, stream ordering,
heartbeat timing, or watch behavior. Other executors without these live records
use the explicit conservative fallback.
