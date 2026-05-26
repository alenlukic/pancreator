import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { emitCursorAgentsMirror, emitMdcShim, emitPersonaMarkdown } from "./emit.js";
import { parsePersonaMarkdown } from "./parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "../../../../../../");
const TECH_WRITER = join(REPO_ROOT, "src", "personas", "tech-writer.md");

describe("tech-writer round-trip", () => {
  it("parse → emit → re-parse yields an equivalent frontmatter map and same body", () => {
    const original = readFileSync(TECH_WRITER, "utf8");
    const first = parsePersonaMarkdown(original);
    const emitted = emitPersonaMarkdown(first.frontmatter, first.body);
    const second = parsePersonaMarkdown(emitted);

    expect(second.frontmatter).toEqual(first.frontmatter);
    expect(first.body).toBe(second.body);
    expect(first.spec.name).toBe("tech-writer");
  });

  it("emitMdcShim re-parses description from spec", () => {
    const original = readFileSync(TECH_WRITER, "utf8");
    const { spec } = parsePersonaMarkdown(original);
    const mdc = emitMdcShim(spec);
    const m = mdc.match(/^---\n([\s\S]*?)\n---\n\n@src\/personas\/([^\n]+)\.md\n$/);
    expect(m).not.toBeNull();
    const y = parseYaml(m![1] ?? "") as { description: string; globs: string[]; alwaysApply: boolean };
    expect(y.description).toBe(spec.description);
    expect(y.alwaysApply).toBe(false);
    expect(y.globs).toEqual(["src/personas/tech-writer.md"]);
  });

  it("emitCursorAgentsMirror matches emitPersonaMarkdown for the mirror file", () => {
    const original = readFileSync(TECH_WRITER, "utf8");
    const p = parsePersonaMarkdown(original);
    expect(emitCursorAgentsMirror(p.frontmatter, p.body)).toBe(emitPersonaMarkdown(p.frontmatter, p.body));
  });
});
