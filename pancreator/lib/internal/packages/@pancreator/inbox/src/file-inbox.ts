import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Bidirectional queue access for `/lib/inbox/in/`, `/lib/inbox/out/`, and `/lib/inbox/threads/`
 * (glossary: Inbox).
 */
export interface Inbox {
  readonly inboxRoot: string;
  pathIn(filename?: string): string;
  pathOut(filename?: string): string;
  pathThreads(filename?: string): string;
  listIn(): Promise<string[]>;
  readInFile(name: string): Promise<string>;
  writeOutFile(name: string, content: string): Promise<void>;
}

/**
 * The system SHALL resolve child paths under `lib/inbox/` without allowing `..`
 * segments in logical names.
 */
export class FileInbox implements Inbox {
  readonly inboxRoot: string;

  /**
   * @param repositoryRoot - Absolute path to the repository root that contains `lib/inbox/`.
   */
  constructor(repositoryRoot: string) {
    this.inboxRoot = path.join(path.resolve(repositoryRoot), "lib", "inbox");
  }

  pathIn(filename = ""): string {
    if (filename === "") {
      return path.join(this.inboxRoot, "in");
    }
    return this.resolveUnderQueue("in", filename);
  }

  pathOut(filename = ""): string {
    if (filename === "") {
      return path.join(this.inboxRoot, "out");
    }
    return this.resolveUnderQueue("out", filename);
  }

  pathThreads(filename = ""): string {
    if (filename === "") {
      return path.join(this.inboxRoot, "threads");
    }
    return this.resolveUnderQueue("threads", filename);
  }

  private resolveUnderQueue(
    queue: "in" | "out" | "threads",
    relativePath: string,
  ): string {
    const root = path.join(this.inboxRoot, queue);
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/u, "");
    if (!normalized || normalized.includes("\0")) {
      throw new Error("Inbox relative path MUST be non-empty and valid");
    }
    const segments = normalized.split("/").filter(Boolean);
    for (const s of segments) {
      if (s === ".." || s === ".") {
        throw new Error("Inbox relative path MUST NOT contain dot segments");
      }
    }
    const resolved = path.resolve(root, ...segments);
    const rootResolved = path.resolve(root);
    const rel = path.relative(rootResolved, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Inbox relative path MUST stay under its queue root");
    }
    return resolved;
  }

  async listIn(): Promise<string[]> {
    const dir = this.pathIn();
    return listNestedFiles(dir);
  }

  async readInFile(name: string): Promise<string> {
    return readFile(this.pathIn(name), "utf8");
  }

  async writeOutFile(name: string, content: string): Promise<void> {
    const p = this.pathOut(name);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content, "utf8");
  }
}

async function listNestedFiles(absDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(relPrefix: string, dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return;
      }
      throw e;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) {
        continue;
      }
      const rel = relPrefix === "" ? e.name : `${relPrefix}/${e.name}`;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(rel, abs);
      } else {
        out.push(rel.split(path.sep).join("/"));
      }
    }
  }
  await walk("", absDir);
  return out.sort();
}
