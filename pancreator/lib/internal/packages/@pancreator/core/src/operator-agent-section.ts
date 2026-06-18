/**
 * Helpers for DOC.OPERATOR_AGENT_FORMAT section prefixes.
 * Consumers slice agent-readable payload at `agent_section_start_line` (1-indexed).
 */

export interface OperatorAgentOperatorMeta {
  inThisFile: string;
  whyItMatters: string;
  seeAlso?: string[];
}

export interface OperatorAgentSectionIndex {
  format: "operator-agent-v1";
  agent_section_start_line: number;
}

const SECTION_INDEX_LINE =
  /^\s*agent_section_start_line:\s*(?<line>\d+)\s*$/m;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

const INDEX_COMMENT_LINE_COUNT = 4;

function buildIndexYaml(startLine: number): string {
  return [
    "pancreator-section-index:",
    "  format: operator-agent-v1",
    `  agent_section_start_line: ${startLine}`,
  ].join("\n");
}

function buildIndexComment(startLine: number): string {
  return [
    "<!-- pancreator-section-index",
    "format: operator-agent-v1",
    `agent_section_start_line: ${startLine}`,
    "-->",
  ].join("\n");
}

/** Removes a legacy separate index block or index keys from frontmatter text. */
export function stripOperatorAgentIndexFromFrontmatter(yamlBlock: string): string {
  const lines = yamlBlock.replace(/^\uFEFF/, "").split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("pancreator-section-index:")) {
      while (i + 1 < lines.length && /^\s/.test(lines[i + 1] ?? "")) {
        i++;
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trimEnd();
}

function hasSectionIndexMarker(source: string): boolean {
  return (
    source.includes("pancreator-section-index:") ||
    source.includes("<!-- pancreator-section-index")
  );
}

/**
 * Returns the section index when the source begins with an operator-agent prefix.
 */
export function readOperatorAgentSectionIndex(source: string): OperatorAgentSectionIndex | null {
  const trimmed = source.replace(/^\uFEFF/, "");
  if (hasSectionIndexMarker(trimmed) && trimmed.includes("format: operator-agent-v1")) {
    const match = SECTION_INDEX_LINE.exec(trimmed);
    if (match?.groups?.line) {
      const agentSectionStartLine = Number.parseInt(match.groups.line, 10);
      if (Number.isFinite(agentSectionStartLine) && agentSectionStartLine >= 1) {
        return {
          format: "operator-agent-v1",
          agent_section_start_line: agentSectionStartLine,
        };
      }
    }
  }
  if (!trimmed.startsWith("---")) {
    return null;
  }
  const firstClose = findLine(trimmed, "---", 1);
  if (firstClose < 0) {
    return null;
  }
  const header = trimmed.slice(0, firstClose);
  if (!header.includes("pancreator-section-index:")) {
    return null;
  }
  if (!header.includes("format: operator-agent-v1")) {
    return null;
  }
  const match = SECTION_INDEX_LINE.exec(header);
  if (!match?.groups?.line) {
    return null;
  }
  const agentSectionStartLine = Number.parseInt(match.groups.line, 10);
  if (!Number.isFinite(agentSectionStartLine) || agentSectionStartLine < 1) {
    return null;
  }
  return {
    format: "operator-agent-v1",
    agent_section_start_line: agentSectionStartLine,
  };
}

/**
 * Returns the agent-readable slice of a sectioned Markdown or YAML file.
 * Unsectioned input is returned unchanged.
 */
export function sliceOperatorAgentSection(source: string): string {
  const index = readOperatorAgentSectionIndex(source);
  if (!index) {
    return source;
  }
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  return lines.slice(index.agent_section_start_line - 1).join("\n");
}

/**
 * Removes `$pancreator_section_index` and `$operator` from parsed JSON payloads.
 */
export function stripOperatorAgentJsonPrefix(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (!("$pancreator_section_index" in record)) {
    return value;
  }
  const rest = { ...record };
  delete rest.$pancreator_section_index;
  delete rest.$operator;
  return rest;
}

/**
 * Parses JSON text and returns the agent payload without operator prefix keys.
 */
export function parseOperatorAgentJsonText(text: string): unknown {
  return stripOperatorAgentJsonPrefix(JSON.parse(text) as unknown);
}

/**
 * Wraps Markdown agent content: operator section first, then a single agent frontmatter
 * block (index keys merged in) or an HTML index comment for unfenced YAML/Markdown bodies.
 */
export function wrapOperatorAgentMarkdown(
  meta: OperatorAgentOperatorMeta,
  agentBody: string,
): string {
  const normalizedAgent = agentBody.replace(/^\uFEFF/, "").trimStart();
  const seeAlsoLines =
    meta.seeAlso !== undefined && meta.seeAlso.length > 0
      ? ["- 🧭 **See also:**", ...meta.seeAlso.map((item) => `  - ${item}`)]
      : ["- 🧭 **See also:** N/A"];
  const operatorBlock = [
    "# Operator section",
    `- 👀 **In this file:** ${meta.inThisFile}`,
    `- ⚖️ **Why it matters:** ${meta.whyItMatters}`,
    ...seeAlsoLines,
  ];
  const operatorText = operatorBlock.join("\n");

  const fmMatch = normalizedAgent.match(FRONTMATTER);
  if (fmMatch) {
    const agentStartLine = operatorBlock.length + 1;
    const indexYaml = buildIndexYaml(agentStartLine);
    const cleanFrontmatter = stripOperatorAgentIndexFromFrontmatter(fmMatch[1] ?? "");
    const mergedAgent = `---\n${indexYaml}\n${cleanFrontmatter}\n---\n${fmMatch[2] ?? ""}`;
    return `${operatorText}\n${mergedAgent}`;
  }

  const agentStartLine = operatorBlock.length + INDEX_COMMENT_LINE_COUNT + 1;
  const indexComment = buildIndexComment(agentStartLine);
  return `${operatorText}\n${indexComment}\n${normalizedAgent}`;
}

function computeJsonAgentStartLine(text: string, firstAgentKey: string): number {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes(`"${firstAgentKey}"`)) {
      return i + 1;
    }
  }
  return lines.length;
}

/**
 * Wraps a JSON object with `$pancreator_section_index` and `$operator` prefix keys.
 */
export function wrapOperatorAgentJson(
  meta: OperatorAgentOperatorMeta,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const $operator =
    meta.seeAlso !== undefined && meta.seeAlso.length > 0
      ? {
          in_this_file: meta.inThisFile,
          why_it_matters: meta.whyItMatters,
          see_also: meta.seeAlso,
        }
      : {
          in_this_file: meta.inThisFile,
          why_it_matters: meta.whyItMatters,
          see_also: ["N/A"],
        };
  const firstAgentKey = Object.keys(payload)[0] ?? "state";
  let wrapped: Record<string, unknown> = {
    $pancreator_section_index: {
      format: "operator-agent-v1",
      agent_section_start_line: 1,
    },
    $operator,
    ...payload,
  };
  const line = computeJsonAgentStartLine(JSON.stringify(wrapped, null, 2), firstAgentKey);
  wrapped = {
    $pancreator_section_index: {
      format: "operator-agent-v1",
      agent_section_start_line: line,
    },
    $operator,
    ...payload,
  };
  return wrapped;
}

function findLine(source: string, needle: string, skip: number): number {
  const lines = source.split(/\r?\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === needle) {
      if (seen >= skip) {
        return lines.slice(0, i + 1).join("\n").length + (source.includes("\r\n") ? 2 : 1);
      }
      seen++;
    }
  }
  return -1;
}
