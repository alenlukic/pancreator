Migrate `inbox` to follow the same naming and organizational conventions as `work` (i.e. day-oriented top-level directories, HHMM-oriented subdirectories, ensuring reverse chron order using future anchor prefixes, descriptive suffixes)

## FAQ

- Q1. Single-file leaf placement vs per-artifact HHMM subdirectory. The
  directive says "HHMM-oriented subdirectories". Assumption A1 maps `HHMM`
  to the basename token rather than a folder layer because inbox artifacts
  are single files. Does Q1 close on A1 (basename token), or require strict
  folder-per-item parity with `src/work/`? **Answer**: A1 is the correct assumption.
- Q2. Threads layout. Three options: (a) day-bucket nested inside the
  feature folder as
  `src/inbox/threads/<feature-slug>/{days-to-FDS}_{MM-DD-YY}/`; (b)
  feature-folder nested inside a day bucket as
  `src/inbox/threads/{days-to-FDS}_{MM-DD-YY}/<feature-slug>/`; or (c)
  feature-folder remains flat at the threads top level with no day buckets.
  Assumption A2 picks option (a). **Answer**: Option (b).
- Q3. Migration tool surface. Extend `src/internal/tools/migrate-timestamp-naming.mjs`
  with hierarchy logic, or ship a sibling
  `src/internal/tools/migrate-inbox-directory-hierarchy.mjs` (repo script
  layout per `AGENTS.md` workspace map)? Assumption A3 picks the sibling tool.
  **Answer**: A3.
- Q4. Compliance descriptor surface. Extend
  `tests/compliance/timestamp-naming-conventions.yaml` with hierarchy clauses, or
  land a sibling `tests/compliance/inbox-directory-hierarchy.yaml`? Assumption A4
  picks the sibling descriptor. **Answer**: A4.
- Q5. ADR shape. New ADR `src/memory/adr/0006-inbox-directory-hierarchy.md`
  extending ADR-0005 by reference, or amend ADR-0005 in place? Assumption
  A5 picks the new ADR. **Answer**: New ADR.
- Q6. Migration ordering. One atomic migration manifest covering all four
  in-scope subtrees, or staged subtree-by-subtree across multiple
  ratification slices? Assumption A6 picks the atomic manifest. **Answer**: A6.
- Q7. Archive subtree handling. Apply the day-bucket hierarchy
  retroactively to every artifact already in `src/inbox/archive/in/`, or freeze
  the archive in its pre-migration shape and only apply the hierarchy to
  future archived items? Assumption A7 picks retroactive application. **Answer**: A7.