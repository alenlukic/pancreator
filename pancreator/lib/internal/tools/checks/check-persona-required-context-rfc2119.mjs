#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const PERSONAS_DIR = path.join(ROOT, "lib", "personas");
const RFC_2119 = /\b(MUST(?: NOT)?|SHALL(?: NOT)?|SHOULD(?: NOT)?|MAY|OPTIONAL|RECOMMENDED|NOT RECOMMENDED|REQUIRED)\b/u;
const CONTRACT_SECTIONS = [
  "Required context",
  "Responsibilities",
  "Definition of done",
  "Output manifest",
];

function extractSection(markdown, heading) {
  const headingMatch = new RegExp(`^### ${heading}\\s*$`, "imu").exec(markdown);
  if (headingMatch === null) {
    return null;
  }
  const start = headingMatch.index + headingMatch[0].length;
  const rest = markdown.slice(start);
  const nextHeadingIndex = rest.search(/^###\s+/mu);
  const body = nextHeadingIndex < 0 ? rest : rest.slice(0, nextHeadingIndex);
  return body.trim();
}

const violations = [];
for (const entry of fs.readdirSync(PERSONAS_DIR, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".md")) {
    continue;
  }
  const rel = path.posix.join("lib/personas", entry.name);
  const abs = path.join(PERSONAS_DIR, entry.name);
  const markdown = fs.readFileSync(abs, "utf8");
  if (!markdown.includes("Bash(rtk:*)")) {
    violations.push(`${rel}: tools allowlist is missing Bash(rtk:*).`);
  }
  for (const sectionName of CONTRACT_SECTIONS) {
    const section = extractSection(markdown, sectionName);
    if (section === null) {
      violations.push(`${rel}: missing "### ${sectionName}" section in Static execution contract.`);
      continue;
    }
    const lines = section
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));
    for (const line of lines) {
      if (!RFC_2119.test(line)) {
        violations.push(
          `${rel}: ${sectionName} bullet is missing RFC 2119 keyword -> ${line}`,
        );
      }
    }
  }
  const responsibilities = extractSection(markdown, "Responsibilities");
  if (responsibilities !== null && !responsibilities.includes("RTK-first retrieval")) {
    violations.push(
      `${rel}: Responsibilities section must include RTK-first retrieval discipline.`,
    );
  }
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `OK — persona static contract bullets use RFC 2119 and include RTK-first retrieval discipline (${PERSONAS_DIR}).\n`,
);
