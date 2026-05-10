import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The system SHALL resolve dual-anchor `path` values that start at the repository
 * root (for example `/memory/handbook/glossary.md` and `/AGENTS.md`) to UTF-8
 * file bodies.
 */
export function readUtf8ForDualAnchor(
  repositoryRoot: string,
): (path: string) => Promise<string | undefined> {
  const absRoot = path.resolve(repositoryRoot);
  return async (filePath: string) => {
    const rel = filePath.replace(/^\//, "");
    const abs = path.resolve(absRoot, rel);
    const guard = path.resolve(absRoot);
    if (abs !== guard && !abs.startsWith(guard + path.sep)) {
      return undefined;
    }
    try {
      return await readFile(abs, "utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return undefined;
      }
      throw e;
    }
  };
}
