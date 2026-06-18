# Operator section
- 👀 **In this file:** Component and Icon Library Standard
- ⚖️ **Why it matters:** Quick orientation for Component and Icon Library Standard before agents load the full contract.
- 🧭 **See also:**
  - kind: lines
  - kind: lines
  - https://ui.shadcn.com/docs
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 8
title: Component and Icon Library Standard
slug: engineering-component-standard
stability: experimental
bootstrap-only: false
phase: 2
owners: [design-engineer, design-reviewer, coder, sme-design]
purpose: |
  The component-library and icon-set standard for operator-facing UI. Agents
  that scaffold, implement, or review UI under client/ SHALL build on the
  owned-code component stack and icon set declared here. Hand-rolled monolithic
  stylesheets and ad-hoc glyph icons are forbidden.
references:
  - kind: lines
    path: lib/memory/handbook/engineering/design-craft.md
    range: [180, 186]
    contentHash: 9c6c2ef
    note: "Design-craft consistency and motion standards that the component stack enforces."
  - kind: lines
    path: lib/memory/handbook/engineering/design/design-system.md
    range: [1, 30]
    contentHash: 168f8c0
    note: "Token canon that all components consume."
external:
  - https://ui.shadcn.com/docs
  - https://www.radix-ui.com/primitives
  - https://tailwindcss.com/docs
  - https://lucide.dev/icons
  - https://phosphoricons.com/
related:
  - /lib/memory/handbook/engineering/design/design-system.md
  - /lib/memory/handbook/engineering/design/control-surface-ux.md
  - /lib/memory/handbook/engineering/design-craft.md
  - /lib/memory/handbook/engineering/typescript.md
---

# Component and Icon Library Standard

This standard fixes the UI implementation stack for operator surfaces so that
repeated patterns stay consistent across authors and runs. The stack follows
the owned-code model: generated component source lives in the repository and
the team owns every line, rather than importing a styled black-box dependency.

## Component stack

1. UI components SHALL come from shadcn/ui generation (Radix UI primitives +
   Tailwind CSS), emitted into `client/src/components/ui/` and owned as
   repository source.
2. Behavioral primitives (dialogs, menus, popovers, tabs, toasts, tooltips)
   SHALL wrap Radix UI primitives; agents SHALL NOT hand-roll focus traps,
   dismiss layers, or roving tab index logic that a Radix primitive provides.
3. Styling SHALL use Tailwind utility classes bound to the design-system CSS
   custom properties; the Tailwind theme SHALL map color, radius, spacing,
   type, and shadow scales to the tokens in
   `/lib/memory/handbook/engineering/design/design-system.md`.
4. A net-new shared pattern (used on 2 or more surfaces) SHALL land as one
   component in `client/src/components/ui/` with typed props; surface modules
   SHALL NOT duplicate its markup.
5. Component variants SHALL use a variant utility (`class-variance-authority`
   or equivalent) with named variants; boolean-prop styling forks that restate
   class strings are forbidden.

## Forbidden styling practices

1. Agents SHALL NOT grow a monolithic global stylesheet; `client/src/app/globals.css`
   SHALL contain at most 200 lines covering resets, font loading, and CSS
   custom-property emission.
2. Agents SHALL NOT inline hex literals, pixel one-offs, or shadow definitions
   in component files when a token exists; the design-system enforcement rules
   apply.
3. Agents SHALL NOT introduce a second component framework (MUI, Ant, Chakra,
   Mantine) or a runtime CSS-in-JS library into `client/`.

## Icon standard

1. Icons SHALL come from `lucide-react`. Each icon SHALL render at 16px or
   20px within text rows and 24px in navigation, with `aria-hidden="true"`
   and an accessible label on the interactive parent.
2. Where a pattern needs weight variants that Lucide lacks (duotone or filled
   states), the authoring agent MAY use `@phosphor-icons/react` for that
   pattern and SHALL record the exception in the component's JSDoc.
3. Unicode glyphs, emoji, and inline `<svg>` paths pasted into component files
   SHALL NOT serve as icons on any operator surface.
4. One concept SHALL map to one icon across all surfaces; the nav, list rows,
   and detail views for the same noun SHALL reuse the identical icon import.

## Motion

1. Transitions SHALL stay within 120–240ms and SHALL honor
   `prefers-reduced-motion` per the design-craft motion standard.
2. Attention-seeking motion SHALL follow the nudge specification in
   `/lib/memory/handbook/engineering/design/control-surface-ux.md`; no other
   looping or autoplaying animation is permitted on operator surfaces.

## Enforcement

1. `reviewer` SHALL treat a violation of the forbidden-practices list as a
   `must fix` finding on any `client/` change.
2. `design-reviewer` SHALL treat icon-standard violations as `P1`
   `consistency` defects that force `design_qa_passes: false`.
3. `qa-tester` SHALL include the `globals.css` line-count bound (at most 200
   lines) in the automated checks table for `client/` touch-sets.

## Stability

This page is an engineering-standards seed and remains `experimental` until the
Command Center rebuild ships on this stack.
