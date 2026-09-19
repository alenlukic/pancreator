# Governance handbooks

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Handbooks define durable repository standards. Handbook content reaches an invocation card through a policy's `guidance_sources`: the card carries an audited reference naming the source path, the selected range, a content digest, and a read trigger. `GLOBAL-002` governs when an agent opens a handbook, and `CONTRACT-001` governs where a normative rule belongs.

- [`eng/engineering.md`](eng/engineering.md) defines the language-agnostic engineering baseline.
- [`eng/testing.md`](eng/testing.md) defines the self-development test standard and stable test principles.
- [`horizon/long-horizon.md`](horizon/long-horizon.md) defines the selectable long-horizon mode, its invariants, and its bounded escalation ladder.
- [`writing/simplified-technical-english.md`](writing/simplified-technical-english.md) defines the Simplified Technical English standard for artifacts an operator reads, adapted from ASD-STE100 Issue 9.
- [`design/ux-guide.md`](design/ux-guide.md) defines UI/UX design laws, critique, accessibility, tokens, mock media, and tooling.
- [`python/style-guide.md`](python/style-guide.md) defines normative Python engineering and style guidance.
- [`typescript/style-guide.md`](typescript/style-guide.md) defines normative TypeScript and TSX style.
- [`typescript/node.md`](typescript/node.md) defines Node.js runtime and durable-state practices.

A handbook holds rules that apply broadly across repository work. `CONTRACT-001` states where an invocation-specific requirement belongs and what a handbook addition owes.
