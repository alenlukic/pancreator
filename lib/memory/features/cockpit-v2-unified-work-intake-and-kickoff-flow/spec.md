---
title: Cockpit v2 unified Work Intake and kickoff flow Engineering Spec
feature_id: cockpit-v2-unified-work-intake-and-kickoff-flow
task_id: 25237_1659_cockpit-v2-unified-work-intake-and-kickoff-flow
program: cockpit-v2
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
design_steps: true
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-work-intake-kickoff.md
depends_on:
  - cockpit-v2-shell-theme-foundation
  - cockpit-v2-ux-philosophy-information-architecture-and-user-stories
parallel_with:
  - cockpit-v2-command-center-operational-state-surface
  - cockpit-v2-feature-delivery-mission-control-run-detail
  - cockpit-v2-automations-shell-history
next_owner: tech-lead
next_stage: plan
ux_spec: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the source directive defines six required outcomes, four acceptance checks, explicit out-of-scope boundaries, a touch set, and ratified ux-spec §4.3 plus kickoff-flow-inputs contract authority without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates stepper stages, minimum source types, model presets, launch and save CTAs, pan run integration, URL metadata handling, and machine-checkable acceptance criteria.
  - Route `/work-intake` currently renders `CockpitSurfacePlaceholder` with `isKickoffStub`; this Feature replaces that stub with the full kickoff stepper under `client/src/components/cockpit/kickoff/`.
  - `GET /api/inbox` and `loadInboxEntries` already list inbox markdown; kickoff SHALL reuse that service for the inbox source picker and `inboxRunCommand` for launch command preview.
  - `POST /api/execute` allowlists only advance, pause, resume, abort, check, and batch status verbs; launch SHALL route through a dedicated kickoff API that invokes `startFeatureDelivery` server-side rather than widening the execute allowlist.
  - Global shell header **Start feature delivery** CTA per ux-spec layout §53 is not yet mounted in `(cockpit)/layout.tsx`; this Feature SHALL add header wiring alongside kickoff route integration.
  - Contract `cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.kickoff-flow-inputs` is the blocking llm-judge gate at threshold 0.75.
references:
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-work-intake-kickoff.md
    range: [37, 39]
    note: Source directive Problem section states copy/paste and terminal pan run friction for starting feature-delivery.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-work-intake-kickoff.md
    range: [41, 43]
    note: Source directive Goal binds ux-spec §4.3, kickoff-flow-inputs contract, shell header CTA, and kickoff route.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-work-intake-kickoff.md
    range: [45, 52]
    note: Source directive Required outcomes enumerate stepper, sources, model presets, CTAs, launch integration, and URL handling.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-work-intake-kickoff.md
    range: [54, 59]
    note: Source directive Acceptance criteria anchor kickoff-flow-inputs contract, source coverage, launch CTA, and tests.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-work-intake-kickoff.md
    range: [61, 65]
    note: Source directive Out of scope excludes backlog browse UX, sandbox target selection, and mission control display.
  - kind: lines
    path: lib/inbox/in/172966_06-09-26/63490_0621_cockpit-v2-work-intake-kickoff.md
    range: [71, 77]
    note: Source directive Touch set lists kickoff components, inbox API, new kickoff routes, layout header wiring, and client tests.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [53, 53]
    note: Ratified layout requires global header accent Start feature delivery CTA linking to kickoff.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [127, 129]
    note: Ratified ux-spec Work Intake / Kickoff §4.3 stepper, presets, CTAs, and optional interactive intake.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [269, 307]
    note: Blocking llm-judge contract kickoff-flow-inputs rubric and threshold 0.75.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-philosophy-information-architecture-and-user-stories/ux-spec.md
    range: [163, 165]
    note: Shared drawer and banner motion tokens at most 200ms ease-out with prefers-reduced-motion honor.
  - kind: lines
    path: client/src/app/api/inbox/route.ts
    range: [1, 6]
    note: Existing GET /api/inbox listing API for inbox source picker.
  - kind: lines
    path: client/src/services/inbox.ts
    range: [71, 88]
    note: loadInboxEntries walks lib/inbox/in markdown and excludes notes paths.
  - kind: lines
    path: client/src/services/run-state-shared.ts
    range: [762, 767]
    note: inboxRunCommand builds pan run feature-delivery command from repo-relative inbox path.
  - kind: lines
    path: client/src/app/(cockpit)/work-intake/page.tsx
    range: [1, 8]
    note: Current kickoff route renders placeholder stub to replace.
  - kind: lines
    path: client/src/components/cockpit/layout/surface-config.ts
    range: [42, 49]
    note: Ten-surface shell registers Work Intake at route /work-intake as first-slice surface.
  - kind: lines
    path: client/src/services/pan-execute.ts
    range: [11, 18]
    note: Execute API verb allowlist excludes run; kickoff launch needs dedicated server route.
  - kind: lines
    path: lib/memory/features/build-mode-inbox-scaffolding/spec.md
    range: [102, 121]
    note: Prior art for pan intake new and from-build-plan directive scaffolding that Save inbox directive MAY reuse.
---

# Spec

This Feature SHALL deliver the Cockpit v2 Work Intake / Kickoff surface at route
`/work-intake` so operators start feature-delivery without copy/paste or a
terminal `pan run` invocation. The Feature SHALL implement ux-spec §4.3 and
contract
`cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.kickoff-flow-inputs`,
mount inside the ten-surface shell from `cockpit-v2-shell-theme-foundation`,
wire the global header **Start feature delivery** CTA to the kickoff route,
and invoke `pnpm -w exec pan run feature-delivery` through a dedicated server
API that records inbox source metadata on the created run.

## Acceptance criteria

### Stepper flow and surface mount

- When the operator navigates to `/work-intake`, the surface SHALL render a
  four-step stepper in this order: **Choose source**, **Preview directive**,
  **Configure models**, and **Review and launch**.
- When the operator completes a prior step with valid input, the stepper SHALL
  enable forward navigation to the next step and SHALL preserve entered state
  when the operator moves backward.
- When `(cockpit)/work-intake/page.tsx` mounts, the page SHALL render
  `KickoffSurface` from `client/src/components/cockpit/kickoff/` and SHALL NOT
  render `CockpitSurfacePlaceholder` with `isKickoffStub`.

### Source selection

- When the operator selects **Inbox item** as the source, the kickoff flow SHALL
  list entries from `GET /api/inbox` sorted by the existing `loadInboxEntries`
  contract and SHALL let the operator pick one inbox markdown file.
- When the operator selects **Raw URL** as the source, the kickoff flow SHALL
  accept one HTTP or HTTPS URL, SHALL fetch or summarize page context through a
  kickoff API route, and SHALL store the original URL in directive frontmatter
  or equivalent source metadata on the working draft.
- When the operator selects **Raw text** as the source, the kickoff flow SHALL
  accept freeform markdown in a text area and SHALL seed the directive preview
  from that input.
- When the operator selects **Feature backlog** before
  `cockpit-v2-feature-backlog-ux` ships, the kickoff flow SHALL render a guided
  empty state that names the deferred backlog browse UX and SHALL offer inbox,
  URL, or raw text as alternate sources.
- When the operator selects **Interactive intake**, the kickoff flow SHALL
  expose an optional branch that MAY deep-link to Agent Chat and SHALL NOT
  require chat to reach **Review and launch**.

### Directive preview and save

- When the operator reaches **Preview directive**, the kickoff flow SHALL show
  an editable markdown preview of the inbox directive body including frontmatter
  fields required by `pan run feature-delivery`.
- When the operator edits the preview, subsequent steps SHALL use the edited
  content as the launch payload.
- When the operator activates secondary CTA **Save inbox directive**, the
  kickoff flow SHALL persist the preview to `lib/inbox/in/<day-bucket>/` using
  the same UTC bucket and SID_HHMM_slug naming contract as `pan intake new`
  without starting a feature-delivery run.
- When **Save inbox directive** succeeds, the kickoff flow SHALL show a success
  toast with the repo-relative saved path and SHALL keep the operator on the
  kickoff surface.

### Model configuration

- When the operator reaches **Configure models**, the kickoff flow SHALL offer
  three presets labeled **Cheap / fast**, **Balanced**, and **High quality**.
- When the operator selects a preset, the kickoff flow SHALL display the
  resolved model mapping on the **Review and launch** step.
- When the operator expands advanced model settings, the kickoff flow MAY let
  the operator override models per pipeline persona; overrides SHALL appear on
  the review summary without mutating persona markdown files.

### Review, launch, and run linkage

- When the operator reaches **Review and launch**, the surface SHALL show one
  accent primary CTA labeled **Launch feature delivery** and one secondary CTA
  labeled **Save inbox directive**.
- When the operator activates **Launch feature delivery**, the client SHALL
  POST to a dedicated kickoff launch API route that invokes
  `startFeatureDelivery` server-side with the prepared inbox-relative path or
  a freshly saved directive path.
- When launch succeeds, the API response SHALL include `taskId`, `featureId`,
  `runDir`, and `handoffFile` fields matching the existing feature-delivery
  JSON envelope.
- When the launch source was an existing inbox item, the created run state SHALL
  record `source.inboxPath` pointing at that inbox file so Mission Control and
  run-state consumers can link back to the source directive.
- When launch fails, the kickoff flow SHALL render an inline error with a
  **Retry launch** action and SHALL NOT navigate away from the review step.

### Shell header and cross-surface entry

- When the ten-surface shell renders any first-slice route, the global header
  SHALL display one accent **Start feature delivery** link targeting
  `/work-intake` per ux-spec layout requirements.
- When Command Center empty state or Mission Control empty state links
  **Start feature delivery**, those links SHALL continue targeting
  `/work-intake` after kickoff ships.

### Shared states and accessibility

- When kickoff data is loading, the surface SHALL render skeleton placeholders
  within 400 ms and SHALL set `aria-busy="true"` on the active step panel.
- When a step lacks required input, forward navigation and **Launch feature
  delivery** SHALL stay disabled with a reason exposed to assistive technology.
- When the operator uses keyboard navigation, the stepper, source picker, preview
  editor, and CTAs SHALL remain operable per ux-spec accessibility minimums.

### Design contract and tests

- When design review runs contract
  `cockpit-v2-ux-philosophy-information-architecture-and-user-stories.ux.kickoff-flow-inputs`,
  the llm-judge panel SHALL score at least 0.75.
- When `pnpm --filter client test` executes, kickoff component tests and kickoff
  API route tests under `client/src/components/cockpit/kickoff/` and
  `client/src/app/api/` SHALL cover the happy path for inbox, URL, and raw text
  sources through editable preview to successful launch response mocking.

## Out of scope

- Full Feature Backlog browse UX with search, filters, and detail drawer; the
  `cockpit-v2-feature-backlog-ux` inbox item owns that surface per source
  directive.
- Sandbox target selection beyond a stub empty state; advanced sandbox comparison
  and scoped run targeting belong to `cockpit-v2-sandbox-manager-advanced` per
  source directive.
- FD Mission Control display of a newly launched run; post-launch navigation
  MAY deep-link to `/mission-control` but full run-detail UX belongs to
  `cockpit-v2-fd-mission-control` per source directive.
- Full Agent Chat persona console; interactive intake MAY deep-link only until
  ux-spec §4.7 ships.
- Widening `POST /api/execute` to allowlist the `run` verb; launch integration
  SHALL use dedicated kickoff API routes instead.
- Mutating `lib/personas/*.md` model fields from kickoff UI; presets apply at
  run invocation time only.

## Open questions

_(none — directive, ratified ux-spec §4.3, kickoff-flow-inputs contract, and existing inbox and pan run prior art supply sufficient scope for plan-stage delegation)_
