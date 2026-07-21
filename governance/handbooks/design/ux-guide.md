# UX design handbook

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this
document indicate requirement levels as defined by RFC 2119 and RFC 8174.

This handbook is the durable UI/UX standard for Pancreator design stages. Applicable
sections are unrolled into invocations by `DESIGN-001`. Keep guidance high-signal;
raw research notes belong in run evidence, not here.

## Core UX laws and principles

Use each law as: statement → design implication → when it bites. Sources:
[Laws of UX](https://lawsofux.com/), its articles, Yablonski _Laws of UX_ (2nd ed.),
RIT UX principles slides, and IxDF _Basics of UX Design_.

### Decision and complexity

- **Hick’s Law / Choice Overload** — Decision time grows with number and complexity
  of choices. Prefer progressive disclosure, defaults, and recommended paths. Bites
  when settings, nav, or wizards dump every option at once.
- **Tesler’s Law** — Some complexity cannot be removed; decide whether the system or
  the user absorbs it. Bites when “simple UI” silently shifts hard work onto operators.
- **Occam’s Razor** — Prefer the simplest design that meets the job. Bites when novelty
  or decoration is mistaken for value.
- **Cognitive Load** — Minimize extraneous mental work; keep load task-relevant. Bites
  when labels, layout, and copy force relearning or parallel recall.
- **Parkinson’s Law** — Work expands to fill available time. Bound exploration; timebox
  variants. Bites during open-ended redesign without a stopping rule.
- **Pareto Principle** — Prioritize the critical ~20% of flows that deliver most value.
  Bites when edge cases dominate the first prototype.

### Interaction and targets

- **Fitts’s Law** — Time to acquire a target depends on distance and size. Enlarge and
  place primary actions for easy reach. Bites with tiny icon-only controls far from the
  pointer or thumb.
- **Doherty Threshold** — Keep interactive feedback under ~400ms or show progress.
  Bites when actions appear dead and users re-click.
- **Postel’s Law** — Accept input liberally; emit strict, predictable output. Bites when
  forms reject recoverable typos without helping.

### Memory, attention, and familiarity

- **Jakob’s Law / Mental Model** — Users expect patterns from other products. Match
  conventions unless novelty is the product. Bites when custom chrome fights learned
  behavior (see also _Familiar vs Novel_).
- **Miller’s Law / Chunking / Working Memory** — Limit simultaneous items; group into
  meaningful chunks; let the UI carry state. Bites with long unlabeled lists and
  cross-screen recall requirements.
- **Serial Position Effect** — First and last items are remembered best. Put critical
  actions at list/nav ends. Bites when primary CTAs hide in the middle.
- **Selective Attention** — Users notice goal-related stimuli. De-emphasize competing
  chrome. Bites when banners and badges steal focus from the task.
- **Paradox of the Active User** — People skip manuals and start using the product.
  Put guidance in-flow and recoverable. Bites when first-run depends on unread docs.
- **Zeigarnik Effect** — Incomplete tasks stick in memory. Use resume cues carefully.
  Bites when open loops create anxiety without a clear next step.

### Perception and hierarchy

- **Laws of Proximity, Common Region, Similarity, Uniform Connectedness, Prägnanz** —
  Group related UI; separate unrelated; keep hierarchy simple and consistent. Bites when
  spacing and borders contradict the information architecture.
- **Von Restorff Effect** — The different item stands out. Reserve for one primary CTA
  or alert. Bites when everything is emphasized.
- **Aesthetic-Usability Effect** — Attractive UI is judged more usable. Polish helps
  trust but MUST NOT substitute for verified usability. Bites when beauty hides broken
  flows.
- **Peak-End Rule / Goal-Gradient / Flow** — Shape memorable peaks and endings; show
  progress toward goals; protect immersion with clear feedback. Bites when errors end
  the session without recovery or when progress is invisible.

### Quality lenses (IxDF)

Design packages SHOULD address usefulness, usability, findability, credibility,
desirability, accessibility, and value for the primary user and job.

### Norman action cycle (RIT)

Design for gulfs of execution and evaluation: users MUST be able to see what to do,
how to do it, and whether it worked. Provide planning cues, visible affordances,
efficient physical targets, and clear outcome feedback.

## Heuristic critique checklist

Score each item during design review. Severity-rank findings and cite the violated law
or principle. Prefer the minimal fix.

1. **Job clarity** — Primary user and success outcome are obvious within one glance of
   the entry screen (mental model / selective attention).
2. **Familiar patterns** — Navigation, controls, and terminology match platform
   conventions unless novelty is deliberate (Jakob).
3. **Decision complexity** — Choices are progressive, defaulted, or recommended; no
   unnecessary overload (Hick / choice overload).
4. **Information hierarchy** — Gestalt grouping and typography match IA; related items
   are proximate or enclosed (proximity / common region / similarity).
5. **Targets and reach** — Primary actions meet target-size and placement expectations
   (Fitts).
6. **Feedback latency** — Interactions acknowledge within ~400ms or show progress
   (Doherty).
7. **System status** — Users can tell current state, progress, and outcome (Norman
   evaluation gulf / peak-end recovery).
8. **Error prevention and recovery** — Hard-to-reverse actions confirm; errors explain
   and recover (Postel / peak-end).
9. **Cognitive load** — No forced recall across steps; UI carries needed state (Miller /
   working memory / cognitive load).
10. **States covered** — Empty, loading, partial, error, and success states are designed
    (flow / Zeigarnik resume).
11. **Accessibility baseline** — Semantics, contrast, focus, and target sizes meet the
    baseline below.
12. **Token consistency** — Color, type, and spacing come from declared tokens; one-off
    values are justified.
13. **Complexity ownership** — Irreducible complexity is assigned to system or user on
    purpose (Tesler).
14. **Emphasis discipline** — At most one primary emphasis per view (Von Restorff).

## Accessibility baseline

- **Semantics** — Prototypes MUST use landmark regions (`header`, `main`, `nav`,
  `section`, `footer`) and meaningful headings so section capture and assistive tech
  work.
- **Contrast** — Text and critical icons MUST meet WCAG AA contrast as a floor unless
  the brief documents a higher bar.
- **Focus** — Interactive elements MUST be keyboard reachable with a visible focus
  state; tab order MUST follow reading order.
- **Target size** — Primary controls SHOULD be at least 44×44 CSS px on touch-class
  layouts; never rely on hover-only affordances for required actions.
- **Name and role** — Buttons, links, and inputs MUST have accessible names; decorative
  imagery MUST be marked decorative.
- **Motion** — Non-essential motion MUST respect `prefers-reduced-motion`.

## Design tokens

- Define tokens as CSS custom properties **before** laying out screens.
- Prefer semantic names (`--color-danger`, `--space-section`) over raw palette names in
  component rules.
- Establish spacing and type scales early; reuse them instead of magic numbers.
- Document token intent in the design spec so implementation can map to the target stack
  without redesigning hierarchy.

## Mock media and fidelity

- **Authoritative medium** — Self-contained HTML/interactive prototypes under the run’s
  `artifacts/mocks/` directory. No external build step or CDN dependency.
- Fidelity SHOULD match the question under test: structure and flow first; visual polish
  after hierarchy and states stabilize.
- For key screens, explore multiple variants before converging.

## Design tooling (MCP)

### Installed in this self-development checkout

Canonical config: `library/cursor/mcp.json`, projected to `.cursor/mcp.json` in
`self_development` only via `./bin/pan models --sync`.

| Server              | Transport                                   | Role                                                                 | Setup / degradation                                                                                              |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **chrome-devtools** | `npx chrome-devtools-mcp@latest --isolated` | Primary Visual QA and browser inspection through Chrome DevTools MCP | Use Chrome for Testing with `--executablePath` and `--isolated`. Requires network for first `npx` fetch.         |
| **playwright**      | `npx @playwright/mcp@latest`                | Explicit fallback only when chrome-devtools is unavailable           | Requires network for first `npx` fetch. If unavailable, use Bash/browser capture fallbacks documented in skills. |

### Documented for target repositories (not installed here)

- **shadcn/ui MCP** — Useful when the target already uses shadcn/ui component generation.
- **21st.dev Magic** — Optional component/inspiration tooling for targets that adopt it.

Embedded targets own their `.cursor/mcp.json`. Pancreator documents these servers but
MUST NOT overwrite target MCP config during embedded install.

## Visual iteration loop

1. Capture screenshots and/or accessibility snapshots per landmark section.
2. Score against the heuristic checklist.
3. Fix the highest-severity issues.
4. Repeat until acceptance criteria stabilize.
   Prefer accessibility-tree snapshots for structure and screenshots for visual judgment.
   When MCP/browser tools are unavailable, use a Bash-based capture fallback and continue.

## References

- Laws of UX site and linked resources: https://lawsofux.com/
- Laws of UX articles: https://lawsofux.com/articles/
- Jon Yablonski, _Laws of UX_ (2nd ed.) PDF research input for this handbook
- RIT UX design principles slides (ElGlaly), _UX Design Principles and Guidelines_ PDF
- Interaction Design Foundation, _The Basics of User Experience Design_ PDF
- Operator-level Cursor **frontend-design** user rules remain separate, unabsorbed
  authority for interactive frontend implementation work. This handbook MUST NOT
  duplicate or replace those rules; design stages reference them when relevant and leave
  them as operator-owned Cursor guidance.
