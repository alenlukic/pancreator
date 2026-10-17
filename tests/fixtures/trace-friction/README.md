# Baseline comparison replays

`baseline.tap` and `current.tap` are synthetic Node TAP transcripts authored for
TRACE-13. They are not excerpts of the historical twelve failures. The cited
`runtime/logs/shell/20261014T104643Z-node-32760b64/output.log` was unavailable
when implementation began; its original paired assertions have not been read.
Q-08 remains deferred.

The comparison ignores recognized TAP indices, plans, progress, heartbeat
counters, duration/type metadata, and final runner summaries. TAP location
metadata retains the normalized source filename; only its line and column
are ignored. A TAP failure retains its case name and complete assertion/error body. Repeated
numbered records use the runner's occurrence number to distinguish a rendering
echo from another occurrence; a final `# failing tests:` section is a rendering
of the main failures. Unnumbered occurrences outside that section remain counted.
Occurrence numbers are scoped to each TAP document, suite instance, and captured
stream. Identical failures from independent executions remain separate occurrences.

Generated execution-head JSON fields are normalized only as standalone metadata
fields outside assertion bodies. Assertion expected/actual values, including
hashes, timestamps, durations, source locations, and metadata-looking nested
objects, retain their substance and nesting. Unknown and incomplete output is
retained conservatively. Existing scratch path and source-location normalization
remains supported outside literal expected/actual fields and error block scalars.
Literal blocks, including error scalars, retain blank lines, trailing spaces, and whitespace-only lines
after removing the TAP transport indentation. Known-failure credit and lane
selection read the headline only; the attached body remains diagnostic evidence.
Recognized impacted-run heartbeat, selection, elapsed summary, and generated log
references are metadata. Unrecognized output alongside pytest failures remains
diagnostic evidence rather than requiring a recognized error keyword.
TAP product failures cannot be classified as infrastructure merely because
their assertion bodies quote collection errors, timeouts, or worker crashes.

An embedded `...` line in an error, expected, or actual scalar remains literal
assertion content, including trailing spaces and subsequent lines. Only a marker
at the immediate TAP diagnostic indentation closes the assertion. Missing
structural closing markers retain the incomplete-assertion diagnostic.
