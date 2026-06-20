/**
 * Helpers for DOC.OPERATOR_AGENT_FORMAT section prefixes.
 * Agents skip the operator block by heading convention; no line index is required.
 */

export interface OperatorAgentOperatorMeta {
  inThisFile: string;
  whyItMatters: string;
  seeAlso?: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n([\s\S]*)$/;

const INDEX_ONLY_FRONTMATTER = /^---\r?\n(?:agent_section_start_line:\s*\d+\s*\n|pancreator-section-index:[\s\S]*?)---\r?\n/;

function stripYamlCommentPrefix(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("# ")) {
    return trimmed.slice(2);
  }
  if (trimmed.startsWith("#")) {
    return trimmed.slice(1).trimStart();
  }
  return line;
}

function isOperatorLine(line: string): boolean {
  const content = stripYamlCommentPrefix(line);
  return (
    content.startsWith("- 👀 **In this file:**") ||
    content.startsWith("- ⚖️ **Why it matters:**") ||
    content.startsWith("- 🧭 **See also:**") ||
    content.startsWith("  - ")
  );
}

function isNoHumanContentBanner(source: string): boolean {
  const trimmed = source.replace(/^\uFEFF/, "").trimStart();
  return trimmed.startsWith("⚙️ no human content") || trimmed.startsWith("# ⚙️ no human content");
}

function stripIndexArtifacts(source: string): string {
  return source
    .replace(/<!--\s*pancreator-section-index[\s\S]*?-->\n?/gm, "")
    .replace(/<!--\s*agent_section_start_line:\s*\d+\s*-->\n?/gm, "")
    .replace(INDEX_ONLY_FRONTMATTER, "");
}

function peelLeadingFrontmatter(source: string): { frontmatter: string; rest: string } | null {
  const match = source.match(FRONTMATTER);
  if (!match) {
    return null;
  }
  let frontmatter = stripOperatorAgentIndexFromFrontmatter(match[1] ?? "");
  frontmatter = stripFrontmatterTitle(frontmatter);
  if (frontmatter.length === 0) {
    return null;
  }
  return {
    frontmatter: `---\n${frontmatter}\n---`,
    rest: (match[2] ?? "").replace(/^\uFEFF/, "").trimStart(),
  };
}

function skipOperatorPrefix(source: string): string | null {
  const trimmed = source.replace(/^\uFEFF/, "").trimStart();
  if (isNoHumanContentBanner(trimmed)) {
    const lines = trimmed.split(/\r?\n/);
    let i = 1;
    while (i < lines.length && (lines[i] ?? "").trim() === "") {
      i++;
    }
    return stripIndexArtifacts(lines.slice(i).join("\n"));
  }
  if (!trimmed.startsWith("# Operator section")) {
    return null;
  }
  const lines = trimmed.split(/\r?\n/);
  let i = 1;
  while (i < lines.length && isOperatorLine(lines[i] ?? "")) {
    i++;
  }
  while (i < lines.length && (lines[i] ?? "").trim() === "") {
    i++;
  }
  return stripIndexArtifacts(lines.slice(i).join("\n"));
}

function operatorPrefixEndLine(source: string): number {
  const trimmed = source.replace(/^\uFEFF/, "").trimStart();
  if (isNoHumanContentBanner(trimmed)) {
    let end = 1;
    const lines = trimmed.split(/\r?\n/);
    while (end < lines.length && (lines[end] ?? "").trim() === "") {
      end++;
    }
    return end;
  }
  if (!trimmed.startsWith("# Operator section")) {
    return 0;
  }
  const lines = trimmed.split(/\r?\n/);
  let end = 1;
  while (end < lines.length && isOperatorLine(lines[end] ?? "")) {
    end++;
  }
  while (end < lines.length && (lines[end] ?? "").trim() === "") {
    end++;
  }
  return end;
}

/** Removes index keys from frontmatter text (flat or legacy nested). */
export function stripOperatorAgentIndexFromFrontmatter(yamlBlock: string): string {
  const lines = yamlBlock.replace(/^\uFEFF/, "").split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^agent_section_start_line:\s*\d+\s*$/.test(line)) {
      continue;
    }
    if (line.startsWith("pancreator-section-index:")) {
      while (i + 1 < lines.length && /^\s/.test(lines[i + 1] ?? "")) {
        i++;
      }
      continue;
    }
    if (/^\s*format:\s*operator-agent-v1\s*$/.test(line)) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trimEnd();
}

/**
 * Splits a sectioned source into operator prefix and agent body.
 * Returns null when the source is not operator-prefixed.
 */
export function splitOperatorAgentSection(
  source: string,
): { operatorPrefix: string; agentBody: string } | null {
  const peeled = peelLeadingFrontmatter(source.replace(/^\uFEFF/, "").trimStart());
  const content = peeled?.rest ?? source.replace(/^\uFEFF/, "").trimStart();
  if (!content.startsWith("# Operator section") && !isNoHumanContentBanner(content)) {
    return null;
  }
  const agentBody = sliceOperatorAgentSection(source);
  const lines = content.split(/\r?\n/);
  return {
    operatorPrefix: lines.slice(0, operatorPrefixEndLine(content)).join("\n"),
    agentBody,
  };
}

/**
 * Skips `# Operator section` (and its bullets) or a `⚙️ no human content` banner.
 * When YAML frontmatter leads the file, it is preserved in the agent slice.
 * Unsectioned input is returned unchanged.
 */
export function sliceOperatorAgentSection(source: string): string {
  const normalized = source.replace(/^\uFEFF/, "").trimStart();
  const peeled = peelLeadingFrontmatter(normalized);
  const leadingFrontmatter = peeled?.frontmatter ?? "";
  const afterFrontmatter = peeled?.rest ?? normalized;

  const tail = skipOperatorPrefix(afterFrontmatter);
  if (tail === null) {
    return source;
  }

  if (leadingFrontmatter.length === 0) {
    return tail;
  }
  return `${leadingFrontmatter}\n${tail}`;
}

/**
 * Removes reserved operator prefix keys from parsed JSON payloads.
 */
export function stripOperatorAgentJsonPrefix(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (
    !("$operator" in record) &&
    !("$pancreator_section_index" in record) &&
    !("$agent_section_start_line" in record)
  ) {
    return value;
  }
  const rest = { ...record };
  delete rest.$pancreator_section_index;
  delete rest.$agent_section_start_line;
  delete rest.$operator;
  return rest;
}

/**
 * Parses JSON text and returns the agent payload without operator prefix keys.
 */
export function parseOperatorAgentJsonText(text: string): unknown {
  return stripOperatorAgentJsonPrefix(JSON.parse(text) as unknown);
}

/** Removes legacy `title:` from agent frontmatter; the markdown H1 is canonical. */
export function stripFrontmatterTitle(yamlBlock: string): string {
  return yamlBlock
    .split(/\r?\n/)
    .filter((line) => !/^title:\s/.test(line))
    .join("\n")
    .trimEnd();
}

function normalizeAgentBodyForWrap(agentBody: string): string {
  let body = stripIndexArtifacts(agentBody.replace(/^\uFEFF/, "").trimStart());
  while (body.startsWith("---\n---\n")) {
    body = body.slice(4);
  }
  const fmMatch = body.match(FRONTMATTER);
  if (!fmMatch) {
    return body;
  }
  let frontmatter = stripOperatorAgentIndexFromFrontmatter(fmMatch[1] ?? "");
  frontmatter = stripFrontmatterTitle(frontmatter);
  if (frontmatter.length === 0) {
    return (fmMatch[2] ?? "").replace(/^\uFEFF/, "").trimStart();
  }
  const closeFence = /\n\.\.\.\r?\n/u.test(fmMatch[0] ?? "") ? "..." : "---";
  return `---\n${frontmatter}\n${closeFence}\n${fmMatch[2] ?? ""}`;
}

function buildOperatorBlock(meta: OperatorAgentOperatorMeta): string[] {
  const seeAlsoLines =
    meta.seeAlso !== undefined && meta.seeAlso.length > 0
      ? ["- 🧭 **See also:**", ...meta.seeAlso.map((item) => `  - ${item}`)]
      : ["- 🧭 **See also:** N/A"];
  return [
    "# Operator section",
    `- 👀 **In this file:** ${meta.inThisFile}`,
    `- ⚖️ **Why it matters:** ${meta.whyItMatters}`,
    ...seeAlsoLines,
  ];
}

/**
 * Wraps Markdown: line-1 frontmatter when present, operator section, then body.
 * Frontmatter MUST NOT follow the operator section; mid-file fences break preview sizing.
 */
export function wrapOperatorAgentMarkdown(
  meta: OperatorAgentOperatorMeta,
  agentBody: string,
): string {
  const split = splitOperatorAgentSection(agentBody);
  const normalizedAgent = normalizeAgentBodyForWrap(split?.agentBody ?? agentBody);
  const operatorText = buildOperatorBlock(meta).join("\n");
  const fmMatch = normalizedAgent.match(FRONTMATTER);
  if (fmMatch) {
    const frontmatter = fmMatch[1] ?? "";
    const body = (fmMatch[2] ?? "").replace(/^\uFEFF/, "").trimStart();
    const closeFence = /\n\.\.\.\r?\n/u.test(fmMatch[0] ?? "") ? "..." : "---";
    return `---\n${frontmatter}\n${closeFence}\n\n${operatorText}\n\n${body}`;
  }
  return `${operatorText}\n${normalizedAgent}`;
}

function buildYamlOperatorBlock(meta: OperatorAgentOperatorMeta): string {
  const lines = buildOperatorBlock(meta);
  return [
    lines[0] ?? "# Operator section",
    ...lines.slice(1).map((line) => `# ${line}`),
  ].join("\n");
}

/** Wraps raw YAML: commented operator section, then agent payload. */
export function wrapOperatorAgentYaml(
  meta: OperatorAgentOperatorMeta,
  agentBody: string,
): string {
  const body = stripIndexArtifacts(agentBody.replace(/^\uFEFF/, "").trimStart());
  return `${buildYamlOperatorBlock(meta)}\n${body}`;
}

/**
 * Wraps a JSON object with a `$operator` summary prefix key.
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
  return { $operator, ...payload };
}
