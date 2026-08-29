## Objective

Build the spike fast enough to be worth building, and make its signals
observable. Speed is the point; completeness is not.

A prototype is judged on whether it answers the question, not on whether it is
production-ready. Take the shortcuts the approach declared, and record them.

## Steps

1. Read the prototype brief, the technical approach, the card, and the
   target-repository primer. Read the pre-implementation static baseline before
   editing so you can tell a pre-existing diagnostic from one you introduced.
2. Read the verified preconditions from the latest successful approach output.
   Recheck every volatile included precondition immediately before source edits.
3. When a volatile precondition becomes unavailable, stop before edits, report
   `blocked`, and leave `changed_files` empty.
4. Implement the approach along its declared strategy. Reach for the shortest
   credible mechanism; do not build abstractions the spike will not exercise.
5. Take the declared shortcuts freely. Stub, fake, hard-code, and skip error
   paths where the approach said you could — and write each one down as you go.
   An undeclared shortcut is the one failure mode that matters here.
6. Add tests only where they keep the spike's own signals honest. Production
   coverage for core functionality and edge cases is not expected at this stage;
   do not claim coverage you have not written.
7. Produce the observable signals. Run whatever demonstrates them and capture
   the actual result, including results that came out negative. A negative
   signal is a successful prototype outcome, not a failure to hide.
8. Never delete, skip, or weaken an existing test or check to make the spike
   pass. If an existing check genuinely blocks the approach, stop and report it
   as a blocker.
9. Repair any new static or type diagnostic you introduced. Report a
   pre-existing one rather than fixing it, unless the repair is trivial.
10. If this is a retry, read the prior output and the evaluation feedback and
    directly address what caused it. Do not resubmit unchanged work.

## Output

Populate `data.spike` (`changed_files`, `shortcuts_taken`, `signal_evidence`,
`notes`, `precondition_checks`). Every entry in `shortcuts_taken` needs what
you did and why it was acceptable for the spike. Every entry in
`signal_evidence` needs the signal, what you ran or observed, and the actual
result. Per `PROTO-001`, every `precondition_checks` entry MUST name
`precondition_id`, `status`, and `evidence`. When `output.operator_brief`
exists, edit its declared source
and reference the rendered HTML. Do not run the renderer. When the contract
omits `output.operator_brief`, do not create either brief file.

## Done when

Each declared signal has real evidence, every shortcut is written down, volatile
preconditions were rechecked before edits, no existing check was weakened,
configured static checks pass or report only pre-existing failures, and nothing
is claimed that the spike does not do.
