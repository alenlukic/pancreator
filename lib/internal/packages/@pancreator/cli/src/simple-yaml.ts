function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?\d+$/u.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function lineIndent(line: string): number {
  const match = /^(\s*)/u.exec(line);
  return match ? match[1]!.length : 0;
}

function parseBlock(lines: string[], startIndex: number, indent: number): { value: Record<string, unknown>; nextIndex: number } {
  const result: Record<string, unknown> = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      index += 1;
      continue;
    }

    const currentIndent = lineIndent(line);
    if (currentIndent < indent) break;

    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(trimmed);
    if (!kv) {
      index += 1;
      continue;
    }

    const [, key, rest] = kv;
    if (rest === "") {
      const childIndent = index + 1 < lines.length ? lineIndent(lines[index + 1]!) : indent + 2;
      const nested = parseBlock(lines, index + 1, childIndent);
      result[key!] = nested.value;
      index = nested.nextIndex;
      continue;
    }

    result[key!] = parseScalar(rest);
    index += 1;
  }

  return { value: result, nextIndex: index };
}

export function parseSimpleYaml(source: string): Record<string, unknown> {
  const lines = source.split(/\r?\n/u);
  return parseBlock(lines, 0, 0).value;
}
