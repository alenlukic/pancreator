# Python Style Guide

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

## Scope

This guide governs durable human- and agent-authored Python in repositories where Python is part of the active workspace technology set.

The target repository's declared Python version, formatter, linter, type checker, test runner, package manager, framework conventions, and local instructions remain authoritative. This guide MUST NOT be used to silently raise the supported Python version, replace repository-owned tooling, or override a more specific compatible rule.

Workflow-local automation under `runtime/logs/workflows/<run-id>/scripts/` MAY be throwaway and need not conform unless it is promoted into durable repository code.

## Agent inspection contract

Agents changing Python code:

- MUST apply the complete Python guidance unrolled into the active invocation.
- MUST inspect nearby code, tests, configuration, and public interfaces before choosing a pattern.
- MUST preserve repository conventions when they are deliberate, internally consistent, and compatible with correctness.
- MUST NOT load this handbook separately when its content is already embedded in the invocation.
- SHOULD expand into framework or dependency documentation only when the task requires behavior not established by repository evidence.

## Core principles

- A change MUST be the smallest coherent change that fully satisfies the request.
- Code MUST optimize for correctness, readability, explicit boundaries, and maintainability before cleverness or compression.
- Public behavior MUST remain stable unless the requested change intentionally alters it.
- Invalid states SHOULD be made difficult to represent and easy to reject at boundaries.
- Side effects MUST be explicit, narrow, and testable.
- Repository-owned abstractions SHOULD be reused when they fit; new abstraction layers MUST earn their complexity.
- Compatibility shims, fallbacks, and broad exception handling MUST NOT hide defects or unsupported states.
- Comments MUST explain intent, invariants, or surprising constraints rather than restate syntax.

## Project and module structure

### Source layout

- Existing source layout MUST be preserved unless restructuring is part of the task.
- A module SHOULD have one clear responsibility and a name that reflects it.
- Large modules SHOULD be split along cohesive behavior or domain boundaries, not arbitrary line-count thresholds.
- Package `__init__.py` files SHOULD remain lightweight and MUST NOT introduce surprising import-time work.
- Executable entrypoints SHOULD delegate quickly into importable, testable functions.
- Durable code MUST NOT depend on the current working directory unless the interface explicitly defines that behavior.

### Import behavior

- Imports MUST be placed at module scope unless lazy loading, optional dependencies, cycle avoidance, or runtime registration provides a concrete reason otherwise.
- Imports SHOULD be grouped as standard library, third-party, then local imports, subject to the configured formatter or linter.
- Wildcard imports MUST NOT be used in durable code.
- Relative imports MAY be used inside a package when they improve local clarity and match repository convention; ambiguous deep relative imports SHOULD be avoided.
- Import-time side effects MUST be minimized. Network calls, filesystem mutation, process spawning, environment validation, and expensive computation MUST NOT occur merely because a module was imported.
- Optional dependencies MUST be isolated behind explicit capability boundaries and MUST fail with an actionable error when required behavior is requested.
- Circular imports MUST be fixed at the ownership or dependency boundary rather than masked with scattered local imports, unless a narrow local import is the least harmful compatible solution.

## Formatting and source clarity

- The repository's configured formatter MUST be treated as authoritative.
- Agents MUST NOT hand-maintain formatter-owned whitespace or wrapping rules in conflict with configured output.
- Logical sections SHOULD be separated by blank lines where this improves scanning.
- Dense expressions SHOULD be decomposed when intermediate names expose meaning, validation, or invariants.
- Multiple statements MUST NOT be compressed onto one physical line.
- Parentheses SHOULD be preferred over backslashes for line continuation.
- String quoting SHOULD follow repository convention and formatter output.
- Generated files MUST NOT be manually reformatted unless the generation source or requested task requires it.

## Naming

- Modules, functions, methods, variables, and parameters SHOULD use `snake_case`.
- Classes, exceptions, protocols, and type aliases SHOULD use `PascalCase`.
- Constants SHOULD use `UPPER_SNAKE_CASE` when they are genuinely immutable configuration or domain constants.
- A leading underscore SHOULD indicate an intentionally non-public name.
- Double-leading-underscore name mangling SHOULD be reserved for avoiding subclass collisions, not used as a general privacy mechanism.
- Names MUST communicate domain meaning. Generic names such as `data`, `info`, `obj`, `item`, or `manager` SHOULD be narrowed when a more precise term exists.
- Boolean names SHOULD read as predicates or states, such as `is_ready`, `has_access`, or `should_retry`.
- Collection names SHOULD indicate plurality unless the domain convention strongly favors a singular aggregate name.
- Built-in names such as `list`, `dict`, `id`, `type`, and `input` SHOULD NOT be shadowed when doing so impairs readability or later use.
- Abbreviations SHOULD be limited to established domain or repository vocabulary.

## Functions and methods

### Responsibility and shape

- A function MUST have a coherent purpose and an observable contract.
- Functions SHOULD be short enough that control flow and invariants can be understood without excessive navigation, but MUST NOT be fragmented into trivial wrappers solely to reduce line count.
- Inputs SHOULD be validated at the nearest trustworthy boundary.
- Pure transformation logic SHOULD be separated from I/O and orchestration when practical.
- Boolean mode parameters SHOULD be avoided when separate operations or an enum make behavior clearer.
- Mutable default arguments MUST NOT be used.
- Sentinel objects SHOULD be used when `None` is a valid value and omission must be distinguished from an explicit argument.
- Functions MUST return a consistent conceptual type across ordinary paths.
- Functions MUST NOT rely on undocumented mutation of arguments.
- Keyword-only parameters SHOULD be used for optional values whose meaning is unclear positionally.

### Parameters and calls

- Parameter order SHOULD place required domain inputs first and optional behavior controls later.
- Public call sites SHOULD use keyword arguments when positional meaning is not immediately obvious.
- Variadic `*args` and `**kwargs` SHOULD be reserved for genuine forwarding or extensibility boundaries and MUST NOT erase a stable, knowable interface.
- Forwarded keyword arguments SHOULD be validated or constrained when passing arbitrary values would create delayed, hard-to-diagnose failures.
- Callback signatures SHOULD be typed and documented when the expected contract is not obvious from local usage.

### Return values

- `None` SHOULD represent absence only when absence is a valid, unsurprising outcome.
- Result objects, enums, or typed exceptions SHOULD be preferred when callers must distinguish multiple failure or state outcomes.
- Returning loosely structured dictionaries SHOULD be avoided for stable internal or public contracts when a dataclass, typed mapping, named tuple, or domain object would make fields explicit.
- Iterators and generators SHOULD be used when streaming or lazy evaluation is part of the intended contract; they MUST NOT be introduced when callers require repeatable materialized results.

## Classes and data modeling

- Classes SHOULD model stateful behavior, domain identity, or a stable interface; they MUST NOT be introduced merely to namespace unrelated functions.
- Composition SHOULD be preferred over inheritance unless substitutability and shared behavior are genuine domain requirements.
- Inheritance hierarchies SHOULD remain shallow.
- Dataclasses SHOULD be used for primarily data-bearing values when their generated behavior matches the contract.
- Frozen dataclasses or immutable value objects SHOULD be preferred when mutation is not part of the domain.
- Mutable attributes MUST be initialized per instance, not shared accidentally at class scope.
- Properties SHOULD provide cheap, unsurprising access. Expensive I/O or mutation MUST NOT be hidden behind property access.
- `__repr__` SHOULD be useful for diagnostics and MUST NOT expose secrets.
- Equality and hashing MUST be implemented consistently. Mutable objects MUST NOT be hashable based on fields that can change.
- Abstract base classes or protocols SHOULD be used only when multiple implementations or a tested substitution boundary exists.
- Magic methods MUST preserve Python's expected semantics and return `NotImplemented` where appropriate rather than raising unrelated errors.

## Type annotations

### General

- Existing repository typing policy MUST be followed.
- New or materially changed public functions, methods, classes, and module-level values SHOULD be annotated unless the repository intentionally does not use typing.
- Annotations MUST describe the actual runtime contract, not an aspirational or narrower contract.
- Type inference SHOULD be used for obvious local values; redundant annotations SHOULD NOT add noise.
- `Any` MUST be confined to explicit untyped boundaries and narrowed as soon as practical.
- `object` SHOULD be preferred over `Any` when arbitrary values are accepted but operations require narrowing.
- `cast()` and `# type: ignore` MUST NOT be used to suppress a real mismatch. Their justification MUST be locally evident, and ignores SHOULD include the narrowest supported error code.
- Forward references and postponed evaluation SHOULD follow the repository's supported Python version and typing configuration.

### Collection and callable types

- Abstract collection interfaces such as `Sequence`, `Mapping`, `Iterable`, and `Collection` SHOULD be accepted when callers need not provide a concrete mutable container.
- Concrete collection types SHOULD be returned when concrete semantics are part of the contract.
- Mutability MUST be reflected accurately in annotations.
- Tuples SHOULD represent fixed-position records only when positions are obvious and stable; otherwise a named structure SHOULD be used.
- Callable types SHOULD describe parameters and return values. Protocols SHOULD be considered when callbacks expose named behavior or attributes beyond `__call__`.

### Optionality and narrowing

- Optional values MUST be handled explicitly before use.
- Truthiness MUST NOT substitute for presence checks when valid falsy values exist.
- Runtime validation SHOULD narrow external data into a trusted internal type.
- `assert` MUST NOT be used for user input validation or required runtime checks because optimized execution may remove it.
- Exhaustive handling SHOULD be used for closed unions and enums; unreachable branches SHOULD fail loudly when a supposedly impossible value appears.

### Structured external data

- JSON, environment variables, CLI input, database rows, and network payloads MUST be treated as untrusted until validated.
- Typed dictionaries, dataclasses, schema models, or explicit parsing functions SHOULD be used to make validated structure visible.
- Parsing and validation errors SHOULD identify the failing field or boundary without exposing secrets.
- Deserialization MUST NOT instantiate arbitrary code-capable objects from untrusted input.

## Control flow

- Guard clauses SHOULD be used to reject invalid or exceptional conditions and keep the primary path visible.
- Deep nesting SHOULD be reduced through decomposition, early returns, or clearer state modeling.
- Conditions MUST be explicit when truthiness would conflate distinct states.
- Chained comparisons MAY be used when they improve mathematical clarity.
- Assignment expressions SHOULD be used sparingly and only when they reduce duplication without obscuring control flow.
- Structural pattern matching MAY be used when it clearly expresses closed shape or variant handling and the repository's Python version supports it.
- Loop bodies SHOULD avoid mutation of the collection being iterated unless the behavior is deliberate and safe.
- Comprehensions SHOULD remain simple. Complex branching, side effects, or nested logic SHOULD use an ordinary loop.
- `for`/`else` and `while`/`else` MAY be used when the no-break meaning is locally clear; otherwise an explicit helper or flag SHOULD be preferred.

## Exceptions and error handling

- Exceptions MUST represent exceptional or failed operations, not ordinary multi-state control flow.
- The narrowest meaningful exception type SHOULD be caught.
- Bare `except:` MUST NOT be used in durable code.
- `except Exception` MUST be limited to true process, task, request, or boundary handlers that log, translate, retry, or clean up deliberately.
- Exceptions MUST NOT be swallowed silently.
- A caught exception SHOULD be translated only when the new exception adds domain meaning, boundary stability, or actionable context.
- Exception chaining SHOULD be preserved with `raise ... from error`; `raise ... from None` MAY be used only when suppressing internal detail is intentional and the replacement error remains actionable.
- Custom exception hierarchies SHOULD be small and domain-oriented.
- Error messages SHOULD state what failed and include safe identifying context.
- Secrets, credentials, raw tokens, and sensitive payloads MUST NOT appear in exceptions or logs.
- Cleanup MUST use context managers or `try`/`finally` when resource release is required.
- Retry behavior MUST be bounded, observable, and restricted to operations known to be safe or idempotent.

## Resource management and I/O

- Files, locks, transactions, sockets, subprocesses, and temporary resources MUST have explicit ownership and deterministic cleanup.
- Context managers SHOULD be used for resources with scoped lifetime.
- Text files MUST specify encoding unless a repository abstraction guarantees it.
- Paths SHOULD use `pathlib.Path` when it improves clarity and repository convention permits it.
- Filesystem writes that replace durable state SHOULD be atomic where partial writes would corrupt or invalidate state.
- Temporary files SHOULD use standard-library facilities and MUST be cleaned up predictably.
- Network and subprocess operations SHOULD define timeouts when indefinite blocking is not part of the contract.
- I/O boundaries SHOULD expose enough context for callers to distinguish not-found, permission, validation, and transient failures when those distinctions matter.

## Subprocesses and shell interaction

- Structured argument arrays MUST be preferred over shell command strings.
- `shell=True` MUST NOT be used with untrusted or dynamically composed input.
- Executable identity, working directory, environment, timeout, and expected exit behavior SHOULD be explicit when they affect correctness.
- Captured output MUST be bounded or streamed for commands that may emit large volumes.
- Exit status MUST be checked unless the operation deliberately permits failure.
- Errors SHOULD include the command identity and safe stderr context without leaking secrets.
- Platform-specific assumptions MUST be documented or isolated behind a tested boundary.

## Concurrency and asynchronous code

- Synchronous and asynchronous APIs MUST NOT be mixed in a way that blocks an event loop unexpectedly.
- Async functions MUST await or deliberately schedule every coroutine they create.
- Background tasks MUST have explicit ownership, error observation, and shutdown behavior.
- Cancellation MUST be propagated unless a boundary intentionally completes cleanup before re-raising.
- Shared mutable state MUST be protected by an appropriate synchronization or ownership strategy.
- Thread safety MUST NOT be assumed merely because of the global interpreter lock.
- CPU-bound work SHOULD use an appropriate process, native, or job boundary when it would otherwise block latency-sensitive execution.
- Concurrency limits, queue bounds, and timeouts SHOULD be explicit for fan-out operations.
- Async tests SHOULD use the repository's configured framework rather than custom event-loop management.

## Logging and observability

- Library code SHOULD use the standard logging abstraction or the repository's established wrapper rather than `print`.
- CLI code MAY print intentional user-facing output, but diagnostics SHOULD remain distinguishable from machine-readable output.
- Log levels MUST reflect actionability and severity.
- Structured context SHOULD be included when available, using stable field names.
- High-volume loops MUST NOT emit unbounded per-item logs at ordinary levels.
- Exceptions SHOULD be logged once at the boundary that owns handling; duplicate stack traces across layers SHOULD be avoided.
- Secrets and sensitive personal data MUST NOT be logged.

## Configuration and environment

- Configuration MUST have one clear source of truth and an explicit precedence order.
- Environment variables MUST be parsed and validated at a boundary rather than read ad hoc throughout the codebase.
- Missing required configuration MUST fail with an actionable message before partially performing the operation.
- Defaults MUST be safe and unsurprising.
- Test configuration MUST NOT silently affect production behavior.
- Time, randomness, environment, and global settings SHOULD be injected or wrapped when deterministic tests require control.

## Dependencies and packaging

- New dependencies MUST provide concrete value that cannot be met reasonably by the standard library or existing repository dependencies.
- Dependency additions MUST account for maintenance, security, license, platform, size, and transitive-cost implications.
- Imports MUST match declared runtime or development dependency boundaries.
- Optional dependencies SHOULD be grouped and documented according to the repository's packaging system.
- Version constraints MUST follow repository policy and MUST NOT be broadened or tightened without evidence.
- Package metadata, lockfiles, and generated dependency artifacts MUST be updated through the repository's declared toolchain.
- Agents MUST NOT guess whether the repository uses `pip`, `uv`, Poetry, PDM, Conda, or another environment manager.
- Editable installs and direct source-path manipulation SHOULD NOT be used as hidden runtime requirements.

## Framework and database boundaries

- Framework conventions MUST be followed when they define lifecycle, dependency injection, validation, transaction, or serialization behavior.
- Business logic SHOULD remain outside transport, ORM, template, or framework glue when separation improves testability and reuse.
- Database transactions MUST have explicit scope and failure behavior.
- Query patterns SHOULD avoid unbounded reads and accidental per-row query amplification.
- Migrations MUST be forward-safe according to repository deployment practices and MUST NOT assume instantaneous coordinated rollout unless documented.
- API handlers MUST validate input, preserve stable error contracts, and avoid exposing internal exception details.
- Security-sensitive framework defaults MUST NOT be disabled without an explicit, reviewed reason.

## Security

- External input MUST be treated as untrusted.
- SQL, shell, template, path, and query construction MUST use safe parameterization or framework-provided escaping.
- Dynamic execution through `eval`, `exec`, unsafe deserialization, or arbitrary import paths MUST NOT be used with untrusted input.
- Cryptographic operations MUST use established libraries and approved primitives rather than custom algorithms.
- Secret comparison SHOULD use constant-time helpers where timing exposure matters.
- Temporary credentials and tokens MUST have narrow scope and lifetime.
- Authorization MUST be enforced at the trusted service or domain boundary, not only in presentation code.
- Security checks MUST fail closed unless the requested design explicitly requires and documents another behavior.

## Testing

- Behavior changes MUST receive proportionate automated coverage unless the active invocation records a justified exception.
- Tests SHOULD assert observable contracts rather than private implementation details.
- A test MUST fail for the defect or missing behavior it is intended to cover.
- Unit tests SHOULD isolate pure or bounded behavior; integration tests SHOULD cover meaningful boundaries such as databases, filesystems, subprocesses, services, and framework wiring.
- Fixtures SHOULD be explicit, focused, and no broader in scope than needed.
- Tests MUST NOT depend on execution order, ambient developer state, network availability, wall-clock timing, or random outcomes unless those dependencies are deliberately controlled.
- Temporary directories, free ports, clocks, random generators, and environment values SHOULD use repository-provided fixtures or deterministic helpers.
- Mocking SHOULD be concentrated at unstable or expensive boundaries. Excessive mocking of internal collaborators SHOULD be replaced with clearer interfaces or higher-value integration coverage.
- Snapshot or golden tests MUST remain reviewable and MUST NOT be updated blindly.
- Parametrization SHOULD cover meaningful input classes without obscuring which case failed.
- Async and concurrent tests MUST observe task failures and clean up spawned work.
- Regression tests SHOULD name the behavior or failure mode they protect.

## Documentation and comments

- Public modules, classes, functions, and methods SHOULD have docstrings when their contract is not obvious from name, signature, and type annotations.
- Docstrings MUST describe externally useful behavior, parameters, return values, side effects, exceptions, and invariants where relevant.
- Docstrings MUST NOT duplicate type annotations mechanically.
- Comments SHOULD explain why a constraint exists, why a seemingly simpler approach is unsafe, or what invariant a non-obvious block preserves.
- TODO comments MUST include enough context to act on and SHOULD reference a tracking item when repository practice supports it.
- Dead commented-out code MUST be removed rather than retained as history.
- Examples in documentation MUST remain executable or clearly illustrative and SHOULD reflect the supported public interface.

## Compatibility and deprecation

- The repository's declared minimum Python version MUST be preserved unless changing it is an explicit task outcome.
- Syntax, standard-library APIs, typing features, and dependency versions MUST remain compatible with that minimum.
- Public deprecations SHOULD provide a migration path and follow repository policy for warning class and removal timing.
- Compatibility code SHOULD be centralized, tested, and removed when its supported window closes.
- Feature detection SHOULD be preferred over fragile version-string comparison when behavior can be tested directly.
- Serialization, database, and API changes MUST consider rolling deployment and backward compatibility where applicable.

## Toolchain and validation

Before completion, agents changing Python MUST:

- run the repository-configured formatter or formatting check;
- run the repository-configured linter;
- run the repository-configured type checker when one exists;
- run the smallest relevant automated tests during implementation;
- run the workflow-required configured verification profile before submission;
- report commands and outcomes accurately, including checks that were unavailable or not run.

Agents MUST use `runtime/repository-checks.json` as the workflow command authority and MUST NOT substitute guessed `python`, `pytest`, `ruff`, `mypy`, `pyright`, `tox`, `nox`, package-manager, or environment commands.

Formatter and linter output MUST be treated as authoritative unless the configuration itself is the subject of the task.

## Review checklist

A Python implementation or review SHOULD verify that:

- repository version and toolchain constraints are preserved;
- public interfaces and compatibility expectations are explicit;
- external data is validated before trusted use;
- type annotations match runtime behavior;
- exceptions are narrow, actionable, and not swallowed;
- resources and background work have clear ownership and cleanup;
- blocking I/O is not introduced into async execution paths;
- subprocess and query construction is injection-safe;
- tests cover the changed contract and meaningful failure paths;
- logs and errors do not expose secrets;
- new dependencies and abstractions are justified;
- configured formatter, static checks, and tests pass or failures are reported honestly.

# Appendix A: Formatter-owned rules

This appendix records categories intentionally delegated to the repository formatter and linter. It is reference material and SHOULD NOT be unrolled into ordinary implementation or review invocations unless formatter configuration is being changed.

The configured tools MAY own:

- indentation width and continuation indentation;
- maximum line length and wrapping decisions;
- quote normalization;
- trailing commas;
- blank-line counts;
- import ordering and unused-import removal;
- whitespace around operators, delimiters, slices, and annotations;
- final newlines and other mechanical file normalization.

Agents MUST resolve conflicts by following the repository's configured tool output rather than manually enforcing a competing mechanical style.
