Build or regenerate the target repository's operator brief ontology and project design system.

1. Read `AGENTS.md` and treat its declared workspace as the target. The embedded projection expands this instruction to the target and harness operating cards.
2. Run `./bin/pan briefs build` to create missing project files without replacing existing customization.
3. Use the harness-relative paths `docs/operator-briefs/project.json` and `docs/operator-briefs/project.css`. In an embedded installation, Cursor filesystem operations use `.pancreator/docs/operator-briefs/project.json` and `.pancreator/docs/operator-briefs/project.css`, while CLI arguments remain harness-relative.
4. Invoke the `librarian` subagent with the target workspace root and those two output paths. Require it to read `docs/operator-brief-system.md`, `library/operator-briefs/primitives.json`, both current project files, target-owned documentation, and a bounded sample of recurring operator-facing artifacts or workflows.
5. Require the librarian to identify stable recurring brief, section, card, and field concepts. Exclude one-off subjects, people, dates, statuses, and artifact instances from ontology entries; never duplicate or override Pancreator-owned keys.
6. Require each project section semantic to use a concise title meaning and a unique semantically appropriate emoji that does not conflict with the shared or project registry.
7. Require project CSS to define design tokens in `:root`, retain readable light/dark/print behavior from the base system, and use layout or color only to reinforce semantic distinctions. Exclude inline artifact styling, excessive decoration, and target-application CSS dependencies.
8. Limit librarian writes to the two declared project files. Preserve existing useful definitions and tokens unless they are stale, conflicting, or redundant. Regeneration is replacement of the derived project layer, not modification of shared primitives.
9. Run `./bin/pan briefs validate --json`. If validation fails, provide the issues to the librarian for one correction attempt and rerun validation.
10. Do not modify target source, workflow state, shared Pancreator primitives, or governance and do not commit, push, merge, publish, or deploy.
11. Surface both validated paths and a concise summary of the recurring use cases, semantic additions, and design-token decisions represented.
