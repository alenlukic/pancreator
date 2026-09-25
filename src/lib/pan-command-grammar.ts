const STANDALONE_MODE_NAMES =
  'author|best-of-n|build-briefs|build-docs|cleanup|conform|debloat|decomposition|' +
  'harden|pair|polish|qa-workflow|release|repair|research|' +
  'review|shepherd|spend|spotfix|style|supervisor|target|trace|tune-harness|' +
  'unbound|write-pr'

export const HELP_BODY = `Usage:
  pan help
  pan init --request <repo-relative-file> [--workflow planning|delivery|prototype|design] [--title <title>] [--workspace <dir> | --worktree <name>] [--gates <file>] [--involvement <profile>] [--verification <level>] [--with-design] [--operator-artifacts] [--context-reference <repo-relative-file>] [--json] [--no-autostart | --autostart [--max-parallel <n>]]
      The default workflow is planning, the entry point for delivery work. Approving its ratified plan routes the work: a plan of one chunk starts one delivery run (implement, verify, remediate, ship); a plan of two or more chunks opens a cohort session and starts cohort 1. --workflow delivery skips planning for an operator who brings a ratified specification as the request.
      --worktree binds the planning run to the named worktree. A routed single-chunk delivery run inherits that worktree, so plan-time work in it carries forward in place; without --worktree, that route derives and creates its own delivery worktree. A plan of two or more chunks derives one isolated worktree per cohort chunk from the committed head, and the route refuses while the planning worktree holds uncommitted work.
      --with-design composes design planning into a planning run and design review plus design QA into routed delivery runs. It is refused for workflows that do not declare design_composition.
      --no-autostart applies only to the planning workflow and stops the run at the ratified plan, so delivery is started by hand. --autostart names the default and is accepted for compatibility. --max-parallel caps the concurrent chunk runs of an autostarted cohort session (default 4).
      --context-reference records an audited pointer to wider context every stage reads and never copies, for example the parent specification of one cohort chunk.
  pan prepare <run-id> [--worktree <name>] [--operator-artifacts] [--agent <name>]
      A Cursor-executor stage defaults to the projected agent resolved from its persona, writes the labeled delegation artifact beside the delivery prompt, and starts the detached worker model probe. --agent overrides that resolved label. An external-executor or orchestrator stage writes no artifact at prepare and reports why. For an evidence-role agent, prepare returns that role's already allocated prompt and report paths before launch. For the stage agent, the harness writes the labeled delegation artifact and starts the detached model probe.
  pan delegate <run-id> [--timeout-ms <milliseconds>] [--headless] [--evidence-only [--role <evidence-worker-role>]]
      --headless dispatches a cursor-executor stage through the harness-owned cursor-agent path with the persona's mapped model, for a supervisor whose platform exposes no projected agent to launch. The stage's evidence workers run first, as in the headless driver. Without it a cursor persona is refused with EXECUTOR_UNSUPPORTED, because the supervisor delegates it per INVOCATION-001.
      --evidence-only runs the evidence workers (one --role, or all) through the same path and returns without delegating the stage, so a supervisor can run them as parallel processes.
  pan watch <run-id> [--invocation <invocation-id>] [--cadence-seconds <n> --cadence-directed-by-operator <reason>] [--stall-timeout-seconds <n> | --stall-wakes <n>] [--timeout-seconds <n>] [--mark-background] [--launched-at <iso-8601>] [--platform-returned-at <iso-8601>] [--platform-detached-at <iso-8601>] [--handle <platform-handle>] [--agent <name>] [--model <name>] [--agent-state running|completed] [--agent-state-evidence <path>] [--json]
      Await a launched worker for the watch's whole lifetime and record every arming and wake to agent/evidence/<invocation-id>-watch.jsonl. The watch loops on its cadence until a terminal verdict or the bound — exit 0 when the output is present, 2 on a stall, 3 at the timeout, 4 when the completion is unverified — so one foreground blocking call covers the wait. When the platform returns early before the watch ends, run \`pan watch --attach <ledger>\` to rejoin the session, passing the watch session record from runtime/logs. The default bound is one hour (3600 seconds); --timeout-seconds overrides it and the first arming line prints the resolved value. A timeout reports the exact command that re-arms the same bounded observation. The first arming writes the launch record agent/evidence/<invocation-id>-launch.json, which every launch-relative number the harness reports reads; --launched-at supplies the launch time you observed, and without it the arming time is recorded as the launch time. --platform-returned-at and --platform-detached-at record when the platform handed control back, and lateness is measured from that return rather than from the launch. --handle records the platform identity of the launched worker, which pan worker record otherwise asks you to record separately; an arming without one still succeeds and the launch record says none was supplied. --mark-background records that the platform turned the launch into a background subagent. The cadence is 60 seconds for every worker; a different cadence is refused unless --cadence-directed-by-operator records the operator's direction, which the ledger and the submission retain. --stall-wakes is the legacy count form of the stall bound: 1 is refused, and 2 or more converts to a duration against the resolved cadence. --agent-state reports what you saw when you inspected the launched agent itself; the watch reads files and cannot see a worker that is still writing. Weak evidence of completion — an output younger than one cadence, an unreadable elapsed time, an agent you reported as running, or a completed report without --agent-state-evidence — holds the observation and re-observes it on the next wake, and completes only when the output did not move. --agent-state-evidence names the recorded inspection (run, invocation, observed state, time, source, evidence reference) under runtime/logs that a completed basis rests on. Exit 4 means that confirming wake could not settle it.
  pan watch <run-id> --foreground-returned [--invocation <invocation-id>] [--launched-at <iso-8601>] [--json]
      Record that a foreground launch returned, with the launch and return wall-clock times, at agent/evidence/<invocation-id>-foreground-return.json. The launch time comes from the launch record; --launched-at writes that record when no watch armed first. pan submit requires this record, a completed watch record, or a watch record whose last wake observed the output being submitted with no pending completion hold, for every Cursor worker invocation, and fails with DELEGATION_UNOBSERVED otherwise. An attested elapsed time shorter than the watch record's own first-to-last wake span is labeled in the record, which names both numbers.
  pan watch --targets <run-id>:<invocation-id>[,<run-id>:<invocation-id>...] [--cadence-seconds <n> --cadence-directed-by-operator <reason>] [--stall-timeout-seconds <n> | --stall-wakes <n>] [--timeout-seconds <n>] [--mark-background] [--until-terminal] [--json]
      Multiplexed watch: arms and writes the ordinary per-invocation ledgers, then returns when the first target changes. Every target keeps the focused watch's guarantees: weak evidence of completion holds that target for one confirming wake, and a target unchanged for --stall-timeout-seconds (five minutes by default) ends the wait. Exit 0 when a target moved, 2 on a stall, 3 at the timeout, 4 when a scaffold could not be verified; the result names the targets that moved and the targets that need inspection. --until-terminal holds the wait through routine movement and returns only for the first completed, stalled, or unverifiable target or the bound, so routine progress costs no model round. Every return closes the other sessions with a recorded sibling handoff, and the next arming on each of those targets records the explicit gap rather than leaving it invisible. --mark-background marks every target in the group. --agent-state is refused here because it speaks for one inspected agent; re-arm the focused watch on that target instead.
  pan watch --process <pid> --label <name> [--output <path>] [--record <path>] [--cadence-seconds <n> --cadence-directed-by-operator <reason>] [--timeout-seconds <n>] [--json]
      Standalone process watch for waits outside a run: observes liveness by pid and start identity at the common cadence, records bounded metadata of the optional --output file, and blocks until the process exits, its identity changes, or the bound arrives. An observed exit is reported as an exit with an unknown status, never as a success; liveness that cannot be observed returns unverified, never completed. The record defaults under runtime/logs/watch/; a --record path must stay inside runtime/logs. The default bound is one hour (3600 seconds); --timeout-seconds overrides it. On timeout, exit 3 and a re-arm command prints.
  pan watch --attach <ledger>[,<ledger>...] [--cadence-seconds <n> --cadence-directed-by-operator <reason>] [--timeout-seconds <n>] [--json]
      Attach to one or more existing watch sessions by their ledger paths (within runtime/logs). Blocks until all named sessions reach a terminal state, the watcher process of a session exits without a terminal entry (orphaned, exit 5), or the bound arrives (exit 3, state attach_timed_out). When every session ends, the attach exits with the followed verdict's own code, and with the highest such code across several sessions. Returns immediately when all sessions are already terminal. A ledger that records no watch session is refused with WATCH_ATTACH_NO_SESSION. Appends nothing to the followed ledgers. The cadence is 60 seconds unless --cadence-directed-by-operator records the operator's direction. The default bound is one hour (3600 seconds).
  pan watch --timer --label <name> [--record <path>] [--cadence-seconds <n> --cadence-directed-by-operator <reason>] [--json]
      Arm exactly one common-cadence timer for an opaque platform handle with no machine-readable state, and return one wake that names the subject and the inspection you owe. It never satisfies delegation completion, so those waits may still need one model turn per observation.
  pan watch audit --roots-file <path> --from <iso-8601> --to <iso-8601> --output <path> [--json]
      Read-only historical audit over the roots the file lists: segments every watch ledger in the window into sessions, reports per-session cadence and authority, orphan and gap classification, sub-cadence spans, raw and effective coverage, submission links, missing clocks, and the actual collection cutoff. Writes only the report, which must stay inside runtime/logs; every unreadable input is named and a partial audit is never reported complete.
  pan worker record <run-id> --handle <platform-handle> [--invocation <invocation-id>] [--role <evidence-role>] [--agent <name>] [--model <name>] [--launch-mode foreground|background] [--new-attempt] [--json]
      An evidence role attaches the handle to its latest declared attempt when that attempt carries none, so recording after the report is written allocates nothing. Pass --new-attempt when you relaunched a worker whose first handle was never recorded; nothing on disk distinguishes that from a late handle. Any allocation warns and names the prepared card and its digest, and still exits 0.
      Record the identity the platform returned for one launched worker. The harness otherwise watches a worker only through the files it writes, so a worker that died before its first write is indistinguishable from one that was never launched.
  pan worker state <run-id> [--invocation <invocation-id>] [--role <evidence-role>] [--json]
      Report the last known state of every recorded worker: the handle, the launch time, how long ago that was, each declared path with its producer and its state on disk, and whether the worker has written anything at all. An evidence worker's brief is harness-written and never counts as the worker's own output, so a worker that wrote nothing reports that state rather than an error, and a path nobody has written is named rather than omitted.
  pan submit <run-id> <output-json> [--worktree <name>]
  pan assess <run-id> <assessment-json>
  pan decide <run-id> <approve|reject|revise> [--note <text> | --note-file <path>] [--stage <stage-slug>] [--worktree <name>] [--json]
      --worktree names an existing worktree the routed single-chunk delivery run occupies instead of the one the route would derive and create. The response reports the bound worktree path.
  pan pause <run-id> [--note <text> | --note-file <path>] [--actor operator|supervisor]
      --actor supervisor records that the supervisor, not the operator, is acting under the pause. The resume ratification then attributes the workspace delta to the agent that made it.
  pan attribute <run-id> --note <directive> [--role supervisor|operator] [--disposition read-only-input|commit-with-unit|operator-owned] [--paths <path[,path...]>]
      Record an operator directive executed against the workspace outside a stage. The record names the acting role, the directive, the disposition, the changed paths, and the time, and the next invocation card lists those paths as already attributed. Without --paths the harness attributes every dirty tracked path of the workspace. --disposition declares what may be committed: read-only-input is never committed and does not block a clean-tree gate, commit-with-unit belongs in the unit's own commit, and operator-owned is the default and still blocks. The attribution reaches every checkout of the repository.
  pan resume <run-id> [--worktree <name>] [--stage <stage-slug>] [--note <text> | --note-file <path>] [--json]
      pan init, pan decide, and pan resume answer with a JSON object whether or not --json is passed, so the option is accepted and names the shape they already emit.
  pan set-stage <run-id> --stage <stage-slug> (--note <reason> | --note-file <path>) [--abandon-workers]
      A return that would abandon a launched evidence worker with no report refuses with EVIDENCE_WORKERS_IN_FLIGHT and names the affected roles, because those reports would land against an invocation nothing reads. --abandon-workers returns anyway.
  pan waive-gate <run-id> (--note <directive> | --note-file <path>) [--stage <stage-slug>] [--to <stage-slug>] [--criteria <id[,id...]>] [--defer <AC-id[,AC-id...]> --spotfix] [--adopt-plan-from <run-id>]
      The result lists entry_gates_reached: the stage entry gates this directive now covers, so an honored waiver is distinguishable from one the entry gate never sees. A waiver that routes the run into a stage whose entry gate last failed and which the directive does not name is refused with WAIVER_ENTRY_GATE_UNREACHED.
      --adopt-plan-from records that this run adopts the named run's ratified plan. The named run's worktree claim moves to this run and both run states record the move, so release preparation proceeds with the subsumed run still live and no manual abort.
      Every argument the CLI passes through argv is refused at or above 900 bytes with ARGV_ELEMENT_TOO_LARGE, naming the option and the byte count, because endpoint security SIGKILLs a process whose argv element reaches 1000 bytes before Node starts. --note-file reads the note from a file, so a full decision packet reaches the record. decide, pause, resume, set-stage, and waive-gate all accept it.
  pan abort <run-id> [--note <text>]
  pan hypervisor start|run|tick|status|stop [--json]
  pan away status|evaluate|apply <run-id> [--decision <id>] [--action <action>] [--worktree <name>] [--json]
      evaluate returns apply_ready_decision_id and apply_command at the top level. apply accepts --worktree for a single-chunk plan route; without it, that route inherits the planning run's managed worktree when one exists. --action names the action the apply must take. It is honored when it matches the recorded recommendation and refused with AWAY_ACTION_REFUSED when it does not, so an apply never substitutes a different action. An option the subcommand does not accept is refused with UNKNOWN_OPTION rather than ignored.
  pan technologies detect [--worktree <name>] --json
  pan repository-check <profile> [--timeout-ms <milliseconds>] [--workspace <dir|worktree> | --worktree <name>] [--run <run-id>] [--role <evidence-worker-role>] [--force-repeat] [--json]
      --timeout-ms raises the effective bound only: resolution keeps the maximum of the request, the profile's own bound, and subset-profile timeouts.
      --run records the execution against that run and, without --workspace or --worktree, checks its workspace. Without --run, --worktree records against every live run bound to the worktree. A bare invocation records against no run.
      A clean pass recorded against a run, at a workspace fingerprint identical before and after, satisfies a later gate on the same command instead of running it again.
      A --run request that matches a recorded pass for the same invocation, worker role, profile, and fingerprint returns that pass instead of executing. --force-repeat executes anyway and records the repeat as deliberate.
      --role names the evidence-worker role running the profile, which its evidence brief supplies. Two evidence workers of one stage share an invocation id, so the role is what gives each its own recorded pass and log.
      --harness-initiated declares a harness-started execution, which suppresses streaming and spends no agent allowance. It is honored only when the process carries the launch token the harness hands the child it spawns, and a caller that passes it without that token is refused; only the release-profile prefetch passes both.
  pan repository-check validate [--json]
  pan conform scan|checkpoint [--since <ref> | --all] [--worktree <name>] [--json]
  pan style scan|checkpoint [--since <ref> | --all] [--worktree <name>] [--json]
      Select the workspace source a detected language owns that changed since the last checkpoint, and report the style handbook rules a scanner can decide. checkpoint inspects the complete eligible set, returns blocked without writing while an editable file still has issues, and writes runtime/cache/style.json once the set is clean. Both subcommands exit 1 on a non-passing status. npm run lint stays authoritative for mechanical style.
  pan tests impacted [--worktree <name>] [--changed <ref> | --staged | --worktree-dirty] [--file <path>]... [--include <glob>]... [--depth <n>] [--list] [--json] [--advisory-ratio <0..1>]
      Self-development only. Select and run the lane tests whose import closure reaches the changed files. The default change set is the dirty working tree. An iteration aid, never a gate.
      --worktree runs the command from the installation root and selects against that worktree's tree, the same workspace selection pan repository-check accepts. Without it the installation root is the workspace, as before. The run record stays at the installation root either way.
  pan tests benchmark --baseline-workspace <path> --candidate-workspace <path> --population-tolerance <count> [--profile <name>] [--output <path>] [--json]
      Capture both sides in one session record. A missing side, a changed workspace, a failed run, or a population difference above the declared tolerance refuses the comparison.
  pan tests wall [--json]
      Report the rolling 24-hour fast-lane wall average, permitted ceiling, marginal wall cost per test, and pass or fail verdict.
  pan release sync --worktree <name> --message <message> [--run <run-id>] [--onto <ref> | --no-rebase] [--json]
      Returns already_current without rebasing when the selected target is already an ancestor of the branch head. Otherwise sync rebases in Git's merge-preserving mode and refuses success with RELEASE_REBASE_TOPOLOGY_LOST when the result drops a merge commit the branch carried or no longer descends from the target; replayed commit hashes are expected to change. --onto <ref> rebases onto a ref the operator names; --no-rebase keeps the local history as it stands. Either choice is recorded in rebase_override on the result. Sync and finalize return RELEASE_LOCAL_DEFAULT_AHEAD in advisories when the local default branch is ahead of fetched main.
  pan release continue --worktree <name> [--run <run-id>] [--json]
      Returns not_needed with exit 0 when no rebase is active.
  pan release finalize --worktree <name> --fetched-main <commit> [--run <run-id>] [--allow-unclean <conform|style>]... [--json]
  pan release allocate --worktree <name> --bump <major|minor|patch> [--run <run-id>] [--json]
      Hand the worktree the next release version above every version published on its head, on pan-dev, on the local default branch, or already allocated, and record the allocation in runtime/release/allocations.jsonl before any release commit exists. Two worktrees allocating against the same base receive different versions, and a repeated request from a worktree whose allocation has not landed returns the same version. The ship validator accepts the allocated version in place of the exact next version for the same bump.
  pan author apply --input <draft-json> [--worktree <name>] [--json]
  pan author validate [--extension <id>] [--worktree <name>] [--json]
  pan tune prepare [--baseline <ref>] [--json]
      Self-development only. Create a tune session, inventory current tests, and resolve the retained set.
  pan tune finalize --session <id> [--json]
      Load validated session files, assemble the benchmark, then atomically write the tune record, report, and latest pointer.
  pan tune validate-audit --record <path> --baseline <ref> --target <ref> [--json]
      Verify a worked audit covers every net-new test identity in the baseline..target range.
  pan debloat scan [--days <1..365>] [--worktree <name>] [--transcripts <path>] [--json]
      Self-development only. Inventory the complete functional graph, run the independent orphan check, read every evidence file in the window, and write the operator report. Removes nothing.
  pan debloat adjudicate --session <id> --facility <id> --verdict <remove|keep> --reason <text> --evidence <reference>... [--json]
      Record the agentic verdict, reasoning, and evidence for one candidate the deterministic pass marked unclear. A verdict cannot clear a deterministic retention.
  pan debloat select --session <id> --facility <id>... [--replace] [--json]
      Add ids to the operator's chosen subset. --replace resets the recorded set. An unadjudicated unclear id and any id outside the candidate list are refused.
  pan debloat impact --session <id> [--json]
      Compute the functional-reference closure of the recorded selection. Writes paths to delete, references to repair, the freed paths and symbols with their stranding referrers, and every near-miss with the survivor that kept it.
  pan debloat verify --session <id> [--json]
      Confirm the workspace matches the closure after removal. Exits 1 while a listed path, freed entry, or reference to a removed facility survives.
  pan worktree create <name> [--from <branch|commit|worktree>] [--description <text>] [--json]
  pan worktree resolve <name> [--description <text>] [--json]
  pan worktree list [--json]
  pan worktree remove <name> [--force] [--delete-branch] [--json]
      --delete-branch deletes the worktree branch when it is an ancestor of the default branch, and reports a refusal when it is not.
  pan worktree reconcile (--into <worktree> | --into-branch <branch>) --source <worktree> --source <worktree> [--json]
  pan status <run-id> [--redline] [--occasion pan-start|pan-resume] [--resolve <citation>] [--json]
      --redline writes agent/evidence/platform-guidance-redline.json, the run's pre-declaration that platform guidance is non-authoritative.
      --resolve reads a citation of this run's artifacts — a path or a bare invocation id — through the run's invocation alias map and names the current path. Resequencing at finalization is what leaves a citation stale; the alias map is written then.
  pan list [--json]
  pan inbox [--json]
      List every regular file directly under each runtime/inbox/ lifecycle directory, in lifecycle order (queue, active, canceled, complete) and newest-first inside one status. Unreadable items remain visible with a reason.
  pan inbox restore <inbox-file>
      Return a canceled or active item to runtime/inbox/queue/. An active item's run is detached onto its own stored request copy first. A completed or already-queued item is refused.
  pan installs list [--json]
  pan installs archive <install-id> --intake <harness-relative-path> --item <install-relative-path> [--item <install-relative-path>] [--json]
      Archive only installation inbox items whose file names the source checkout's validated consolidated intake cites.
  pan archive [--days <positive-integer>] [--complete] [--canceled] [--json]
      Runtime maintenance can take time proportional to the durable runtime files and retained runs; each pass reports start and finish progress on stderr.
  pan cleanup [--days <positive-integer>] [--class <name>]... [--apply] [--json]
      Report the complete retention and housekeeping plan without changing state. --apply performs that plan, preserves live state and dirty worktrees, keeps every branch, and reports each removed worktree branch with its merged status.
  pan spend [--days <1..365>] [--json]
      Fetch personal usage from Cursor's dashboard session API, or team usage from Cursor's Admin API, and report aggregate token volume, cost, time series, command, persona and model, tool, Fast mode, governance, workflow role, stage, and remediation slices. Personal reports show aggregate model cost; team reports show charged cost. The default window is the last 14 days. CURSOR_SESSION_TOKEN or CURSOR_ADMIN_API_KEY must exist in the process environment or the installation/workspace .env file. The report never includes raw events, emails, or conversation identifiers.
  pan spend sync [--days <1..365>] [--json]
      Collect this instance's attributed Cursor usage, merge it into runtime/spend/ledger.json, and upload the ledger as this instance's snapshot to the Vercel service at spend.vercel_host. PAN_SPEND_SYNC_TOKEN must exist in the process environment or the installation/workspace .env file. Snapshots carry only hashed event and conversation keys.
  pan spend report [--days <1..365>] [--json]
      Download every instance's latest snapshot from the Vercel service, count each Cursor event once, and report the combined cost computation with a per-instance breakdown. Needs spend.vercel_host and PAN_SPEND_SYNC_TOKEN, and makes no Cursor request.
  pan models [--sync] [--force] [--probe] [--migrate-from <previous-config.json>] [--json]
  pan models evidence --run <run-id> --role supervisor --effective-model <model> --source <source> [--json]
  pan models evidence --run <run-id> --invocation <invocation-id> --role <worker|evidence-role> --effective-model <model> --source <source> --launch-handle <handle> [--json]
      Worker evidence accepts only the stage role \`worker\` and evidence-worker roles declared by that invocation. The declared model spec comes from the invocation snapshot.
  pan models --probe --run <run-id> --invocation <invocation-id> [--await-probe] [--json]
      Records an in-flight marker, starts a detached probe, and returns. --await-probe performs the live call in the foreground; the detached child passes it.
      --probe launches one minimal cursor-agent call per distinct active model spec and records what Cursor resolved and reports match, recorded, mismatch, or unavailable per spec. It never fails the command, so read the result and error fields. Needs the cursor-agent CLI and CURSOR_API_KEY (process environment, installation .env, or workspace-root .env) or a login. Run pan doctor to see which source resolves.
      --migrate-from preserves the previous effective model map across a tracked config.json replacement: every mapping the new file leaves empty is carried into config_overrides.json, and the replacement stops before mutation when a mapping stays empty that defaults does not fill.
      --force requires --sync. It projects the configured specs when the local Cursor model catalog is stale or incomplete. Grammar still applies. Live --probe still reports what Cursor resolves.
      A bare pan models and pan doctor are diagnostic, so they report cursor_model_catalog (presence, recorded captured_at, age, freshness, and every persona mapping the catalog cannot resolve) instead of failing at config load. Every lifecycle command still validates against the catalog.
  pan validate [--json]
  pan eval list [--json] | pan eval grade <run-id> --scenario <name> [--out <dir>] [--json] | pan eval run <scenario> [--attest-supervisor-card] [--pipeline-config <name>] [--json]
  pan doctor [--worktree <name>] [--json]
  pan requirements resolve --persona <p> --workflow <w> --stage <s> [--kind <kind>] [--output-path <path>] [--json]
  pan requirements run [--invocation <id-or-path> | --persona <p> --workflow <w> --stage <s> --kind <workflow|assessment|spotfix|investigation|repair|decomposition|documentation|standalone>] --registry <id> [--target <path>] [--run <run-id> | --worktree <name>] [--json]
      --invocation accepts an exact JSON snapshot path or, with --run, an invocation id from that run.
      --run or --worktree binds the check to that run's or worktree's workspace instead of the installation root.
  pan pr-description context [--worktree <name>] [--json]
  pan output scaffold <run-id> --invocation <path> --output <path> [--force]
  pan output validate (<run-id> | --run <run-id>) --file <path> --invocation <path> [--json]
  pan assessment scaffold <run-id> --invocation <path> --output <path> [--force]
  pan governance prompt-context
  pan governance audit-directives [--json]
  pan governance card --mode <${STANDALONE_MODE_NAMES}> [--extension <id>] [--request <path>] [--worktree <name>] [--out <path>] [--horizon <session-id>] [--base <ref> --target <ref> [--closure-revision <ref>]] [--dimensions <a,b,c>] [--json]
      --base (review mode) renders the base-revision text of every conduct policy the target changes, so the session reviews under the rule in force before the change.
      --dimensions (review mode) selects the review dimensions the squad runs, comma-separated. The default is the full lineup. An unknown name is refused with the accepted list, and the card records the selection and the default dimensions it leaves out.
  pan governance card --mode supervisor --run <run-id> [--json]
  pan governance attest-supervisor <run-id> --sha256 <digest> [--json]
  pan governance review-scope --target <ref> [--base <ref>] [--default-branch <branch>] [--closure-revision <ref>] [--json]
      closure_tracking is tracked or untracked. closure_revision is null when the target repository does not track the installation closure.
  pan best-of-n init --request <path> --configs <path> [--workflow <slug>] [--consolidation-workflow <slug>] [--operator-artifacts] [--json]
  pan best-of-n status <bon-id> [--json]
  pan best-of-n refresh-agents <bon-id> [--json]
  pan best-of-n abandon <bon-id> <run-id> --note <reason> [--json]
  pan best-of-n consolidate <bon-id> [--json]
  pan best-of-n clean <bon-id> [--force] [--json]
  pan best-of-n prune [--force] [--json]
  pan schedule list|status|tick|validate|install-agent|uninstall-agent [--json]
  pan schedule run <job-id> [--json]
      Evaluate configured calendar jobs, force one named job, inspect filesystem alerts, validate job references, or install and remove the opt-in macOS launchd trigger. Any platform can invoke 'pan schedule tick' from an external trigger.
  pan horizon init --queue <path> [--session <id>] [--involvement <profile>] [--worktree <name>] [--json]
  pan horizon add <session-id> --task <task-json> [--json]
  pan horizon start <session-id> --attest-supervisor-card [--headless] [--json]
  pan horizon next|status|reconcile|checkpoint|resume <session-id> [--json]
  pan horizon defer <session-id> --task <id> --reason <text> (--hard-block <LH-H1|LH-H2|LH-H3|LH-H4> | --operator-directive) [--evidence <path>]... [--json]
  pan horizon reinstate <session-id> --task <id> --action <resume|set-stage|decide|waive-gate|restart-task> --note <directive> --reason <text> [--stage <stage-slug>] [--decision <approve|reject|revise>] [--json]
  pan horizon abandon <session-id> --reason <text> [--json]
      The operator's chat session supervises a horizon session: start arms it and returns; next opens the eligible task and creates its run; the supervisor advances that run and every run its plan approval routes to (a delivery run, cohort chunk runs in parallel, the release run) with the ordinary lifecycle commands; status --json lists every live run with its bootstrap commands under live_runs, the cohort commands the route offers under route_commands, and next_command; reconcile applies the mechanical part after every wake (ladder, the one scoped re-plan, route tracking, cohort start or release, task completion) and returns the live runs and any route stop, and never writes a deferral. A task finishes when its route finishes, not when its planning run does.
      --headless drives the session in harness-owned driver processes instead, one per task, for a scheduled job with no chat open; only there does the session arbiter run. The harness never defers a task on its own verdict: the arbiter, or the supervisor with defer --hard-block, must name one of the four hard blocks (LH-H1 to LH-H4) in the long-horizon handbook; --operator-directive records the operator's own deferral. Each verdict is in runtime/logs/horizon/<session-id>/arbiter.jsonl, and every deferral carries its classification (hard_block, harness_unrecoverable, operator). Deferral blocks only transitive dependents and keeps unrelated tasks eligible.
      reinstate is the supervisor's override of a recorded deferral: it applies the action to the task's run (or reopens the task), frees its dependents, returns the session to running, and records the reasoning under the supervisor actor.
  pan cohort init --plan-run <run-id> [--from <branch>] [--max-parallel <n>] [--json]
      --max-parallel caps the concurrent chunk runs of the session (default 4).
  pan cohort start <cohort-id> [--cohort <index>] [--json]
      Create one worktree and one delivery-chunk run per unstarted chunk of the next unsatisfied cohort, up to the free parallelism slots. Run it again as chunk runs finish to start the deferred chunks. It performs no source-control action beyond adding worktrees.
      --cohort names a cohort explicitly; a cohort whose predecessor is unsatisfied is refused with COHORT_PREDECESSOR_UNSATISFIED.
  pan cohort status <cohort-id> [--json]
      Reports the active cohort, each chunk's run status, the free parallelism slots, and the start, supervise (/pan-cohort), integrate, and release commands that apply.
  pan cohort integrate <cohort-id> [--into-branch <branch>] [--json]
      The retry for an automatic advance that failed. The harness normally integrates a finished cohort by itself, as soon as its last chunk run reports succeeded.
      Commit each chunk worktree that still holds work, merge the chunk branches of the finished cohort into its integration branch (the base branch by default), and record the satisfaction entry the next cohort needs. Once that entry lands the harness continues the plan: a non-final cohort starts the next cohort, and the final cohort starts the release run, a delivery run that begins at verify on the integration branch. The response reports that continuation as autostart.
      --into-branch retargets the session: this and every later cohort merge into that branch, and later cohorts branch from it. Use it when the checkout that holds the base branch carries uncommitted work. A missing branch is created from the current integration head; an existing one must already contain that head.
  pan cohort release <cohort-id> [--json]
      Start or adopt the release run once every cohort is integrated (merge-free). It is the retry for a release start that failed after the final integrate: it merges nothing, adopts a release run that already exists, and is refused with COHORT_NOT_SATISFIED while any cohort lacks its merge proof.
  pan cohort abandon <cohort-id> --chunk <id> --note <reason> [--json]
  pan cohort clean <cohort-id> [--force] [--json]
      Remove the chunk worktrees and keep every branch. A live run or uncommitted work is refused unless --force. A chunk already recorded as abandoned is exempt from the uncommitted-work refusal alone, and the result names each worktree discarded that way; the run-active refusal still holds, because abandoning a chunk does not stop its agent.
  pan cohort route --plan-run <run-id> [--worktree <name>] [--json]
      Route the approved plan of a succeeded planning run into delivery again: one delivery run for a single chunk, cohort 1 of a cohort session for a wider plan. This is the retry for a route that failed at approval and the opt-in for a planning run that predates routing. It adopts the run or session an earlier attempt created and refuses a run that is not planning, not succeeded, or whose plan gate recorded a decision other than approve.
  pan context digest <repo-relative-file> [--json]
      Read-only. Print the content digest of a file on the basis every audited context reference states: sha256 of the text after leading and trailing whitespace is trimmed. A planner takes a child specification's parent digest from this command rather than computing it by hand.
  pan context card <run-id> [--invocation <id>] [--json]
      Read-only. Render one invocation card from its recorded snapshot, defaulting to the run's active invocation. It changes no run state, delegates nothing, and needs no supervisor attestation, so an evidence worker or a verifier may produce a card-shaped acceptance evidence artifact without a lifecycle command.
  pan briefs build [--force] [--json]
  pan briefs validate [--json]
  pan briefs render --input <brief-json> --output <brief-html> [--json]
  pan briefs generate --run <run-id> [--stage <stage-slug>] [--force] [--json]
  pan validation-map [--json]
  pan involvement [--json]
  pan verification [<run-id>] [--json]
  pan verification <run-id> set <level> [--note <text>] [--confirm]
      --confirm is required when the new level disables the evidence producer of a ratified acceptance criterion; the refusal lists every affected criterion.
  pan spotfix scaffold-escalation --input <path> --output <path>

Cursor's supervisor reads invocation cards, delegates cursor-executor stages to
named Cursor subagents, and returns structured output to this CLI. Stages whose
persona mapping carries an external executor prefix (claude-code:<model> or
openai:<model>) are delegated by the harness itself: 'pan delegate' runs the
executor with the canonical card and authors the delegation evidence.
`

export interface PanInvocationValidation {
  valid: boolean
  surface: string | null
  accepted_options: string[]
  unknown_option?: string
  error?: string
}

interface CommandSurface {
  tokens: string[]
  options: Set<string>
}

const OPTION_PATTERN = /--[a-z][a-z0-9-]*/gu

function surfaceVariants(segment: string): string[][] {
  const tokens = segment.trim().split(/\s+/u)
  let variants: string[][] = [[]]

  for (const token of tokens) {
    if (
      token.startsWith('--') ||
      token.startsWith('<') ||
      token.startsWith('[') ||
      token.startsWith('(')
    ) {
      break
    }

    if (/^[a-z0-9-]+(?:\|[a-z0-9-]+)+$/u.test(token)) {
      variants = variants.flatMap((variant) =>
        token.split('|').map((choice) => [...variant, choice]),
      )
      continue
    }

    variants = variants.map((variant) => [...variant, token])
  }

  return variants.filter((variant) => variant.length > 0)
}

const USAGE_LINE = /^ {2}pan (.+)$/u
const CONTINUATION_LINE = /^ {4,}\S/u

/**
 * Command surfaces and the options each one accepts, read from the usage text.
 *
 * A usage block is one `  pan …` line plus the indented prose beneath it, and
 * both halves declare options: `--harness-initiated` exists only in the prose.
 * Reading the line alone turned a documentation omission into a refusal of an
 * option the CLI does accept.
 */
function commandSurfaces(help: string): CommandSurface[] {
  const merged = new Map<string, CommandSurface>()
  let block: CommandSurface[] = []

  for (const line of help.split('\n')) {
    const usage = USAGE_LINE.exec(line)

    if (usage) {
      block = []

      for (const segment of (usage[1] as string).split(/\s+\|\s+pan\s+/u)) {
        const options = new Set(segment.match(OPTION_PATTERN) ?? [])

        for (const tokens of surfaceVariants(segment)) {
          const key = tokens.join(' ')
          const existing = merged.get(key)

          if (existing) {
            for (const option of options) {
              existing.options.add(option)
            }

            block.push(existing)
          } else {
            const surface = { tokens, options: new Set(options) }

            merged.set(key, surface)
            block.push(surface)
          }
        }
      }

      continue
    }

    if (block.length > 0 && CONTINUATION_LINE.test(line)) {
      for (const option of line.match(OPTION_PATTERN) ?? []) {
        for (const surface of block) {
          surface.options.add(option)
        }
      }

      continue
    }

    block = []
  }

  return [...merged.values()].sort(
    (left, right) => right.tokens.length - left.tokens.length,
  )
}

const COMMAND_SURFACES = commandSurfaces(HELP_BODY)

/** Every first token a documented command surface begins with. */
const COMMAND_FAMILIES = new Set(
  COMMAND_SURFACES.map((surface) => surface.tokens[0] as string),
)

/** The command families the CLI usage declares, for a reconciliation check. */
export function panCommandFamilies(): ReadonlySet<string> {
  return COMMAND_FAMILIES
}

function normalizedOption(argument: string): string | null {
  if (!argument.startsWith('--')) {
    return null
  }

  return argument.split('=', 1)[0] ?? null
}

/** Validate one `pan` argv against the options declared by the CLI usage. */
export function validatePanInvocation(
  argv: readonly string[],
): PanInvocationValidation {
  const matches = COMMAND_SURFACES.filter((candidate) =>
    candidate.tokens.every((token, index) => argv[index] === token),
  )

  if (matches.length === 0) {
    const command = argv.slice(0, 2).join(' ') || '(empty)'

    return {
      valid: false,
      surface: null,
      accepted_options: [],
      error: `Unknown pan command surface '${command}'.`,
    }
  }

  const longest = matches[0]?.tokens.length ?? 0
  const applicable = matches.filter(
    (candidate) => candidate.tokens.length === longest,
  )
  const accepted = new Set<string>(['--help'])

  for (const candidate of applicable) {
    for (const option of candidate.options) {
      accepted.add(option)
    }
  }

  const unknown = argv
    .map(normalizedOption)
    .find(
      (option): option is string => option !== null && !accepted.has(option),
    )
  const surface = applicable[0]?.tokens.join(' ') ?? null
  const acceptedOptions = [...accepted].sort()

  return unknown
    ? {
        valid: false,
        surface,
        accepted_options: acceptedOptions,
        unknown_option: unknown,
        error:
          `Unknown option '${unknown}' for 'pan ${surface}'. Accepted: ` +
          `${acceptedOptions.join(', ')}.`,
      }
    : { valid: true, surface, accepted_options: acceptedOptions }
}

/**
 * The refusal a `pan` invocation found in prose earns, or null when the text
 * is not an invocation this grammar can judge.
 *
 * Extraction reads running prose, so `./bin/pan with no execution-root
 * override set` arrives here looking exactly like a command. The head token
 * decides: a documented family means the author meant a command and a wrong
 * subcommand is a real defect, while any other word is English and refusing
 * it would reject the plan for describing the command in a sentence.
 */
export function panProseInvocationError(
  argv: readonly string[],
): string | null {
  const family = argv[0]

  if (family === undefined || !COMMAND_FAMILIES.has(family)) {
    return null
  }

  const validation = validatePanInvocation(argv)

  return validation.valid
    ? null
    : (validation.error ?? 'The command is not accepted by the CLI.')
}

const PAN_INVOCATION_PATTERN =
  /(?:^|[\s`'"(])(?:\.\/bin\/pan|pan)\s+([^\n`'";|)]+)/gmu

/** Extract simple `pan` command lines from plan prose and command fields. */
export function panInvocationsInText(text: string): string[][] {
  return [...text.matchAll(PAN_INVOCATION_PATTERN)].map((match) =>
    (match[1] as string)
      .trim()
      .split(/\s+/u)
      .map((token) => token.replace(/[,:.]$/u, ''))
      .filter((token) => token.length > 0),
  )
}
