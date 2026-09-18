# Browser inspection

Use when a stage must observe a running web UI. `BROWSER-001` owns the host-safety
and isolation rules. This skill is the executable procedure, and that policy
references it on every invocation that needs it.

## Principle

Browser inspection is an experiment run on a throwaway browser. The operator's own
browser, profile, and host settings are not part of the apparatus and must be
indistinguishable before and after.

## When this skill does not apply

This skill applies when you open a browser page or record a browser verdict. A change
with no operator-facing web surface — a CLI, a validator, a renderer, run-state
recording, a library module — owes no browser verdict, so no stage of it needs this
procedure.

Record the skip with that reason and do not read further. The skip is an ordinary
judgment call that needs no supervisor prompt. A stage that owes a browser verdict
and cannot reach a browser is environment-blocked rather than skipped.

## Procedure

1. Start the documented development or prototype server and confirm its local URL
   is reachable. If it cannot be started, the case is environment-blocked.
2. Open a fresh, dedicated page with `new_page` in a unique isolated context.
   Confirm `isolatedContext` in the response before proceeding.
3. Drive the declared flows with `navigate_page`, `take_snapshot`, and the
   interaction tools the surface needs — `click`, `hover`, `fill`, `type_text`,
   `press_key`, `drag`. Prefer snapshots for DOM and structural evidence.
4. Exercise the states the surface owns: hover, focus, active, selected, disabled,
   loading, empty, success, and error.
5. Confirm from snapshot evidence that navigation, inputs, persistence, ordering,
   and feedback behave as the acceptance criteria or design specification
   requires. Use `take_screenshot` only when snapshot evidence cannot settle a
   visual question, and say why.
6. When a design specification names a palette or tokens, check primary surfaces,
   text and chrome, accents, and layout hierarchy against them. `evaluate_script`,
   `list_console_messages`, and `lighthouse_audit` are available when they
   materially support a craft or accessibility finding.
7. Close every page opened, including on failure, and record each `close_page`.
8. Record the actions, DOM observations, `isolatedContext` confirmation, and
   `close_page` calls in the corresponding case evidence alongside the pass or
   fail finding.

## Routing

An unresolved functional or visual product defect is a failure verdict that routes
back to implementation. A missing browser, missing MCP server, or unstartable
server is environment-blocked, never a product pass or fail.
