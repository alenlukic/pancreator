export interface MarkdownHeading {
  level: number
  text: string
  line: number
}

export interface ParsedMarkdown {
  headings: MarkdownHeading[]
  fences: Array<{ language: string; line: number }>
  links: Array<{ text: string; href: string; line: number }>
}

/** Bounded Markdown parser for headings, links, and fenced code blocks. */
export function parseMarkdown(content: string): ParsedMarkdown {
  const lines = content
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
  const headings: MarkdownHeading[] = []
  const fences: Array<{ language: string; line: number }> = []
  const links: Array<{ text: string; href: string; line: number }> = []
  let inFence = false

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1

    if (line.startsWith('```')) {
      if (!inFence) {
        fences.push({ language: line.slice(3).trim(), line: lineNumber })
      }

      inFence = !inFence
      continue
    }

    if (inFence) {
      continue
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/u.exec(line)

    if (headingMatch) {
      headings.push({
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
        line: lineNumber,
      })
    }

    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/gu
    let linkMatch: RegExpExecArray | null

    while ((linkMatch = linkPattern.exec(line)) !== null) {
      links.push({
        text: linkMatch[1],
        href: linkMatch[2],
        line: lineNumber,
      })
    }
  }

  return { headings, fences, links }
}

export function hasHeading(
  parsed: ParsedMarkdown,
  text: string,
  level?: number,
): boolean {
  return parsed.headings.some(
    (heading) =>
      heading.text.toLowerCase().includes(text.toLowerCase()) &&
      (level === undefined || heading.level === level),
  )
}

export function operatorLeadPresent(content: string): boolean {
  const firstLines = content.split('\n').slice(0, 15).join('\n').toLowerCase()

  return (
    (firstLines.includes('**state:**') || firstLines.includes('state:')) &&
    (firstLines.includes('**outcome:**') || firstLines.includes('outcome:')) &&
    (firstLines.includes('**next action:**') ||
      firstLines.includes('next action:'))
  )
}
