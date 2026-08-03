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
6. `BROWSER-001` governs how captures are taken. Because iteration produces craft
   feedback rather than a verdict, it permits a disclosed capture fallback (for
   example opening the HTML file and saving a page snapshot) when browser tooling
   is unavailable; disclose the method in notes.

## Boundaries

Keep HTML prototypes authoritative throughout the iteration loop.
