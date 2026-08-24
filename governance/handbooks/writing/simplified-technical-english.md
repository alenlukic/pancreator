# Simplified Technical English handbook

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

This handbook defines the writing standard for the artifacts an operator reads. It adapts ASD-STE100 Simplified Technical English, Issue 9, to software delivery records. An agent MUST read its active invocation first. An agent MUST treat this handbook as supporting guidance rather than a replacement task contract.

ASD-STE100 is a controlled natural language published by the Aerospace, Security and Defence Industries Association of Europe. This handbook restates the applicable rules in its own words and cites each source rule by number, in the form `STE 5.1`. It does not reproduce the standard. Read the standard at <https://www.asd-ste100.org> for the full rule text, the examples, and the dictionary.

## Governed artifacts

This standard applies to every durable artifact a run produces for a human to read and act on:

- Operator briefs and workflow-stage narratives.
- Intake, plan, review, QA, investigation, repair, and ship records.
- Pull-request descriptions and release notes.
- Changelog entries.
- The operator-facing summary an agent writes into its stage output.

This standard does not apply to:

- Machine records, invocation cards, delegation cards, and JSON state.
- Source code, code comments, and commit messages.
- Repository documentation under `docs/`, `README.md`, and `governance/`.
- Quoted material, captured command output, and preserved evidence.

An agent MUST NOT rewrite quoted text to satisfy this standard (STE 8.6). Preserve evidence verbatim and write the surrounding explanation in Simplified Technical English.

## Chat reports

A chat report is not a durable artifact. Use plain language and this three-part shape:

1. State the outcome.
2. State the consequence for the operator.
3. State the next action, or state that no action is necessary.

Apply this handbook's sentence and paragraph limits to each chat report.
Keep evidence links close to the statement they support. Do not repeat internal workflow mechanics unless they affect the operator.

## Durable instruction text

This section applies to the durable instruction surfaces of this repository: this handbook, `AGENTS.md`, policies, criteria, skills, personas, and commands. The writing rules below do not apply to them. These rules do.

- Instruction text MUST state the rule, the boundary, or the fact a reader needs.
- Instruction text MUST NOT record the request that produced it, the alternative the author rejected, or the reasoning that produced the wording.
- A reason MAY remain only when it prevents a wrong action that the rule alone invites.
- An agent MUST NOT restate a rule that a nearby heading, list, or named section already carries.
- An agent that revises instruction text MUST delete wording that no longer instructs. Do not add a correction beside it.

## Adoption boundary

ASD-STE100 has two parts. Part 1 gives 53 writing rules. Part 2 gives a controlled dictionary of 875 approved words.

This repository adopts Part 1 as normative. It does not adopt Part 2 as a gate, because the dictionary is licensed content that this repository cannot redistribute. An artifact that conforms to this handbook MUST NOT be described as conformant to ASD-STE100, because full conformance requires the dictionary.

The discipline behind the dictionary is normative even though the word list is not:

- One concept MUST use one term, and that term MUST keep one meaning (STE 1.3, 1.11).
- A term MUST keep one part of speech in the same artifact (STE 1.2).
- Where two words carry the same meaning, an agent MUST choose the simpler word and reuse it (STE 9.4).

RFC 2119 keywords are terms of art in this repository. `SHOULD` and `SHOULD NOT` remain permitted in governance-bearing prose, and this exempts them from the STE preference for `must` (STE 9.2).

## Words and meanings

- An agent MUST choose the shortest word that carries the exact meaning.
- An agent MUST NOT use a word with a meaning narrower or broader than the reader expects (STE 1.3).
- An agent MUST NOT use regional terms, slang, or jargon (STE 1.10).
- An agent MUST NOT use a Latin abbreviation such as `e.g.`, `i.e.`, or `etc.` (STE GR-6). Write `for example`, `that is`, or a complete list.
- An agent MUST NOT use a gender-specific pronoun (STE GR-7). Use `they`, the role name, or a plural noun.
- An agent MUST NOT create a phrasal verb whose meaning differs from its parts (STE 9.3). Write `extinguish`, not `put out`.
- An agent MUST use American English spelling (STE 1.14).

Use these substitutions, which the standard lists as the most frequent writer errors:

| Do not write             | Write             |
| ------------------------ | ----------------- |
| ensure                   | make sure         |
| perform, execute         | do, run           |
| utilize, leverage        | use               |
| acceptable               | permitted         |
| follow (instructions)    | obey              |
| prior to                 | before            |
| subsequent to, following | after             |
| in order to              | to                |
| shall                    | must              |
| may (permission)         | can               |
| therefore                | thus, as a result |
| attempt                  | try               |
| terminate                | stop, end         |
| commence, initiate       | start             |
| approximately            | about             |
| additional               | more              |
| sufficient               | enough            |
| require                  | need              |
| indicate                 | show              |
| assist                   | help              |
| obtain                   | get               |
| modify                   | change            |
| verify                   | check, make sure  |

### Domain terms

A software artifact needs terms the dictionary does not contain. STE calls these technical nouns and technical verbs, and permits them under defined conditions (STE 1.5, 1.12).

- An agent MAY use a domain term when the term names a concept in this repository or its target repository (STE 1.5).
- An agent MUST prefer the repository's established term over a new one (STE 1.8). `AGENTS.md`, the target-repo primer, and the brief semantic registry are the authoritative sources.
- An agent MUST NOT invent a second term for a concept that already has one (STE 1.11).
- A new domain term MUST use three words or fewer (STE 1.9).
- An agent MUST NOT use a domain noun as a verb (STE 1.7). Write `Put a clamp on the cable`, not `Clamp the cable`.
- An agent MUST prefer an ordinary verb over a domain verb when the ordinary verb is exact (STE 1.12).

Identifiers, file paths, commands, flags, policy identifiers, persona names, and stage slugs are domain terms. An agent MUST write them exactly as they appear in the repository.

## Multi-word nouns

- A noun group MUST use three words or fewer (STE 2.1).
- Hyphenated words count as one word in a noun group (STE 8.7).
- An agent MUST NOT join more than three words with hyphens (STE 2.2).
- When a term needs more than three words, an agent MUST write it in full once, then use a shorter form (STE 2.2).
- An agent SHOULD break a long noun group with a preposition such as `of`, `for`, `in`, or `on`.

Write `the gate for the review stage`, not `the review stage gate configuration value`.

## Verbs

An agent MUST use only these six verb forms (STE 3.2):

- The infinitive form.
- The imperative form.
- The simple present tense.
- The simple past tense.
- The simple future tense.
- The past participle form, used as an adjective.

The following rules apply to every governed artifact:

- An agent MUST NOT write the present perfect, the past perfect, or a progressive tense (STE 3.2, 3.4). Write `The gate failed`, not `The gate has failed`.
- An agent MUST NOT build a complex construction with an auxiliary verb (STE 3.4). Write `The operator must approve the release`, not `The release is to be approved`.
- An agent MUST use the active voice (STE 3.6). Name the actor and put it first.
- An agent MAY use the passive voice only in explanation, and only when the actor is unknown (STE 3.6). To test a sentence, ask `by whom or by what?`.
- An agent MUST NOT use an `-ing` form except inside a domain term (STE 3.5). `Troubleshooting`, `a polling loop`, and `the packaging step` are permitted. `The gate is blocking the run` is not permitted.
- An agent MUST describe an action with a verb rather than a noun (STE 3.7). Write `Before you remove the unit`, not `Before the removal of the unit`.
- An agent MUST use the past participle as an adjective only after `to be`, `to become`, or `to stay`, or before a noun (STE 3.3).

## Sentences

- An agent MUST write short sentences with a clear structure (STE 4.1).
- An agent MUST NOT omit an article, a noun, a verb, or a subject to shorten a sentence (STE 4.2).
- An agent MUST NOT use a contraction (STE 4.2). Write `does not`, not `doesn't`.
- An agent MUST use an article or a demonstrative adjective before a noun, where one applies (STE 4.5).
- An agent MUST NOT put a definite article before a noun that an identifier follows (STE 4.5). Write `policy STE-001`, not `the policy STE-001`.
- An agent MUST connect related sentences with a connecting word such as `and`, `but`, `then`, or `thus` (STE 4.4).
- An agent MUST make every statement single-valued (STE 4.1). Write `Make sure that no test fails`, not `No failures are permitted`.

### Vertical lists

An agent MUST use a vertical list for complex content (STE 4.3). A list MUST obey these rules:

- Put a colon at the end of the lead sentence.
- Start each item with an uppercase letter.
- Mark each item with a number, a letter, a dash, or a bullet.
- End an item with a period only when the item is a full sentence.
- End the last item with a period.
- Do not end an item with a comma or a semicolon.
- Do not mix instructions and explanation in one list.
- Keep every item at the same level.

Each item MUST connect correctly to the lead sentence.

## Operator instructions

An instruction tells the operator to do something. Next actions, remediation steps, and reproduction steps are instructions.

- A sentence MUST use 20 words or fewer (STE 5.1).
- A sentence MUST give one instruction, unless two actions happen at the same time (STE 5.2).
- An agent MUST write an instruction in the imperative form (STE 5.3). Write `Run ./bin/pan validate`, not `The validate command should be run`.
- An agent MUST NOT use the passive voice in an instruction (STE 3.6).
- An agent MUST NOT write `must` before an imperative verb, unless the instruction carries risk (STE 5.3).
- When the operator must know a condition first, an agent MUST state the condition, then a comma, then the command (STE 5.4). Write `When the gate fails, run the repair command`.
- An agent MUST show the order of steps with numbers.

## Explanation and narrative

Explanation gives information rather than instructions. Findings, outcomes, rationale, and risk analysis are explanation.

- A sentence MUST use 25 words or fewer (STE 6.3).
- An agent MUST NOT use the imperative form in explanation (STE 6.1).
- A sentence MUST carry one topic (STE 4.1, 6.1).
- A paragraph MUST carry one topic (STE 6.5).
- A paragraph MUST start with a topic sentence that names its topic (STE 6.4).
- A paragraph MUST use six sentences or fewer (STE 6.6). Divide a longer paragraph in two.
- An agent MUST give information gradually, in the order the reader needs it (STE 6.1).
- An agent MUST repeat a key term rather than vary it (STE 6.2).

An executive summary is explanation. Applicable artifact policies require the outcome first, and this standard governs how the summary reads.

### Notes

- A note MUST give information only (STE 5.5).
- A note MUST NOT give an instruction, a requirement, or a limit (STE 5.5).
- A sentence in a note MUST use 25 words or fewer (STE 5.5).
- To test a note, read the artifact without it. When the reader can still act correctly, the note is correct. Otherwise, rewrite the content as an instruction (STE 5.5).

## Risk notices

STE reserves `warning` for a risk of injury and `caution` for a risk of damage to objects (STE 7.1). This repository has no physical risk, so it maps the two levels onto operator risk:

- Use **WARNING** for a risk that the operator cannot undo. Data loss, a force push, a published release, and a destructive migration are examples.
- Use **CAUTION** for a risk the operator can undo at a cost. A broken build, a dirty workspace, and a wasted run are examples.
- When both levels apply together, use **WARNING** (STE 7.1).

A risk notice MUST obey these rules:

- Name the risk level first (STE 7.1).
- Start with a clear command or the condition that applies (STE 7.2).
- State what happens when the operator does not obey the notice (STE 7.3).
- Use 20 words or fewer in each sentence, because a notice is an instruction (STE 5.1).
- Repeat a negative command in each list item rather than state it once above the colon (STE 4.3).

## Punctuation and word count

- An agent MUST NOT use a semicolon (STE 8.1). Write two sentences.
- An agent MAY use a hyphen to join directly related words (STE 8.2).
- An agent MAY use parentheses only for a reference, an identifier, a step number, an abbreviation, a singular and plural form together, a short explanation, or an alternative (STE 8.3).

The word limits use the counting rules of the standard. Count these as one word each:

- A number, and a number with its unit (STE 8.6).
- An abbreviation, an acronym, and an initialism (STE 8.6).
- An alphanumeric identifier such as `STE-001` (STE 8.6).
- Quoted text, a formula, and a heading (STE 8.6).
- A proper noun of a person, a group, or an organization (STE 8.6).
- A hyphenated word (STE 8.7).
- Text inside parentheses, counted once in the host sentence (STE 8.5).
- A file path, a command, a flag, and an inline code span, which this repository treats as quoted text (STE 8.6).

Apply these counting rules as well:

- Text inside parentheses also forms its own sentence, and that sentence MUST obey the applicable limit (STE 8.5).
- A colon that introduces a vertical list ends a sentence (STE 8.4).
- Each list item counts as a new sentence and MUST obey the applicable limit (STE 8.4).
- A number that identifies a step or a paragraph does not count (STE 8.6).

## Consistent practice

- An agent MUST use one wording for one recurring situation (STE 9.4). Two correct sentences that alternate still confuse the reader.
- When a word substitution produces a poor sentence, an agent MUST restructure the sentence rather than force the substitution (STE 9.1).
- An agent SHOULD write `that` after a verb such as `make sure` or `show`, to mark the clause boundary (STE GR-1).
- An agent MUST make the referent of `this` explicit (STE GR-4). Write `this gate`, not `this`.
- An agent SHOULD read every sentence that contains `with` again, because `with` is ambiguous (STE GR-2).

## Verification

The standard defines no conformance scheme, and human judgment remains the control (STE General introduction). This repository checks conformance in two ways.

The harness runs a deterministic check on the countable rules. That check reports sentence length, paragraph length, semicolons, contractions, complex verb constructions, Latin abbreviations, gender-specific pronouns, and the substitutions listed above. The check is advisory, so it reports a violation and does not block a stage.

The remaining rules need a reasoning agent. A review gate MUST evaluate terminology consistency, noun-group length, voice, one-topic-per-paragraph, and the correctness of a risk notice. The deterministic check does not test these rules, and a passing check MUST NOT be read as conformance.
