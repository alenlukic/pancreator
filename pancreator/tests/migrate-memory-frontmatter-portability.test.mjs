import assert from "node:assert/strict";
import test from "node:test";

import { migrateMemoryFrontmatterContent } from "../lib/internal/tools/migrations/migrate-memory-frontmatter-portability.mjs";

test("migrateMemoryFrontmatterContent flattens references and closes with ...", () => {
  const input = [
    "---",
    "slug: sample",
    "references:",
    "  - kind: file",
    "    path: AGENTS.md",
    '    note: "binding"',
    "related:",
    "  - /AGENTS.md",
    "---",
    "",
    "# Title",
    "",
  ].join("\n");
  const { content, changed } = migrateMemoryFrontmatterContent(input);
  assert.equal(changed, true);
  assert.match(content, /^---\nslug: sample\n/u);
  assert.match(content, /references:\n {2}- '\{"kind":"file","path":"AGENTS.md","note":"binding"\}'/u);
  assert.match(content, /\n\.\.\.\n\n# Title/u);
  assert.doesNotMatch(content, /\n {2}- kind: file/u);
});

test("migrateMemoryFrontmatterContent is idempotent for portable frontmatter", () => {
  const portable = [
    "---",
    "slug: sample",
    "references:",
    '  - \'{"kind":"file","path":"AGENTS.md"}\'',
    "related:",
    "  - /AGENTS.md",
    "...",
    "",
    "# Title",
    "",
  ].join("\n");
  const second = migrateMemoryFrontmatterContent(portable);
  assert.equal(second.changed, false);
  assert.equal(second.content, portable);
});
