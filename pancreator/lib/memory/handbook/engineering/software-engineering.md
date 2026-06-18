# Operator section
- 👀 **In this file:** Software Engineering Best Practices
- ⚖️ **Why it matters:** Quick orientation for Software Engineering Best Practices before agents load the full contract.
- 🧭 **See also:**
  - kind: lines
  - kind: lines
  - /lib/memory/handbook/engineering/index.md
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 8
title: Software Engineering Best Practices
slug: engineering-software-engineering
stability: experimental
bootstrap-only: false
phase: 0b
owners: [reviewer, tech-lead, pancreator-engineer]
purpose: |
  Durable software engineering principles that govern implementation, review,
  refactoring, debugging, and maintenance. Agents performing those activities
  SHALL optimize for correctness, clarity, maintainability, testability,
  reliability, and minimal necessary complexity.
references:
  - kind: lines
    path: lib/memory/handbook/engineering/index.md
    range: [1, 1]
    contentHash: 990527f
    note: "Engineering standards index routes code activities to this page."
  - kind: lines
    path: lib/memory/handbook/contract-style.md
    range: [1, 1]
    contentHash: 2d7acae
    note: "Contract-style Layer 1 discipline governs prose in engineering artifacts."
related:
  - /lib/memory/handbook/engineering/index.md
  - /lib/memory/handbook/engineering/typescript.md
  - /lib/memory/handbook/contract-style.md
---

# Software Engineering Best Practices

This standard applies to software design, implementation, refactoring, debugging,
and review. Agents SHALL prefer the narrowest change that improves correctness or
maintainability. Agents SHALL NOT introduce architectural churn, speculative
abstractions, broad rewrites, or unrelated cleanup outside the task scope.

## Principles

### 1 — Correctness first

Agents SHALL preserve intended behavior unless the task explicitly changes it.
Agents SHALL make data flow, control flow, and failure behavior explicit. Agents
SHALL treat edge cases, invalid states, and error paths as first-class concerns.

### 2 — Clarity over cleverness

Agents SHALL prefer readable, direct code over clever abstractions, dense
expressions, unnecessary indirection, and hidden magic. Agents SHALL optimize for a
future maintainer reading the code under time pressure.

### 3 — Single responsibility

Each module, class, function, and component SHALL have one coherent reason to
change. Agents SHALL split code when responsibilities are genuinely distinct and
SHALL NOT fragment code merely to satisfy aesthetics.

### 4 — Cohesion and coupling

Agents SHALL keep related logic together and SHALL minimize unnecessary
dependencies across modules. Agents SHALL avoid temporal coupling that forces
callers to know undocumented call order, and SHALL avoid hidden side effects across
distant parts of the system.

### 5 — DRY with judgment

Agents SHALL remove duplication when repeated logic represents the same underlying
concept. Agents MAY tolerate local duplication when abstraction would obscure
intent or freeze an immature design. Agents SHALL NOT create premature generic
helpers for superficially similar code.

### 6 — Explicit boundaries

Agents SHALL keep domain logic separate from transport, persistence, framework, and
UI glue where practical. Agents SHALL introduce interfaces or adapters only when
they reduce real coupling, and SHALL NOT leak implementation details across layers.

### 7 — Testability by design

Agents SHALL prefer deterministic units with explicit inputs and outputs. Agents
SHALL avoid unnecessary global state, ambient dependencies, and hard-to-mock side
effects. Agents SHALL inject dependencies when injection improves isolation and
clarity.

### 8 — Pragmatic testing

Agents SHALL ensure core and critical paths are tested across success, failure,
boundary, and regression cases. Agents SHALL prefer tests that verify behavior over
tests that mirror implementation details. Agents SHALL add a test for a bug before
or alongside its fix when feasible. Agents SHALL NOT chase 100 percent coverage when
tests become brittle or low signal.

### 9 — Error handling and resilience

Agents SHALL fail explicitly and informatively and SHALL NOT swallow errors unless a
deliberate fallback exists. Agents SHALL preserve useful debugging context. Agents
SHALL make retry, timeout, fallback, and partial-failure behavior intentional.

### 10 — Naming and structure

Agents SHALL use names that reveal domain meaning and intent. Agents SHALL avoid
vague names such as `data`, `info`, `helper`, `manager`, `util`, or `handler` unless
the context makes them precise. Agents SHALL keep functions small enough to
understand without splitting code into ceremony.

### 11 — Performance discipline

Agents SHALL prefer a simple implementation until real constraints require
optimization. Agents SHALL optimize hot paths, large-data paths, and user-visible
latency paths only when evidence supports the change. Agents SHALL NOT trade clarity
for micro-optimizations without justification.

### 12 — Security and privacy basics

Agents SHALL validate trust boundaries and SHALL avoid unsafe parsing, injection
risks, secret leakage, and overbroad permissions. Agents SHALL treat
authentication, authorization, and sensitive-data paths as critical paths.

### 13 — Observability

Agents SHALL add logs, metrics, traces, or structured errors when they materially
improve production diagnosis, and SHALL avoid noisy logging. Agents SHALL ensure
critical failures are diagnosable without exposing sensitive data.

### 14 — Maintainability

Agents SHALL prefer changes that reduce future cognitive load. Agents SHALL update
nearby documentation or comments when behavior, contracts, or assumptions change.
Comments SHALL explain why, trade-offs, invariants, or non-obvious constraints, and
SHALL NOT restate obvious code.

### 15 — Minimalism

Agents SHALL build the smallest coherent solution that satisfies the requirement.
Agents SHALL avoid speculative extensibility and SHALL add abstraction only after
the shape of repetition or variation is clear.

## Acceptance criteria

A change conforms to this standard when:

- The change satisfies the requested behavior.
- The solution is readable and locally coherent.
- Responsibilities are separated where separation reduces complexity.
- Duplication is handled with judgment rather than dogma.
- Core and critical paths carry meaningful tests.
- Edge cases and failure modes are considered.
- No unrelated rewrites, formatting churn, or speculative abstractions are
  introduced.
- Validation has been run, or blockers are explicitly stated.
- Remaining risks are identified.

## Validation

Agents SHALL run the narrowest relevant tests first and SHALL run broader validation
when the change affects shared behavior, public APIs, critical paths, or
infrastructure. Agents SHALL treat a failing test as a blocker unless the failure is
clearly unrelated or environment-caused.

For refactors, agents SHALL preserve behavior, SHALL prefer characterization tests
when behavior is under-specified, and SHALL validate before and after where feasible.

For test strategy, agents SHALL prioritize behavioral confidence over raw coverage
percentage, SHALL NOT require 100 percent coverage unless the project mandates it,
and SHALL require explicit justification for any untested critical path.

## Stability

This page is an engineering-standards seed and remains `experimental` until
standards-conformance checks are implemented and validated.
