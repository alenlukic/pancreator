---
slug: operator-agent-artifact-format
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [librarian, supervisor, tech-writer]
purpose: |
  Defines the two-section file layout that separates operator-readable summaries
  from agent-readable contract content across permanent documents and transient artifacts.
related:
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/operator-output-contract.md
  - /lib/memory/handbook/output-manifest-contract.md
...

# Operator section
- 👀 **In this file:** Operator/Agent Artifact Format
- ⚖️ **Why it matters:** Quick orientation for Operator/Agent Artifact Format before agents load the full contract.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/operator-output-contract.md

# Operator/Agent Artifact Format

Pancreator files SHOULD separate human-optimized orientation from agent-optimized
contract content. The operator section is for quick human scanning. The agent
section is the canonical content agents parse, validate, and act on.

## 1 — Applicability

This format applies to permanent repo documents and transient task artifacts
unless a file-specific tool cannot yet tolerate the prefix.

- Markdown documents under `.docs/`, `lib/memory/`, `lib/personas/`, and `.pan/work/`.
- YAML contracts and pipeline artifacts under `lib/**` and `.pan/work/**`.
- JSON artifacts such as indexes, manifests, state files, and machine receipts
  when their consumer schema allows the reserved prefix keys.

Cursor projections under `.cursor/agents/` and `.cursor/rules/` MUST NOT include
this prefix. They are generated runtime projections and stay compact.

## 2 — Required section order

Every sectioned file MUST use this order:

1. **Operator section.** Human-readable summary or one-line no-human-content banner.
2. **Agent section.** The canonical file payload, including any existing
   frontmatter, schema keys, contract clauses, or artifact body.

Humans scanning a file MUST see the operator section first. Agents MUST skip the
operator prefix and read the remainder of the file as the agent section. Agents
MUST NOT use operator-section prose as evidence for validation, scope,
requirements, or gate decisions unless the human explicitly asks about operator
readability.

## 3 — Markdown format

Handbook and persona files with YAML frontmatter MUST lead with that frontmatter
at line 1 so Markdown previews render metadata at normal body size. The operator
section follows the closing frontmatter fence; do not add a second frontmatter
fence after the operator section.

Memory Markdown under `lib/memory/` MUST use a renderer-portable frontmatter
subset so weak Markdown renderers do not misparse metadata as body headings:

- top-level scalars and arrays of scalars only;
- no nested YAML mappings or sequences of mappings in frontmatter;
- `related` as a block-style scalar path list;
- closing fence `...` (YAML document end), not `---`, to avoid Markdown setext
  collisions when a renderer fails to strip frontmatter.

When memory docs carry dual-anchor citations, `references` MUST be a scalar array
of serialized JSON citation objects (one string per entry), not nested YAML
objects. Contract wrappers and pipeline YAML keep their existing structured
`references[]` schemas; this portability rule applies only to memory Markdown.

```markdown
---
slug: example-doc
owners: [librarian]
purpose: |
  Agent contract prose lives here.
references:
  - '{"kind":"file","path":"AGENTS.md","note":"Repo operating card."}'
related:
  - /AGENTS.md
...

# Operator section
- 👀 **In this file:** <one sentence>
- ⚖️ **Why it matters:** <plain-language summary for humans>
- 🧭 **See also:**
  - <related path>

# Agent-readable content starts here
```

When the agent section has no YAML frontmatter (for example repo-root `AGENTS.md`),
the agent payload begins immediately after the operator bullets:

```markdown
# Operator section
- 👀 **In this file:** <one sentence>
...
# Agent-readable content starts here
```

The three operator bullets are required when the file has useful human content:

- 👀 **In this file:** what the file contains.
- ⚖️ **Why it matters:** why a human operator should care, in plain language.
  MUST NOT paste persona `description` fields, RFC 2119 contract prose, or
  truncated machine text.
- 🧭 **See also:** newline-separated related files, or `N/A`.

When the file has no useful human content, replace the full operator section
with a single-line banner:

```markdown
⚙️ no human content
<agent-readable content starts here>
```

## 4 — YAML format

YAML pipeline and contract files MUST use the operator block as YAML comments,
then raw agent YAML:

```yaml
# Operator section
# - 👀 **In this file:** Pipeline definition `feature-delivery`.
# - ⚖️ **Why it matters:** Shows which stages run and which gates block progress.
# - 🧭 **See also:**
#   - pancreator/lib/pipelines/README.md
id: feature-delivery
stages:
  - id: plan
```

If the YAML file has no useful human content, use the single-line operator
banner as a comment, then the agent YAML:

```yaml
# ⚙️ no human content
id: example
```

## 5 — JSON format

JSON files MAY prefix the payload with a human `$operator` summary object.
JSON consumers that validate closed schemas MUST strip `$operator` before schema
validation.

```json
{
  "$operator": {
    "in_this_file": "<one sentence>",
    "why_it_matters": "<one sentence>",
    "see_also": ["lib/memory/handbook/output-manifest-contract.md"]
  },
  "output_manifest": {
    "persona_contract": "PERSONA.TECH_WRITER"
  }
}
```

When the file has no useful human content, use:

```json
{
  "$operator": "⚙️ no human content",
  "state": {}
}
```

## 6 — Write rules

Authors and agents MUST follow these rules when creating or editing sectioned files:

- The human/operator section MUST be the first content humans see in Markdown and YAML files.
- **Why it matters** MUST be a true plain-language summary for human operators. It MUST NOT
  copy persona `description` fields, RFC 2119 contract prose, or truncated machine text.
- The agent section MUST preserve any canonical schema, frontmatter, and
  machine-readable content required by existing tooling.
- The operator section MUST summarize; it MUST NOT contain unique requirements,
  acceptance criteria, or validation facts absent from the agent section.
- Related files in **See also** SHOULD be repo-relative paths and SHOULD avoid
  broad directories unless the whole directory is the related surface.
- Files under `.cursor/` MUST remain unsectioned projections.

## 7 — Migration rule

When editing an unsectioned document or artifact, add the operator/agent split in
the same change unless doing so would break a known parser. If migration is
deferred, record the reason in the output manifest or delivery report.

For parser-sensitive files, prefer this sequence:

1. Update the parser or schema to strip/allow the reserved `$operator` prefix when needed.
2. Add the operator section before the existing agent payload.
3. Verify the original agent payload still parses after skipping the operator prefix.
