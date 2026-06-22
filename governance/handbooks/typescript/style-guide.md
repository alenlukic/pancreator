# TypeScript Style Guide

## Scope

This guide governs human-authored TypeScript and TSX.

It is based on the Google TypeScript Style Guide with these intentional deviations:

- statements do not use semicolons
- whitespace and statement grouping follow the operator-readability rules below
- all control-flow bodies use braces; the one-line exception is removed

Repository-specific rules override this guide only when they are explicit.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** indicate requirement levels as defined by RFC 2119 and RFC 8174.

## Agent inspection contract

Agents working on TypeScript code:

- MUST inspect the normative sections of this guide
- MUST run the configured formatter before validation
- MUST NOT inspect Appendix A during ordinary implementation or review
- MAY inspect Appendix A only when changing formatter configuration, formatter integration, or formatting infrastructure

Formatting produced by the configured formatter is authoritative. Do not manually fight formatter output.

## Core principles

- Optimize code for operator readability.
- Code MUST communicate its execution flow without requiring dense local parsing.
- Statements MUST NOT be grouped into large, cluttered blobs.
- Prefer the simplest language or type-system construct that expresses the requirement.
- Prefer a small amount of explicit repetition over a complex abstraction whose behavior must be mentally evaluated.
- Keep unrelated behavior, data preparation, and side effects visually distinct.
- Preserve existing public behavior and interfaces unless a change is explicitly authorized.

## Source files and modules

### File structure

A source file SHOULD contain these sections in order when present:

1. copyright or license information
2. file-level JSDoc
3. imports
4. implementation

Separate present sections with one blank line.

Source files MUST use UTF-8.

### Imports

- Use ES module syntax.
- Do not use TypeScript namespaces, `require`, import assignment, or triple-slash path references.
- Use relative imports for files in the same logical project unless the repository defines a stable path-alias convention.
- Prefer named imports for frequently used or unambiguous symbols.
- Prefer namespace imports when importing many symbols from a large API or when the namespace clarifies otherwise-generic names.
- Use `import type` when a symbol is used only as a type and repository compilation settings require or benefit from explicit type imports.
- Rename imports only to resolve a collision or materially improve clarity.

### Exports

- Use named exports.
- Do not use default exports.
- Export only symbols used outside the module.
- Do not use mutable exports such as `export let`.
- Use an accessor function when external callers need to observe mutable module state.
- Use `export type` when re-exporting types.
- Do not create container classes whose only purpose is to hold static functions or constants. Export those functions and constants directly.

## Whitespace and logical grouping

### General

Whitespace MUST expose logical structure rather than merely separate syntax.

- Use exactly one blank line between distinct logical groups.
- Do not place blank lines at the beginning or end of a function, method, constructor, loop, or conditional body.
- Do not use multiple consecutive blank lines inside an implementation.
- Keep tightly related statements contiguous.
- Separate a statement group from the next independent control-flow block with one blank line.
- `else`, `catch`, and `finally` remain attached to the preceding closing brace.
- When whitespace alone cannot make a block easy to scan, extract a named function or reduce the block’s responsibilities.

### Conditionals

Mutually exclusive branches MUST use one continuous conditional chain:

```ts
if (conditionA) {
  handleA()
} else if (conditionB) {
  handleB()
} else {
  handleFallback()
}
```

Do not represent one mutually exclusive decision as adjacent independent `if` statements.

Independent conditions MUST be separate `if` blocks. Each independent `if` block MUST be preceded by one blank line unless it is the first statement in its enclosing body.

```ts
validateInput(input)

if (input.isArchived) {
  return archivedResult
}

if (input.requiresRefresh) {
  refresh(input)
}
```

Do not insert blank lines between branches of one `if` / `else if` / `else` chain.

All conditional bodies MUST use braces.

### Loops

A loop MUST be preceded by one blank line unless it is the first statement in its enclosing body.

```ts
const records = loadRecords()

for (const record of records) {
  processRecord(record)
}
```

Do not place a blank line between a loop declaration and the first statement in its body.

```ts
for (const record of records) {
  processRecord(record)
}
```

The same grouping rules apply inside loop bodies and nested loops:

```ts
for (let i = 0; i < width; i++) {
  for (let j = 0; j < height; j++) {
    initializeCell(i, j)

    if (shouldActivate(i, j)) {
      activateCell(i, j)
    }
  }
}
```

A nested loop that is the first statement in its parent body follows the parent declaration directly. A nested loop following another statement or block MUST be separated from it by one blank line.

Apply the same separation principles to `while`, `do`, `switch`, and `try` blocks.

## Local declarations

### Declaration form

- Use `const` by default.
- Use `let` only when the binding is reassigned.
- Never use `var`.
- Declare one binding per declaration.
- Do not use a binding before its declaration.

### Just-in-time declarations

Constants inside functions MUST be declared just in time: immediately before the first logical operation that uses them.

Do not collect all local declarations at the top of a function.

```ts
function populateGraph() {
  prepareStorage()

  const x = 3
  const y = 8
  const z = -2

  const graph: number[][][] = [[[0]]]

  for (let i = x; i < 10; i++) {
    for (let j = y; j < 10; j++) {
      for (let k = z; k < 10; k++) {
        graph[i][j][k] = i * j * k
      }
    }
  }

  return graph
}
```

A declaration MAY precede its first use by a small setup sequence when moving it closer would split one coherent operation.

### Declaration groups

Contiguous constant declarations MUST form a coherent group.

Group constants by one or more of:

1. broad value or type category
2. data source or accessor
3. logical responsibility
4. lifecycle or first-use region

Do not mix scalar configuration, structured data, dependencies, and derived results into one undifferentiated declaration block.

```ts
const x = 0
const y = 0
const z = 0

const graph: number[][][] = [[[0]]]
```

A declaration group MUST contain no more than four declarations. Split larger groups using the strongest available logical boundary, such as first-use order, accessor identity, or domain responsibility.

```ts
const w = 0
const x = 0
const y = 0
const z = 0

const intercept = 3
```

Do not insert blank lines inside a coherent declaration group.

## Arrays, objects, and destructuring

- Use array literals, not the `Array` constructor.
- Do not attach non-numeric properties to arrays.
- Spread only values compatible with the structure being created.
- Use object literals, not the `Object` constructor.
- Prefer object destructuring when returned or supplied values benefit from names.
- Use array destructuring for genuinely positional values.
- Keep parameter destructuring shallow. Introduce a named interface rather than embedding a deeply nested parameter type.
- Optional destructured parameters MUST provide an empty array or object as their default.
- Do not mix quoted, computed, and identifier-style keys in one object without a concrete interoperability reason.
- Prefer `Map` over an object when keys are not naturally strings or when insertion, deletion, and iteration are central operations.

## Functions

### Declarations and expressions

- Prefer function declarations for named, module-level functions.
- Do not use `function` expressions.
- Use arrow functions for callbacks and suitable nested functions.
- A nested function MAY use a function declaration when hoisting or a stable local name improves readability.
- Do not rely on dynamically rebound `this`.
- Prefer explicit parameters or arrow functions over `bind`, `self = this`, or implicit callback context.

### Arrow bodies

Use a concise arrow body only when its returned value is consumed.

```ts
const names = users.map((user) => user.name)
```

Use a block body when the return value is intentionally unused or when intermediate steps improve readability.

```ts
await promise.then((result) => {
  recordResult(result)
})
```

### Callbacks

Do not pass a function directly as a callback when the receiving API may supply additional arguments that change its behavior.

```ts
const numbers = values.map((value) => Number.parseInt(value, 10))
```

A named callback MAY be passed directly when both call signatures are deliberately compatible and stable.

### Parameters

- Default parameter expressions MUST be simple and free of observable side effects.
- Prefer an options object when several optional parameters lack an obvious natural order.
- Use rest parameters instead of `arguments`.
- Use spread syntax instead of `Function.prototype.apply`.
- Avoid boolean parameters whose meaning is unclear at the call site. Prefer an options object or a more descriptive API.

### Function scope

A function SHOULD perform one coherent operation.

Extract a function when a block:

- performs a separately nameable phase
- is independently testable
- is duplicated
- hides the enclosing function’s main control flow
- requires several unrelated declaration groups to remain understandable

Do not extract a one-use wrapper that only forwards arguments or renames an obvious operation.

## Classes

### Member layout

Class member properties MUST appear immediately after the class declaration with no intervening blank line.

```ts
class GraphProcessor {
  private readonly graph: number[][][]
  private currentIndex = 0

  constructor(graph: number[][][]) {
    this.graph = graph
  }
}
```

Keep contiguous properties in one property block. Apply the declaration-grouping principles when distinct property groups exist.

When a class has no declared properties, place its constructor immediately after the class declaration with no intervening blank line.

```ts
class GraphProcessor {
  constructor(private readonly graph: number[][][]) {}
}
```

Separate the property block from the constructor with one blank line.

Separate the constructor from the next method with one blank line.

Every method, getter, or setter declaration MUST be separated from the preceding function body by one blank line.

```ts
class GraphProcessor {
  constructor(private readonly graph: number[][][]) {}

  process() {
    this.normalize()
  }

  private normalize() {
    // ...
  }
}
```

Do not place a blank line immediately inside the class opening brace or before its closing brace.

### Fields and constructors

- Mark fields `readonly` when they are not reassigned after construction.
- Initialize a field at its declaration when practical.
- Use parameter properties when they remove obvious constructor plumbing.
- Do not declare an empty constructor or one that only forwards unchanged arguments to `super`.
- Constructor calls MUST include parentheses.
- Establish the complete instance shape during construction. Do not add or remove properties later.

### Visibility

- Restrict visibility as much as possible.
- Do not write the `public` modifier except where required for a mutable public parameter property.
- Do not use bracket access to bypass declared visibility.
- Use TypeScript `private`, not ECMAScript `#private` fields.
- Consider a module-local function instead of a private static method when it improves testability or reduces class responsibility.

### Methods and accessors

- Getters MUST be pure and MUST NOT mutate observable state.
- Do not create trivial pass-through getters and setters solely to conceal a field.
- At least one accessor in a getter/setter pair SHOULD perform meaningful validation, transformation, or encapsulation.
- Do not access static state through `this`; use the declaring class name.
- Do not rely on dynamic dispatch of static methods.
- Do not manipulate prototypes directly.
- Use arrow-function fields only when stable function identity or lexical `this` is required, such as an event handler that must later be removed.

## Control flow

### Blocks

All `if`, `else`, `for`, `while`, `do`, `switch`, `try`, `catch`, and `finally` bodies MUST use braces.

The first statement in a non-empty body starts on the line after the opening brace.

### Iteration

- Prefer `for...of` when iterating array values.
- Use an indexed `for` loop when the index is required or mutation by position is central.
- Do not use `for...in` for arrays.
- Prefer `Object.keys`, `Object.values`, or `Object.entries` over `for...in`.
- A `for...in` loop MUST exclude inherited properties.

### Conditions

Avoid assignments inside conditions.

When an assignment inside a condition is genuinely clearer, wrap it in an additional pair of parentheses to make the intent explicit.

Do not add explicit boolean coercion inside a condition when the condition already performs boolean coercion.

Enum values MUST be compared explicitly rather than treated as booleans.

### Switch statements

- Every `switch` MUST contain a `default` branch.
- The `default` branch MUST be last.
- Every non-empty case MUST terminate with `break`, `return`, or `throw`.
- Non-empty cases MUST NOT fall through.
- Adjacent empty cases MAY share one implementation.

### Equality

Use `===` and `!==`.

`value == null` and `value != null` MAY be used intentionally to test both `null` and `undefined`.

Use grouping parentheses whenever omission could make operator precedence unclear.

## Errors and exceptional behavior

- Throw only `Error` instances or subclasses.
- Instantiate errors with `new`.
- Use exceptions for exceptional failure rather than ad hoc output parameters or `{error}` result objects, unless the surrounding API explicitly uses a result type.
- Catch errors as `unknown`.
- Narrow a caught value before accessing it.
- Assume conforming internal APIs throw `Error` values.
- Handle non-`Error` thrown values only when integrating with a known non-conforming API, and document that boundary.
- Keep `try` blocks focused on operations that may throw.
- An intentionally empty `catch` block MUST explain why ignoring the error is correct.
- Do not add repetitive defensive checks for states excluded by established invariants.

## Type system

### Inference and annotations

Use inference for types that are obvious from literals, constructors, and simple expressions.

Do not annotate trivially inferred primitive or constructor types.

Add an explicit type when it:

- clarifies a complex expression
- constrains an empty collection
- documents a public boundary
- prevents undesirable generic inference
- makes an invariant visible
- catches unintended API changes

Public and exported functions SHOULD declare return types when the return shape is not immediately obvious.

### Object types

- Prefer interfaces for object shapes.
- Use type aliases for unions, primitives, tuples, mapped types, conditional types, and other non-object expressions.
- Use inline object types only when the shape is local, small, and not reused.
- Prefer explicit interfaces and composition over complex mapped or conditional types.
- Use the simplest type construct that can express the requirement.

### Structural typing

When a value is intentionally implementing a structural interface, annotate the declaration or use `satisfies` so excess-property and refactoring errors remain visible.

```ts
const configuration = {
  retries: 3,
  timeoutMs: 5000,
} satisfies RequestConfiguration
```

### Arrays and tuples

Use `T[]` for simple element types.

Use `Array<T>` when the element type is complex enough that postfix brackets reduce readability.

Use tuples for short, genuinely positional results.

Prefer an object with named properties when callers benefit from semantic names.

### Nullability

- Use `null` or `undefined` according to the surrounding API.
- Do not hide nullability inside a reusable type alias.
- Add `| null` or `| undefined` at the actual point where absence is possible.
- Prefer optional properties and parameters over explicit `| undefined`.
- Handle absent values close to the boundary where they arise.

### `unknown` and `any`

- Prefer a specific type.
- Use `unknown` for values whose type is not yet known.
- Narrow `unknown` with a type guard or runtime validator before use.
- Avoid `any`.
- An unavoidable `any` MUST be narrowly scoped and accompanied by a concrete explanation.
- Do not allow `any` to propagate across module or API boundaries.

### Assertions

Type assertions and non-null assertions SHOULD be avoided.

Prefer runtime checks, control-flow narrowing, explicit annotations, or `satisfies`.

An assertion MAY be used when an invariant is established outside TypeScript’s view. The reason MUST be locally obvious or documented.

Use `as` syntax, not angle-bracket assertion syntax.

Use `unknown`, not `any`, as the intermediate type in an unavoidable double assertion.

Do not use an assertion on an object literal when an annotation or `satisfies` can validate the object instead.

### Discouraged types

- Do not use primitive wrapper types: `String`, `Boolean`, `Number`, or `Object`.
- Use `string`, `boolean`, `number`, `object`, `unknown`, or a specific interface instead.
- Avoid `{}` because it means any non-nullish value, not an empty object.
- Use `Record<string, T>` for dictionary-like objects.
- Avoid APIs whose generic parameter appears only in the return type.
- When calling an existing return-only generic API, specify the type argument explicitly.

## Language and API usage

### Strings and numbers

- Use template literals for interpolation or multi-part string construction.
- Do not use backslash line continuations in strings.
- Use lowercase `0x`, `0o`, and `0b` numeric prefixes.
- Do not write ambiguous leading zeroes.
- Use `Number` for decimal numeric conversion.
- Check conversions that may produce `NaN` or non-finite values.
- Do not use unary `+` for numeric conversion.
- Do not use `parseInt` or `parseFloat` for ordinary decimal conversion.
- `parseInt` MAY be used for a non-decimal radix after validating the input.

### Restricted features

Do not use:

- `const enum`
- `eval`
- the `Function` string constructor
- `with`
- production `debugger` statements
- primitive wrapper constructors
- non-standard or proposal-stage language features outside the project’s declared target
- mutation of built-in constructors or prototypes
- unnecessary global symbols
- custom decorators unless the repository explicitly adopts and configures them

Framework-provided decorators MAY be used when required by that framework.

## Naming

### Casing

Use:

| Symbol                                                                     | Style            |
| -------------------------------------------------------------------------- | ---------------- |
| classes, interfaces, types, enums, decorators, type parameters, components | `UpperCamelCase` |
| variables, parameters, functions, methods, properties, module aliases      | `lowerCamelCase` |
| module-level constants and enum members                                    | `CONSTANT_CASE`  |

Local constants inside functions use `lowerCamelCase`, even when immutable.

### Names

- Names MUST be descriptive to a reader unfamiliar with the immediate implementation.
- Do not encode type information already expressed by TypeScript.
- Do not use Hungarian notation.
- Do not prefix interfaces with `I`.
- Do not use leading or trailing underscores.
- Do not remove internal letters merely to shorten a word.
- Treat acronyms as words: use `loadHttpUrl`, not `loadHTTPURL`.
- Short names MAY be used for conventional indexes or values whose entire scope is ten lines or fewer.
- `$` SHOULD be reserved for a framework convention or a consistently adopted observable naming convention.
- A local alias SHOULD preserve the naming style of its source symbol.

## Comments and documentation

### Comment kinds

Use JSDoc for documentation intended for callers and users.

Use `//` comments for implementation details.

Use consecutive `//` lines for multi-line implementation comments. Do not use block comments for ordinary multi-line prose.

Do not draw decorative comment boxes.

### Documentation requirements

Document:

- exported APIs whose contract is not fully evident from their name and type
- non-obvious invariants
- side effects
- required call ordering
- unusual performance characteristics
- compatibility constraints
- unsafe assertions or suppressed checks
- reasons for intentionally surprising behavior

Comments SHOULD explain why, constraints, or consequences. They SHOULD NOT restate syntax.

Do not duplicate TypeScript types in JSDoc.

Parameter and return documentation MAY be omitted when the name, type, and surrounding description already communicate the complete contract.

JSDoc MUST be valid Markdown.

## Toolchain and validation

All TypeScript files MUST pass the repository’s applicable:

- formatter check
- TypeScript type check
- lint checks
- tests
- build

Before completion, run the repository-defined commands. When none are defined, use the closest available equivalents.

Do not use `@ts-ignore` or `@ts-nocheck`.

`@ts-expect-error` MAY be used in a focused type-level test when the expected diagnostic is the behavior under test. It MUST include a description and MUST NOT suppress unrelated code.

An agent MUST report:

- commands run
- command results
- pre-existing failures distinguished from introduced failures
- validation that could not be completed
- any intentional exception to a SHOULD rule

A violation of a MUST or MUST NOT rule makes the change unacceptable unless a higher-authority repository requirement explicitly mandates it.

---

# Appendix A: Formatter-owned rules

> **Not required for agent inspection.**
>
> This appendix exists for human reference, formatter maintenance, and historical clarity. Ordinary implementation and review agents MUST rely on the formatter rather than loading or manually applying this section.

The repository Prettier configuration automatically owns the following rules:

- target an approximately 80-column print width
- use two spaces per indentation level
- use spaces rather than tabs
- omit statement-ending semicolons
- insert a leading semicolon only when needed to prevent an Automatic Semicolon Insertion hazard
- prefer single quotes in TypeScript and JavaScript strings
- use double quotes for JSX attributes
- quote object properties only when required
- include trailing commas wherever supported
- omit spaces inside object, import, export, and destructuring braces
- place closing brackets on their own line where Prettier’s syntax printer requires it
- require parentheses around arrow-function parameters
- use LF line endings
- preserve prose wrapping rather than reflowing Markdown prose

The formatter also owns routine layout decisions including:

- operator spacing
- comma spacing
- indentation
- line wrapping
- chained-call wrapping
- argument and parameter wrapping
- array and object layout
- JSX layout
- generic and union layout
- placement of braces
- normalization of excess blank lines

The formatter does **not** enforce:

- logical blank-line grouping
- just-in-time declarations
- declaration-group size
- mutually exclusive conditional structure
- loop separation
- class member ordering
- naming
- module boundaries
- API design
- type safety
- error handling
- documentation quality
- validation requirements

Those remain governed by the normative sections above.
