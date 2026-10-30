# Task sizing handbook

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC 2119 meanings.

This handbook defines how intake sizes a task, classifies its integration surface, and selects its route. `pan intake classify` applies the same rubric and records the result, so an agent estimates the inputs and the command derives the class and the route.

## Definitions

- **TSSRF:** a tightly-scoped, single-responsibility function, in the function-design sense.
- **Module:** a unit of horizontal or vertical code organization. Its boundary depends on scope and location in the system. A design system or an ORM is a horizontal module. A user flow, or the business logic behind endpoints that share a route prefix, is a vertical module.
- **SLOC:** non-blank, non-comment lines of implementation code that the task adds or changes. SLOC excludes test code, test fixtures, and generated output. In Pancreator self-development, policy JSON, workflow JSON, and persona and prompt Markdown count as implementation.
- **Horizontal layer:** in a target installation, one of `frontend`, `api`, and `backend`. In Pancreator self-development, one of `cli-engine` (`src/`, `bin/`), `governance` (policies and registries), `library` (workflows, personas, skills, and templates), and `host-projections` (projected commands, agents, rules, and hooks).
- **Integration task:** a task whose implementation touches more than one horizontal layer.
- **New integration point:** a net-new interface between layers, as opposed to a change to an existing one. Only an integration task can have one.

## Estimation

- Estimate implementation code only. You MUST NOT estimate test code, such as the SLOC needed to test the implementation.
- Estimate four inputs: SLOC, the TSSRF count, the module count, and the horizontal layers touched. Record whether the task needs a new integration point.
- Round SLOC up when the estimate is uncertain. A low estimate routes work to a lighter workflow that then reroutes, which costs more than a high one.
- State the rationale in one or two sentences: the dominant change and the reason for the count.

## Size classes

| Class | SLOC target | TSSRF target | Module target | SLOC hard max |
| ----- | ----------- | ------------ | ------------- | ------------- |
| XS    | 25          | 1            | 1             | 50            |
| S     | 150         | 2            | 2             | 300           |
| M     | 600         | 8            | 6             | 1000          |
| L     | 1200        | 16           | 12            | 2000          |
| XL    | none        | none         | none          | none          |

A task meets a class target when its SLOC is at or under the SLOC target, or when its TSSRF count and its module count are both at or under their targets. A task takes the smallest class whose target it meets and whose SLOC hard max it does not exceed. A task that exceeds a class hard max takes the next class, whatever its TSSRF count. A task that fits no class from XS to L is XL.

## Routes

| Size  | New integration point | Route                                                                |
| ----- | --------------------- | -------------------------------------------------------------------- |
| XS, S | either                | `one-shot`                                                           |
| M     | no                    | `standard`                                                           |
| M     | yes                   | `prototype-trace`, then `standard` on the approved interface schema  |
| L, XL | no                    | `decompose`, then each chunk on the route its own size selects       |
| L, XL | yes                   | `prototype-trace` for the whole task, then `decompose` on its schema |

- A decomposition MUST produce chunks of size M or smaller. Each chunk carries its own classification, and an XS or S chunk routes to `one-shot`.
- A route step whose workflow is not installed yet starts the `planning` workflow instead. The classification record names that fallback and its reason.
- An explicit operator workflow selection overrides the route. The record keeps the derived route beside the operator's choice.

## Reclassification

A stage that finds the work breaches its class hard max MUST report it. A standard stage that finds an unplanned new integration point MUST report that too. The supervisor then reclassifies with the new estimate and a reason. The record keeps every earlier classification, so the reroute stays auditable.
