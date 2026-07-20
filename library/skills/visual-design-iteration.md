# Visual design iteration

Use when refining prototypes toward stable acceptance criteria.

## Principle

Iterate visually with evidence: capture → score → fix the top issues → repeat.
Structure and accessibility come before polish.

## Steps

1. Capture screenshots and/or accessibility-tree snapshots per landmark section.
2. Score captures against the handbook heuristic checklist.
3. Fix the highest-severity issues first (hierarchy, targets, status, states).
4. Re-capture and rescore until criteria stabilize or the attempt budget ends.
5. Prefer accessibility-tree snapshots for structure and screenshots for visual
   judgment.
6. When MCP or browser tools are unavailable, use a Bash-based capture fallback
   (for example opening the HTML file and saving a page snapshot) and disclose the
   method in notes.

## Boundaries

Do not treat missing Figma tooling as a loop blocker. Keep HTML authoritative and
record degradation when design-tool artifacts cannot be produced.
