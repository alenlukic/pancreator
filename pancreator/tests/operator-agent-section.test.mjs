import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readOperatorAgentSectionIndex,
  sliceOperatorAgentSection,
  wrapOperatorAgentMarkdown,
} from "../lib/internal/packages/@pancreator/core/dist/index.js";

describe("operator-agent-section", () => {
  it("places operator section before index frontmatter", () => {
    const source = wrapOperatorAgentMarkdown(
      {
        inThisFile: "Persona spec for `adopter`.",
        whyItMatters: "Helps you adopt Pancreator in an existing repo.",
        seeAlso: ["pancreator/lib/memory/handbook/persona-spec.md"],
      },
      `---
name: adopter
description: Agent contract prose.
---
# Adopter
`,
    );
    assert.match(source, /^# Operator section/m);
    assert.ok(source.indexOf("# Operator section") < source.indexOf("pancreator-section-index:"));
    assert.doesNotMatch(source, /# Operator section[\s\S]*?\n---\n---\npancreator-section-index:/);
    assert.match(source, /---\npancreator-section-index:\n[\s\S]*?\nname: adopter/);
    assert.match(sliceOperatorAgentSection(source), /^---\r?\n(?:pancreator-section-index:[\s\S]*?\n)?name: adopter/);
  });

  it("returns unsectioned sources unchanged", () => {
    const source = "---\nname: coder\n---\n# Body\n";
    assert.equal(sliceOperatorAgentSection(source), source);
  });

  it("reads section index after operator section", () => {
    const wrapped = wrapOperatorAgentMarkdown(
      {
        inThisFile: "Demo",
        whyItMatters: "Human summary.",
        seeAlso: ["N/A"],
      },
      "---\ntitle: Demo\n---\n# Body\n",
    );
    const index = readOperatorAgentSectionIndex(wrapped);
    assert.ok(index);
    assert.ok(index.agent_section_start_line > 5);
  });
});
