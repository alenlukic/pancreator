# Operator section
- 👀 **In this file:** Operator/Agent Artifact Format
- ⚖️ **Why it matters:** Quick orientation for Operator/Agent Artifact Format before agents load the full contract.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/operator-output-contract.md
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 8
title: Operator/Agent Artifact Format
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
---

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
2. **Section index marker.** Either index keys merged into the agent frontmatter,
   or an HTML comment when the agent payload has no frontmatter fence.
3. **Agent section.** The canonical file payload, including any existing
   frontmatter, schema keys, contract clauses, or artifact body.

Humans scanning a file MUST see the operator section first. The section index MUST
NOT use a separate leading `---` fence after the operator section when the agent
already has frontmatter; that duplicate fence is what causes Markdown previews to
render the index at the wrong size.

Agents MUST ignore all content before the indexed agent-section line. Agents MUST
NOT use operator-section prose as evidence for validation, scope, requirements,
or gate decisions unless the human explicitly asks about operator readability.

## 3 — Line-number index

The section index MUST declare the first 1-indexed line of the agent section.
Authors MUST update this line number whenever the prefix or operator section
changes.

The indexed line is the first line agents may treat as canonical. For Markdown
documents with existing frontmatter, this means the indexed line normally points
at the original `---` that begins the document's existing frontmatter.

## 4 — Markdown format

Markdown files MUST use this layout:

```markdown
# Operator section
- 👀 **In this file:** <one sentence>
- ⚖️ **Why it matters:** <plain-language summary for humans>
- 🧭 **See also:**
  - <related path>
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 7
name: Existing Agent Frontmatter Field
---
# Agent-readable content starts here
```

When the agent section already uses YAML frontmatter, the section index keys MUST
live inside that same frontmatter block (one `---` fence pair). Do not add a
separate index fence or a trailing `---` after the operator section; both patterns
cause Markdown previews to render the index at the wrong size.

For agent bodies without YAML frontmatter (for example repo-root `AGENTS.md` or
raw pipeline YAML), the section index MUST use an HTML comment immediately before
the agent payload:

```markdown
# Operator section
- 👀 **In this file:** <one sentence>
...
<!-- pancreator-section-index
format: operator-agent-v1
agent_section_start_line: 12
-->
id: feature-delivery
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
---
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 7
---
<agent-readable content starts here>
```

## 5 — YAML format

YAML pipeline and contract files MUST use the Markdown-style operator block, then
an HTML index comment, then raw agent YAML:

```yaml
# Operator section
- 👀 **In this file:** Pipeline definition `feature-delivery`.
- ⚖️ **Why it matters:** Shows which stages run and which gates block progress.
- 🧭 **See also:**
  - pancreator/lib/pipelines/README.md
<!-- pancreator-section-index
format: operator-agent-v1
agent_section_start_line: 12
-->
id: feature-delivery
stages:
  - id: plan
```

If the YAML file has no useful human content, use the single-line operator
banner from §4, then the section index block, then the agent YAML.

## 6 — JSON format

JSON files MUST place reserved prefix keys first. JSON does not support
frontmatter, so the first agent-readable key begins at the indexed line:

```json
{
  "$pancreator_section_index": {
    "format": "operator-agent-v1",
    "agent_section_start_line": 11
  },
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
  "$pancreator_section_index": {
    "format": "operator-agent-v1",
    "agent_section_start_line": 7
  },
  "$operator": "⚙️ no human content",
  "state": {}
}
```

JSON consumers that validate closed schemas MUST either whitelist the two
reserved keys or defer migration until the consumer can strip them before
schema validation.

## 7 — Write rules

Authors and agents MUST follow these rules when creating or editing sectioned files:

- The human/operator section MUST be the first content humans see in Markdown and YAML files.
- The section index frontmatter MUST follow the operator section and use normal `---` fence sizing.
- **Why it matters** MUST be a true plain-language summary for human operators. It MUST NOT
  copy persona `description` fields, RFC 2119 contract prose, or truncated machine text.
- The agent section MUST preserve any canonical schema, frontmatter, and
  machine-readable content required by existing tooling.
- The operator section MUST summarize; it MUST NOT contain unique requirements,
  acceptance criteria, or validation facts absent from the agent section.
- Related files in **See also** SHOULD be repo-relative paths and SHOULD avoid
  broad directories unless the whole directory is the related surface.
- Files under `.cursor/` MUST remain unsectioned projections.

## 8 — Migration rule

When editing an unsectioned document or artifact, add the operator/agent split in
the same change unless doing so would break a known parser. If migration is
deferred, record the reason in the output manifest or delivery report.

For parser-sensitive files, prefer this sequence:

1. Update the parser or schema to strip/allow the reserved prefix.
2. Add the section index and operator section.
3. Verify the original agent payload still parses after slicing at
   `agent_section_start_line`.
