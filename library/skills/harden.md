# Harden

Use when an operator asks to bring the ad-hoc changes of the current session to
a mergeable state. The session holds no workflow run, no stage contract, and no
gate. It stops at the integration boundary: it prepares the branch and names the
operator's integration command without running it.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

## Procedure

Work the phases in this order.

1. **Assess extent.** Resolve the scope before touching anything: the
   working-tree changes against the merge base, narrowed by any scope hint the
   operator typed. Read the diff and name the surfaces the changes touch —
   code, tests, documentation, rendered UI — because the later phases key off
   that list.
2. **Exercise functionality.** Run the narrowest deterministic checks that
   reach the changed behavior, and add the tests the change is missing under
   `ENG-001`. In self-development the iteration check is
   `./bin/pan tests impacted --worktree-dirty --depth 1` plus the tests the
   session adds. In a target installation, use the `impacted` profile
   `runtime/repository-checks.json` declares, or blast-radius judgment when no
   such profile exists. `REPO-001` on the active card owns command authority;
   do not guess ecosystem commands.
3. **Review and analyze.** Delegate exactly one `pan-reviewer` subagent over a
   single capture of the resolved scope. Tell it the review is standalone and
   that it MUST NOT edit or stage; its findings are its only output.
   `DELEGATE-001` on the active card owns the delegation discipline and the
   outcome ownership. When the findings warrant a deeper pass, name
   `/pan-review` as the operator's option rather than running it.
4. **Visual inspection.** When the scope touched a rendered surface, inspect it
   under `BROWSER-001` and follow `library/skills/browser-inspection.md`; that
   policy and skill own the isolation rules, the page lifecycle, and the
   verdict routing, including the case where no browser is available. When no
   rendered surface changed, record the skip with that reason.
5. **Close gaps.** Implement the fixes for the ranked findings and the missing
   tests inside the assessed scope, highest severity first. Report a finding
   you do not fix with its reason; do not broaden the scope to force a pass.
6. **Prepare for integration.** Leave the branch ready: checks green, findings
   dispositioned, evidence recorded. Then name the integration command the
   operator would run next and stop. The session MUST NOT rebase, push,
   publish, or deploy, and MUST NOT run `pan release` or
   `pan cohort integrate`.

## Check ordering

`DEV-001` on the active card permits exactly one `fast` run as final
validation. Iterate on the `impacted` selection after each fix cycle, run the
`fast` profile once when the work looks complete, and after a failure of that
run re-run only the impacted selection, the failing tests, and the tests the
session added. Never run `full`.

The run-shaped parts of `DEV-001` do not bind this runless session: there is no
baseline capture, no stage output, and no submission validator. The check
ordering, the blast-radius discipline, and the disclosure of added tests in the
outcome report still bind.

## Edge cases

- An empty diff ends the session: report that there is nothing to harden and
  name no integration step.
- A scope hint that selects no change is not an error; report the mismatch and
  assess the full working-tree diff instead.
- A finding outside the assessed scope is reported, not fixed.

## Outcome report

End the session with one fenced `markdown` block carrying:

- the resolved scope;
- the checks run, with their real results;
- the review findings and their disposition;
- the visual-inspection evidence, the skip reason, or the environment block;
- the named integration step the session did not run.
