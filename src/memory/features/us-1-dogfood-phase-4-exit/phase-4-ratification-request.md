# Phase 4 Exit Ratification Request

## Purpose

Request explicit human ratification after every proof-bundle checklist item in
`phase-4-proof-bundle.md` moves from pending to populated (or is explicitly
deferred per that file’s **Residual gaps** section).

## Evidence attachments for reviewer

Human reviewer SHALL attach or cite paths for:

1. Nested proof-bundle-index task ledger and preserved `run.log.jsonl` (canonical
   paths after `tess close-artifacts` live under
   `src/internal/work_archive/<day>/<nested-task-id>/`; the **librarian** SHALL
   have refreshed `phase-4-proof-bundle.md` — not the human operator).
2. `phoenix-trace-evidence.md` — when the run-logger → Phoenix path exists, expect
   a real screenshot or export row; until then the **Deferred** rows there are
   an engineering backlog signal, not missing operator work.
3. `pause-resume-abort-evidence.json` — this file is **not** produced by the
   intake ratification inbox item
   `src/inbox/archive/in/172988_05-18-26/71096_0415_phase-4-intervention-probe-pause-resume-abort/2026-05-18T04-16-00Z-intake-phase-4-intervention-probe-pause-resume-abort-ratification.md`.
   That inbox item only approves the canonical **spec** after intake and supplies
   the `tess advance … --artifact …/spec.md` gate to move task `71096_0415_…` to
   **plan**. Intervention evidence is produced during the nested
   `feature-delivery` run for `phase-4-intervention-probe.md` (CLI pause / resume /
   abort plus implement-stage population of `pause-resume-abort-evidence.json`).
4. Supervisor-local staged PR outcome for the dogfood slice (no remote push).
5. `src/memory/features/us-1-dogfood-phase-4-exit/delivery-report.md` and, when
   the parent US-1 run has progressed through **ship** / **index**, a matching
   `src/inbox/out/<timestamp>-us-1-dogfood-phase-4-exit-delivery-report.md`. The
   handoff card lists the outbox path as in-scope for the whole run, but
   **`tess advance` never requires that file for the report stage** — only
   `delivery-report.md` under `src/memory/features/…/` is the report artifact
   (see `next-prompt.md` for task `20004_1826_us-1-dogfood-phase-4-exit`). Outbox
   copy is a **supervisor / librarian** convention tied to the PRD notifier-to-outbox
   story; it is not missing because you failed to remediate something.

## What you do for item 3 (intervention evidence) — human operator

**You do not** run
`src/inbox/archive/in/172988_05-18-26/71096_0415_phase-4-intervention-probe-pause-resume-abort/2026-05-18T04-16-00Z-intake-phase-4-intervention-probe-pause-resume-abort-ratification.md`
to satisfy item 3. That inbox item only ever meant: read the spec, then run the
`pnpm -w exec tess advance … --artifact …/spec.md` command printed there so the
nested task leaves **intake** and enters **plan**. It does **not** create
`pause-resume-abort-evidence.json`.

**Your job for item 3 when you are ready to ratify Phase 4 exit:**

1. Open `src/memory/features/us-1-dogfood-phase-4-exit/pause-resume-abort-evidence.json`.
2. Confirm it already contains pause, resume, and abort records (timestamps,
   stage ids, run-log event ids, and snapshot paths). If it does, item 3 is
   satisfied for you — you only **acknowledge** that in the **Decision record**
   table below (one sentence in the Notes cell is enough).
3. If the file is missing or empty, **do not** try to fix it by hand. **Block**
   ratification in the Decision record and route the nested intervention run back
   through the pipeline (agents + `tess` stages) until that JSON is populated.

There is **no** separate “human run this command to generate evidence” step for
item 3 beyond reading the file and recording pass/fail in the decision table.

## What you do for item 5 (delivery report + outbox) — human operator

**No agent missed a `tess` instruction.** The report-stage contract is only:
author `src/memory/features/us-1-dogfood-phase-4-exit/delivery-report.md` and
advance with `--artifact` pointing at that path. Nothing in the CLI enforces
writing `src/inbox/out/…-us-1-dogfood-phase-4-exit-delivery-report.md` at report
advance.

**Your job for item 5:**

1. **Until the parent run finishes report:** you do nothing for the outbox line
   — the file should not exist yet. Finish the pipeline: delegate **tech-writer**
   on `next-prompt.md`, ratify `delivery-report.md`, run the printed `tess advance`
   to move into **ship**.
2. **For the outbox copy:** expect **supervisor** (ship) and/or **librarian**
   (index) to add `src/inbox/out/<timestamp>-us-1-dogfood-phase-4-exit-delivery-report.md`
   because the handoff lists it as in-scope for the run — that is agent work, not
   a manual copy by you. If the run reaches **complete** and the outbox file is
   still missing, **block** ratification and send the run back to **supervisor /
   librarian** with “outbox delivery-report missing per handoff,” not “operator
   forgot to paste a file.”
3. **At ratification time:** confirm both paths exist (or document deferral if
   you explicitly accept ship-only for this bootstrap slice) and note that in the
   decision table.

## Decision record

| Outcome | Notes |
| --- | --- |
| Ratified Phase 4 exit | 1. src/internal/work_archive/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/run.log.jsonl ; 2. Item 2 deferred per bootstrap; no Phoenix importer; engineering backlog remains - src/memory/features/us-1-dogfood-phase-4-exit/phoenix-trace-evidence.md ; 3. Item 3 pass — pause, resume, abort captured - src/memory/features/us-1-dogfood-phase-4-exit/pause-resume-abort-evidence.json ; 4. src/internal/work_archive/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/policy-compliance.json ; 5. src/inbox/out/2026-05-19T02-26-26Z-us-1-dogfood-phase-4-exit-delivery-report.md + src/memory/features/us-1-dogfood-phase-4-exit/delivery-report.md |

Post-ratification updates to `tesseract.yaml`, `AGENTS.md`, `docs/M1.index.md`, and
`src/memory/active/current.md` remain gated until humans approve per parent feature spec.
