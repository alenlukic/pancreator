---
title: Cockpit v2 Maintenance toolkit (compliance and tests) UX Spec
feature_id: cockpit-v2-maintenance-toolkit-compliance-tests
task_id: 27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests
program: cockpit-v2
stage: plan
owner: design-engineer
status: draft
design_steps: true
depends_on: [cockpit-v2-pipeline-command-center-and-human-gate-queue, cockpit-v2-ux-spec-and-information-architecture]
references:
  - kind: lines
    path: lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/spec.md
    range: [116, 200]
    note: Engineering acceptance for compliance panel, test runner, OutputStream, pre-close preset, and shell replacement.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [44, 82]
    note: Ratified Cockpit v2 shell, Maintenance module wireframe, and shared affordances.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [96, 120]
    note: Design tokens, typography, and copy-command patterns.
  - kind: lines
    path: lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/ux-spec.md
    range: [142, 183]
    note: Maintenance module summary and component inventory baseline.
  - kind: lines
    path: lib/memory/handbook/compliance-runs.md
    range: [31, 51]
    note: Descriptor trigger modes and operator-on-demand authority.
  - kind: lines
    path: OPERATION.md
    range: [505, 526]
    note: Pre-close validation checklist labels for preset bundle rows.
  - kind: lines
    path: lib/memory/features/compliance-tests/audit-history.json
    range: [1, 16]
    note: Prior audit context ledger linked from compliance results.
  - kind: lines
    path: client/src/components/cockpit/layout/CockpitShell.tsx
    range: [82, 86]
    note: Maintenance placeholder this feature replaces with MaintenanceModule.
  - kind: lines
    path: tests/compliance/high-remediation-blocking.yaml
    range: [1, 6]
    note: Descriptor id, severity, and trigger_modes fields for audit table columns.
---

# Cockpit v2 Maintenance toolkit (compliance and tests) UX Spec

## Overview

This feature ships the Maintenance module so operators run compliance audits, repository test suites, and index-adjacent pre-close validation from Cockpit instead of pasting terminal output into chat. `MaintenanceModule` replaces the shell placeholder with a compliance audit panel, a test-suite picker with live streamed logs, and session-scoped run history. A shared `OutputStream` component renders monospace subprocess output for both panels. The Pipeline module gains a pre-close validation control for tasks in `ship` or `index` that runs three sequential bundles and presents a checklist aligned with `OPERATION.md`. Shell layout, tokens, and shared affordances inherit from the ratified Cockpit v2 UX spec.

## Layout and navigation

- **Shell authority** — `CockpitShell` renders `MaintenanceModule` when the Maintenance tab is active; the dashed “Coming in a later Cockpit v2 item” placeholder is removed.
- **Maintenance body (≥1024px)** — two-column body: left (2fr) compliance audit panel; right (1fr) test suite picker and session run history. Below 1024px: compliance → test picker → history → output stream stacked full width.
- **Output stream placement** — `OutputStream` spans the full module width below the two-column region; both compliance and test panels route live and completed logs into this viewer.
- **Pre-close (Pipeline only)** — `PreCloseValidationPanel` mounts inside `PipelineModule` beneath the Next Action panel for the selected run. It does not appear on the Maintenance tab. Failures link to Maintenance with the relevant bundle pre-selected in session history when possible.
- **Out of scope in this layout** — scheduled compliance cadence, CI triggers, token economy UI, Automations changes, and full OPERATION.md checklist beyond the three preset bundles.

```
┌──────────────────────────────────────────────────────────┐
│ [Pipeline] [Automations] [Maintenance*]        Files ›   │
├─────────────────────────┬────────────────────────────────┤
│ Compliance audit        │ Test suite picker              │
│ · descriptor table      │ · client / compliance /        │
│ · run all · run one     │   repo-structure / pan-check   │
│ · results + findings    │ · session run history          │
├─────────────────────────┴────────────────────────────────┤
│ OutputStream — monospace log · exit code · copy          │
└──────────────────────────────────────────────────────────┘

Pipeline (selected task in ship or index):
┌──────────────────────────────────────────────────────────┐
│ Next Action panel (unchanged)                            │
│ Pre-close validation — Run preset · checklist · link     │
└──────────────────────────────────────────────────────────┘
```

**Breakpoints:** inherit parent Cockpit v2 rules (≥1024px two-column; 768–1023px stacked; <768px horizontal scroll on descriptor table and history list).

## Visual design tokens

Reuse Cockpit v2 tokens from `client/src/app/globals.css` (`--surface-primary`, `--surface-elevated`, `--surface-attention`, `--text-primary`, `--text-muted`, `--accent`, `--space-*`). Add scoped classes under `/* cockpit-v2 maintenance */` without altering Pipeline or Automations semantics.

| Surface / class | Token / treatment | Use |
|---|---|---|
| `.maintenance-panel` | `--surface-elevated`, `--space-4` padding, dashed border | Compliance and test picker cards |
| `.compliance-descriptor-row` | ui-sans-serif `0.85rem` | Descriptor id + trigger-mode chips |
| `.compliance-severity-high` | `--stage-failed` border + 8% fill | High severity badge |
| `.compliance-severity-medium` | `#b8860b` border + 8% fill | Medium severity badge |
| `.compliance-severity-low` | `--text-muted` dashed border | Low severity badge |
| `.compliance-result-pass` | `--stage-complete` treatment + “pass” label | Descriptor result row |
| `.compliance-result-fail` | `--stage-failed` treatment + “fail” label | Descriptor result row |
| `.test-preset-button` | `--accent` outline on `:focus-visible` | Suite preset controls |
| `.test-preset-button[aria-pressed="true"]` | `--accent` fill, elevated text | Active preset |
| `.output-stream` | ui-monospace `0.85rem`, `--surface-primary`, max-height 24rem | Shared log viewer |
| `.output-stream-exit-nonzero` | `--surface-attention`, bold exit label | Non-zero subprocess exit |
| `.pre-close-checklist-row-fail` | `--stage-failed` left bar | Failed bundle row in Pipeline |

Severity and pass/fail badges SHALL pair color with text labels; never rely on color alone.

## Interaction requirements

### Compliance audit panel (`data-testid="compliance-audit-panel"`)

- **Descriptor table** — one row per `tests/compliance/*.yaml` file: monospace `id`, severity badge (`high` / `medium` / `low`), and `trigger_modes` chips.
- **Run all / run one** — `POST /api/compliance-run` without filter or with `{ "descriptorId": "<id>" }`; one active run; disabled while in flight (`aria-busy="true"`).
- **Results** — pass/fail row per descriptor; failed rows expose keyboard-toggleable findings detail (`details`/`summary` or `button` + `aria-expanded`).
- **High severity** — any failed `high` descriptor surfaces non-zero exit in `OutputStream` via `.output-stream-exit-nonzero`.
- **Audit history** — footer link “View audit history ledger” opens `lib/memory/features/compliance-tests/audit-history.json` in Files P10 modal (read-only).
- **Empty / error** — dashed empty when no descriptors; `ErrorState` with retry on fetch failure.

### Test suite picker (`data-testid="test-suite-picker"`)

- **Presets** — `client` (Client Vitest), `compliance`, `repo-structure`, `pan-check`; map to `POST /api/test-run` `{ "suite": "<id>" }`; `aria-pressed` on active preset.
- **Run** — starts selected suite; disabled when none selected or run active; streams append to `OutputStream` until “New run” or next execution.
- **Session history** — prior runs (suite, time, exit badge); row select reloads log without re-run. Optional `.pan/maintenance/runs/` persist MAY hydrate on mount; cross-session restore not required.

### Shared OutputStream (`data-testid="output-stream"`)

- **Single viewer** — shared by compliance and test panels (`OutputStream.tsx`; parent alias `StreamedOutputViewer`).
- **Log UX** — ui-monospace `0.85rem`, selectable text, auto-scroll until manual scroll-up, optional “Copy log” via `CopyCommandButton`.
- **Exit status** — footer `aria-live="polite"`: “Exit code: N”; non-zero uses `.output-stream-exit-nonzero`.

### Pre-close validation panel (`data-testid="pre-close-validation-panel"`, Pipeline)

- **Eligibility** — enabled for selected task `currentStage` `ship` or `index`; disabled otherwise with helper: “Pre-close validation is available when the task is in ship or index stage.”
- **Preset** — “Run pre-close preset” runs sequentially: `pnpm -w exec pan check`, compliance run-all, client Vitest; one active run.
- **Checklist rows** (labels from `OPERATION.md` § Pre-close validation checklist): `pnpm -w exec pan check`, `node lib/internal/tools/run-compliance.mjs`, `pnpm test`. Pass/fail badges; failures link “View output in Maintenance” (tab switch + focus history/output).
- **OPERATION.md link** — secondary Files modal link for manual checks outside the preset.

**Components:** `maintenance/{MaintenanceModule,ComplianceAuditPanel,TestSuitePicker,PreCloseValidationPanel}`, `shared/OutputStream`. Reuse `LoadingState`, `EmptyState`, `ErrorState`, `CopyCommandButton`; maintenance-scoped severity badges only.

## Accessibility minimums

WCAG 2.2 Level AA for all surfaces introduced or touched by this feature.

| Criterion | Requirement |
|---|---|
| **1.4.3** | 4.5:1 contrast on descriptor table body, log text, and checklist labels |
| **1.4.11** | 3:1 non-text contrast on severity badges, preset focus rings, and fail row bars |
| **2.1.1** | Keyboard operability for module tabs, descriptor run-one actions, preset buttons, expandable findings, history rows, and pre-close trigger |
| **2.4.3** | Focus order: module tabs → compliance table → test presets → output stream → Pipeline pre-close when mounted |
| **2.4.7** | 2px `--accent` `:focus-visible` outline with 2px offset on interactive controls |
| **2.4.11** | Sticky output header SHALL NOT fully obscure focused findings rows when scrolled |
| **4.1.2** | Exit code in `aria-live="polite"` region; expandable findings use `aria-expanded`; preset toggles expose `aria-pressed`; disabled pre-close exposes `aria-disabled` with visible helper text |
| **4.1.3** | In-flight runs expose `aria-busy="true"` on the active panel |

**Motion:** auto-scroll and checklist row reveal ≤200ms `ease-out`; honor `prefers-reduced-motion` (instant scroll, no animated log fade).

```yaml
contract:
  id: cockpit-v2-maintenance-toolkit-compliance-tests.ux.output-stream-exit-code
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md
    symbol: "Shared OutputStream"
  owner: design-engineer
  description: |
    When a test or compliance subprocess completes with a non-zero exit code,
    OutputStream SHALL display the exit code in a visible status region with
    aria-live="polite" and attention styling without requiring the operator
    to read raw terminal paste in chat.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md
      range: [125, 129]
      note: OutputStream exit status and non-zero styling.
    - kind: lines
      path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/spec.md
      range: [157, 160]
      note: Engineering acceptance for exit code surfacing.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Footer shows Exit code 1 with aria-live=polite and attention styling."
            rationale: Operator sees failure without terminal paste.
        bad:
          - text: "Stream ends with no exit code announced."
            rationale: Violates exit-code acceptance criteria.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-maintenance-toolkit-compliance-tests.ux.output-stream-exit-code
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md#Shared-OutputStream
    pancreator.wcag-criteria: ["4.1.3"]
```

```yaml
contract:
  id: cockpit-v2-maintenance-toolkit-compliance-tests.ux.pre-close-eligibility
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md
    symbol: "Pre-close validation panel"
  owner: design-engineer
  description: |
    When the selected Pipeline task currentStage is before ship or is complete,
    the pre-close validation control SHALL render disabled with helper text
    stating index-adjacent eligibility. When currentStage is ship or index,
    the control SHALL be enabled.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md
      range: [131, 136]
      note: Pre-close eligibility rules.
    - kind: lines
      path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/spec.md
      range: [176, 181]
      note: Engineering acceptance for stage-gated pre-close control.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Task in plan stage shows disabled pre-close button and eligibility helper text."
            rationale: Prevents premature close validation runs.
        bad:
          - text: "Pre-close button active for intake-stage task with no helper text."
            rationale: Violates index-adjacent gate from spec.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-maintenance-toolkit-compliance-tests.ux.pre-close-eligibility
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md#Pre-close-validation-panel
    pancreator.wcag-criteria: ["2.1.1", "4.1.2"]
```

```yaml
contract:
  id: cockpit-v2-maintenance-toolkit-compliance-tests.ux.compliance-findings-expand
  kind: llm-judge
  severity: block
  applies_to:
    kind: artifact-symbol
    path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md
    symbol: "Compliance audit panel"
  owner: design-engineer
  description: |
    When run-all compliance completes and a descriptor row reports fail status,
    the UI SHALL expose expandable findings detail for that descriptor so the
    operator can inspect failure text without opening a terminal.
  references:
    - kind: lines
      path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md
      range: [108, 114]
      note: Results viewer and expandable findings.
    - kind: lines
      path: /lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/spec.md
      range: [132, 134]
      note: Engineering acceptance for findings detail on failed descriptors.
  runtime:
    rubric:
      scale: [1.0, 0.5, 0.0]
      threshold: 0.75
      examples:
        good:
          - text: "Failed descriptor row expands to show findings detail text on activate."
            rationale: Matches run-all compliance acceptance criteria.
        bad:
          - text: "Failed rows show only a red badge with no detail affordance."
            rationale: Operator cannot diagnose failure in Cockpit.
    panel:
      quorum: 2-of-3
      judges: [haiku, haiku, sonnet]
      seed: 42
      cost_ceiling_usd: 0.50
  metadata:
    pancreator.contract_id: cockpit-v2-maintenance-toolkit-compliance-tests.ux.compliance-findings-expand
    pancreator.applies_to: artifact-symbol:/lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/ux-spec.md#Compliance-audit-panel
    pancreator.wcag-criteria: ["2.1.1", "4.1.2"]
```
