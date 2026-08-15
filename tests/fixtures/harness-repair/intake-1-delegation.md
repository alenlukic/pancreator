Persona: `intake-writer`.

Your complete contract for stage `intake` is one file. Read that file before any other work.

- Contract: `runtime/logs/workflows/63327_Aug-13-0394_5de7203f/invocations/13_intake-1_50e59c78.md`
- Digest: `sha256:c3115ed24881da8f36a6a3bb1bba8ad96d6e990829a51c9c2b6386fb6136a459`
- Size: 334 lines, 34989 bytes
- Sections: 17 (16 bind you)

## How to read the contract

1. Read `runtime/logs/workflows/63327_Aug-13-0394_5de7203f/invocations/13_intake-1_50e59c78.md` in full, from line 1 to line 334.
2. Compare the digest of that file with the digest above.
3. Read no other repository context before the contract.
4. When the file is unreadable, or the digest differs, stop and report a reference failure.

## Contract sections

The list below is complete and flat. A `worker` section binds you. A `supervisor` section addresses the supervisor, and you must ignore it.

| Section id | Heading | Owner | Lines | Digest |
| --- | --- | --- | --- | --- |
| `001-preamble` | Preamble | worker | 6 | `e3aec530bb06a9fa6bcc0f60a43a3b9b84fa0de38cae3a6b3e13c8881cea46ae` |
| `002-operator-view` | ## Operator view | worker | 6 | `091283f560ff3709fcff738139c6237f1062ff89469ace8182f3a4b6a3ef90fd` |
| `003-task` | ## 📋 Task | worker | 2 | `d752b77e55389b860127d25575530c577786de952c9fc0e6467d1bf02e4c0b47` |
| `004-objective` | ## Objective | worker | 5 | `e9275bd6f87c61b37ca596b95d922130ac20d3cedcbdb2ff1cd1be655186cbbb` |
| `005-steps` | ## Steps | worker | 9 | `890c01e2394700bae497014c9150003972ef664f5418652c11ed30d660b0cc17` |
| `006-output` | ## Output | worker | 7 | `9eaecada0a44d3c286ef7d4dec4499a9ae6bcb9ed9404c5d4146f12020870775` |
| `007-done-when` | ## Done when | worker | 5 | `7eb88b82a9c6bc6370c2562199c230532a87472aebaec02e6a6d0a78e1a86bf5` |
| `008-inputs` | ## 📥 Inputs | worker | 6 | `131bb92413c0eb51d20bb17905a08cc09d8e8401a8e609af74153f9360c8fa0f` |
| `009-policies-in-force` | ## 📜 Policies in force | worker | 178 | `ffada69139dcc9019a74216d9f242109eaa427616354e83a1520f2a78a57b8de` |
| `010-agent-validation-requirements` | ## ✅ Agent validation requirements | worker | 6 | `c1e2b3af7688141487b79f0b379b06fb1cbbbb901daef22da52f04f4954f8631` |
| `011-harness-owned-checks` | ## 🧰 Harness-owned checks | worker | 10 | `ad90f0e43dbae26e9c9604465f41d206e64a804fed959a1bc7a67c1aeade3ddc` |
| `012-rubric` | ## 🎯 Rubric | worker | 6 | `9c7cb86d5966d9f5659b199d8ba1ea2d187467ed5c096c1fc9e0abcc1c0b56d1` |
| `013-operator-involvement` | ## 🎚️ Operator involvement | worker | 6 | `c159c60ad6287c190ccc01d99237ed0277ddc05ca6d83ca41d31ae0ffbc738a1` |
| `014-output-contract` | ## 📤 Output contract | worker | 21 | `7404fa44e23c49f54f1b7804591e365695fbdd1f80c2153089a41e11fc0d3d24` |
| `015-boundaries` | ## 🚧 Boundaries | worker | 12 | `f9e8bf67787b9ca9dfbdde4ad666c08152242921208ab90c9d2aac29e0c3b91d` |
| `016-technical-appendix` | ## Technical appendix | worker | 19 | `538210b589ca328701996a44d581e7e09e70cc13f425666e837c921614cc3385` |
| `017-supervisor-delivery-procedure` | ## 🧭 Supervisor delivery procedure | supervisor | 30 | `d9dc38e32fa17d245422921d5ae4969b4de18866170814136bd4dff90707267e` |

Use the list to confirm that your read covered every section that binds you.

## Read attestation

Declare the read in `invocation_attestation` in `runtime/logs/workflows/63327_Aug-13-0394_5de7203f/outputs/13_intake-1_50e59c78.json`:

- Set `invocation_id` to `13_intake-1_50e59c78`.
- Set `contract_path` to `runtime/logs/workflows/63327_Aug-13-0394_5de7203f/invocations/13_intake-1_50e59c78.md`.
- Set `contract_sha256` to `c3115ed24881da8f36a6a3bb1bba8ad96d6e990829a51c9c2b6386fb6136a459`.
- Set `status` to `read` after you read the complete contract.
- Set `sections` to every section id and digest above, in the same order.

The required stage-output scaffold automation prefills these fields with status `pending`. Confirm each value against the list above, correct any difference, and change `pending` to `read` yourself. Submission rejects `pending`, because only you can declare the read.

When you cannot read the contract, set `status` to `reference_failed`, put the concrete read error in `error`, and set the stage `result` to `blocked`. Do not report a product verdict you have no contract for.

## Guidance attestation

The contract references policy guidance instead of inlining it. The scaffold prefills one `invocation_attestation.guidance` entry per reference with status `pending`. Submission rejects `pending`; set each entry yourself:

- `read` after you read the selection from the source file. Digests cover the selection with surrounding whitespace trimmed. When the file no longer matches its digest, read the exact selected bytes from the invocation JSON snapshot and still declare `read`.
- `skipped` with the concrete `reason` when the read trigger does not apply to your task.
- `reference_failed` with the concrete `error` when neither the source file nor the invocation snapshot is readable.

| Policy | Guidance source | Digest |
| --- | --- | --- |
| `STE-001` | `governance/handbooks/writing/simplified-technical-english.md` | `sha256:3839da89804f0bd4f7cf0af8edb38560288fcfc1d95175226f22da561e2caa54` |
