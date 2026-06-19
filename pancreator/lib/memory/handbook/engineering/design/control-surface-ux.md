---
slug: engineering-control-surface-ux
stability: experimental
bootstrap-only: false
phase: 2
owners: [design-engineer, design-reviewer, sme-design, sme-product]
purpose: |
  The interaction-pattern standard for operator control surfaces (Command
  Center and successors). Agents that specify, implement, or review a control
  surface SHALL apply the orientation, triage, receipt, gating, and motion
  obligations on this page. The standard encodes the agent-operations
  control-surface pattern family: the operator supervises autonomous work, and
  the UI is the supervision instrument.
references:
  - '{"kind":"lines","path":"lib/memory/handbook/engineering/design-craft.md","range":[206,264],"contentHash":"9c6c2ef","note":"Design-craft gate-blocking conditions that every control surface must clear."}'
  - '{"kind":"lines","path":".docs/PRD.md","range":[225,243],"contentHash":"2eb6aa4","note":"PRD §3.5 US-10 — graduated intervention spectrum the surface must expose."}'
external:
  - https://macro.com/
  - https://lawsofux.com/
  - https://hatchworks.com/blog/ai-agents/agent-ux-patterns/
  - https://cloudpresser.com/writing/why-ai-needs-control-surfaces
related:
  - /lib/memory/handbook/engineering/design/design-system.md
  - /lib/memory/handbook/engineering/design/component-standard.md
  - /lib/memory/handbook/engineering/design-craft.md
...

# Operator section
- 👀 **In this file:** Operator Control-Surface UX Standard
- ⚖️ **Why it matters:** Quick orientation for Operator Control-Surface UX Standard before agents load the full contract.
- 🧭 **See also:**
  - /lib/memory/handbook/engineering/design/design-system.md
  - /lib/memory/handbook/engineering/design/component-standard.md
  - /lib/memory/handbook/engineering/design-craft.md

# Operator Control-Surface UX Standard

A control surface renders pipeline state, compliance posture, automation
state, and pending decisions in a form the operator can act on quickly. The
north-star outcome: the operator completes 90 percent or more of day-to-day
Pancreator work inside the UI without falling back to the CLI, measured over a
working week.

## Orientation: situational awareness budget

1. When the operator opens the home surface, the surface SHALL answer four
   questions within 30 seconds of unassisted reading: what needs me, what is
   running, what failed or stalled, and what shipped recently.
2. The home surface SHALL rank regions by decision urgency: blocked-on-human
   first, anomalies second, running work third, recent outcomes last.
3. Each region SHALL show a count and at most 5 ranked items; overflow SHALL
   collapse behind one navigation action per region (Miller's Law, Hick's
   Law).
4. A region with zero items SHALL render a guided empty state naming the one
   action that would populate it.

## Data truthfulness

1. Every item a surface shows SHALL reflect reconciled repository state; an
   item whose source run is archived, shipped, or superseded SHALL NOT appear
   in an attention region.
2. Each attention item SHALL display its data age when staleness exceeds 60
   seconds, and the surface SHALL revalidate attention regions at most every
   10 seconds while work is active.
3. If state reconciliation fails, then the surface SHALL render an explicit
   degraded-data banner naming the failing source instead of rendering the
   last known list silently.

## Triage and attention

1. The surface SHALL maintain one persistent attention indicator (status bar
   or rail badge) with three states — calm, attention, blocking — driven by
   the same reconciled state as the attention regions.
2. An item that requires operator action SHALL receive exactly one nudge
   animation when it enters the attention state: one translate or scale pulse
   of at most 4px amplitude, 160–240ms duration, at most 2 cycles, honoring
   `prefers-reduced-motion`. Looping or repeating nudges are forbidden.
3. Notification badges SHALL show counts, not dots, when the count exceeds 1.

## Actions, receipts, and gates

1. Every CTA SHALL name an imperative verb plus a concrete object per the
   design-craft controls standard ("Approve plan for task-12", "Re-run
   compliance audit", "Pause automation nightly-curation"); a CTA label SHALL
   state its effect, not its destination, when the action mutates state.
2. Every state-mutating action SHALL produce an action receipt in the activity
   feed: actor, verb, object, timestamp, and a link to the produced artifact
   or diff.
3. A destructive or irreversible action (abort run, delete automation,
   force-close artifacts) SHALL gate behind one confirmation step that names
   the blast radius; reversible actions SHALL execute without confirmation and
   SHALL surface an undo affordance for at least 10 seconds when undo exists.
4. Human-gate decisions (approve, reject, revise) SHALL be actionable from the
   surface that announced them within 2 clicks, without a route change that
   discards the operator's context.
5. Intervention levers (pause, steer, abort per PRD US-10) SHALL sit adjacent
   to the run they target, not in a global settings area.

## Navigation and information architecture

1. Each navigation destination SHALL own one job the operator can state in one
   sentence; a destination without a job SHALL NOT ship.
2. Placeholder destinations ("coming soon") SHALL NOT render in shipped
   navigation.
3. Detail surfaces (run detail, automation detail) SHALL be addressable by URL
   and reachable from every list row that names them.
4. The surface SHALL provide one keyboard launcher (Cmd-K) exposing
   navigation and the 10 most frequent actions; every launcher action SHALL
   also exist as a visible control somewhere on the surface.

## Aesthetic register

The visual register follows the reference aesthetic the operator ratified
(macro.com): calm, monochrome-leaning surfaces with one accent; dense but
breathable layouts on the 4px grid; type-led hierarchy over box-led hierarchy;
visible signal-versus-noise separation where attention items carry the only
saturated color on screen. All values SHALL resolve to design-system tokens.

## Enforcement

1. `design-engineer` SHALL trace each ux-spec assertion for a control surface
   to a numbered obligation on this page or in design-craft.
2. `design-reviewer` SHALL treat violations of §Data truthfulness and
   §Actions, receipts, and gates as `P1` `workflow` defects that force
   `design_qa_passes: false`.
3. `sme-product` and `sme-design` SHALL ground control-surface recommendations
   in this page's obligations and SHALL cite the obligation number.

## Stability

This page is an engineering-standards seed and remains `experimental` until the
Command Center rebuild validates the obligations end to end.
