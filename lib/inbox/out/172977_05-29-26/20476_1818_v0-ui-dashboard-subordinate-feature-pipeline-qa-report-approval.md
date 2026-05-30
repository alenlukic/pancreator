---
task_id: 68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa
feature_id: v0-ui-dashboard-subordinate-feature-pipeline-qa
gate: report_approval
decision: needs_changes
required_changes: "Fix navigation (directory drill-down vs file open; hide or skip lib/inbox/notes); fix empty activity feed at runtime; redesign UI with Eggshell #F3EFDE primary background, Midnight Violet #271F30 text/chrome, Deep Teal #4E6E58 accents and clear visual hierarchy"
target_stage: implement
---

# Report approval gate

Operator rejected delivery report after manual dashboard review.

## Must-fix issues

1. **Navigation broken** — clicking listed paths yields "Operator sandbox denied" (notes paths) or "path is not a file" (directories). Implement hierarchical directory browsing: drill into directories, open files only for leaf files, exclude `lib/inbox/notes/**`.
2. **Activity feed empty** — `/api/activity` returns no events when the dev server is running. Fix repo-root resolution and event collection so file mtime and write-log events populate the feed.
3. **Visual design** — replace the jarring Ink Black / Celadon palette. Use **Eggshell `#F3EFDE`** as the primary surface, **Midnight Violet `#271F30`** for text and chrome, **Deep Teal `#4E6E58`** for accents. Establish a clear layout hierarchy (header, domain nav, file browser, activity sidebar).

Resume with:

```bash
pnpm -w exec pan advance 68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa --artifact lib/inbox/out/172977_05-29-26/20476_1818_v0-ui-dashboard-subordinate-feature-pipeline-qa-report-approval.md
```
