---
title: AGENTS.md Authoring Guide
slug: agents-md-authoring
stability: experimental
bootstrap-only: false
phase: 0b
owners: [supervisor, librarian, tech-lead]
purpose: Defines how to keep /AGENTS.md high-signal while static persona, pipeline, and manifest contracts carry execution detail.
references:
  - kind: file
    path: AGENTS.md
    note: "Root operating card; intentionally thin index into static contract keys."
  - kind: file
    path: lib/memory/handbook/agent-document-registry.md
    note: "Stable DOC.*, PIPE.*, and PERSONA.* key registry referenced by AGENTS."
  - kind: file
    path: lib/memory/handbook/persona-contracts.md
    note: "Persona specs own execution contracts; AGENTS must not duplicate them."
  - kind: file
    path: lib/memory/handbook/output-manifest-contract.md
    note: "Output manifest double-write and transition validation contract."
related:
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/persona-contracts.md
  - /lib/memory/handbook/pipeline-state-contract.md
  - /lib/memory/handbook/output-manifest-contract.md
---

# AGENTS.md Authoring Guide

## Purpose

`/AGENTS.md` is the repo-level operating card. It is not the place to enumerate
every handbook path, persona responsibility, pipeline artifact, or gate rule.
Those obligations belong in keyed static contracts that can be validated and
updated independently.

## Required shape

`/AGENTS.md` SHOULD stay short and MUST include only cross-cutting rules that are
binding for every agent invocation:

1. startup order and repo-wide precedence over persona-local contracts;
2. stable global contract keys, especially `DOC.REGISTRY`,
   `DOC.PERSONA_CONTRACTS`, `DOC.OUTPUT_MANIFEST`, `DOC.PIPELINE_STATE`, and
   `PIPE.FEATURE_DELIVERY`;
3. persona and pipeline authority boundaries;
4. output manifest and gate-validation obligations;
5. context discipline; and
6. repo operating rules that are genuinely global.

AGENTS MUST NOT become a noisy routing table. When a doc path or rule only
applies to one persona, stage, or responsibility, put it in the persona spec or
pipeline contract and reference it through a stable key in `DOC.REGISTRY`.

## Update triggers

Update `/AGENTS.md` when a repo-wide operating invariant changes, or when the set
of stable global keys that every agent needs changes. Do not update AGENTS for
narrow persona behavior, stage inputs, stage outputs, or local acceptance
criteria unless the change also alters the global contract model.

When AGENTS changes, update these dependent artifacts in the same patch when
relevant:

- `lib/memory/handbook/agent-document-registry.md`
- `lib/memory/handbook/persona-contracts.md`
- `lib/memory/handbook/output-manifest-contract.md`
- `lib/memory/handbook/pipeline-state-contract.md`
- `lib/memory/handbook/index.md`
- generated projection code in `lib/internal/packages/@pancreator/cli/src/cursor-sync.ts`

## Reference policy

Prefer stable `kind: file` references for AGENTS in durable docs. Avoid citing
AGENTS line ranges unless the exact wording is the subject of the artifact; line
ranges become stale whenever the operating card is compressed or reorganized.

## Anti-patterns

- Long tables of handbook paths in AGENTS.
- Duplicating persona-specific required docs in AGENTS.
- Duplicating pipeline stage inputs, outputs, or gates in AGENTS.
- Asking agents to invent per-run contracts instead of following static specs.
- Treating a path list as proof that required docs were read or applied.
