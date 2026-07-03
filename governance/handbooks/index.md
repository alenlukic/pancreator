# Governance handbooks

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Handbooks define durable repository standards. Applicable handbook content MUST be unrolled through policy `guidance_sources` into each invocation card; policies MUST NOT leave agents responsible for separately loading a handbook. An invocation card and its embedded policies and guidance MUST remain the authoritative contract for a specific stage. Agents MUST NOT load unrelated handbooks speculatively.

- [`eng/engineering.md`](eng/engineering.md) defines the language-agnostic engineering baseline.
- [`python/style-guide.md`](python/style-guide.md) defines normative Python engineering and style guidance.
- [`typescript/style-guide.md`](typescript/style-guide.md) defines normative TypeScript and TSX style.
- [`typescript/node.md`](typescript/node.md) defines Node.js runtime and durable-state practices.

A handbook rule SHOULD apply broadly across repository work. Invocation-specific requirements MUST live in policies, workflow stages, or prompts instead. Handbook additions MUST be high-signal and MUST NOT duplicate an existing authoritative rule without a concrete retrieval benefit.
