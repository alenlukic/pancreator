# Governance handbooks

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Handbooks define durable repository standards. Applicable handbook content MUST reach each invocation card through policy `guidance_sources`. A card carries an audited reference naming the source path, the selected range, a content digest, and a read trigger. An invocation card, its embedded policies, and the guidance it references MUST remain the authoritative contract for a specific stage. Agents MUST NOT load unrelated handbooks speculatively.

- [`eng/engineering.md`](eng/engineering.md) defines the language-agnostic engineering baseline.
- [`writing/simplified-technical-english.md`](writing/simplified-technical-english.md) defines the Simplified Technical English standard for artifacts an operator reads, adapted from ASD-STE100 Issue 9.
- [`design/ux-guide.md`](design/ux-guide.md) defines UI/UX design laws, critique, accessibility, tokens, mock media, and tooling.
- [`python/style-guide.md`](python/style-guide.md) defines normative Python engineering and style guidance.
- [`typescript/style-guide.md`](typescript/style-guide.md) defines normative TypeScript and TSX style.
- [`typescript/node.md`](typescript/node.md) defines Node.js runtime and durable-state practices.

A handbook rule SHOULD apply broadly across repository work. Invocation-specific requirements MUST live in policies, workflow stages, or prompts instead. Handbook additions MUST be high-signal and MUST NOT duplicate an existing authoritative rule without a concrete retrieval benefit.
