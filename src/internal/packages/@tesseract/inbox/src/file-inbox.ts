import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Bidirectional queue access for `/src/inbox/in/`, `/src/inbox/out/`, and `/src/inbox/threads/`
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
 * The system SHALL resolve child paths under `src/inbox/` without allowing `..`
 * segments in logical names.
 */
export class FileInbox implements Inbox {
  readonly inboxRoot: string;

  /**
   * @param repositoryRoot - Absolute path to the repository root that contains `src/inbox/`.
   */
  constructor(repositoryRoot: string) {
    this.inboxRoot = path.join(path.resolve(repositoryRoot), "src", "inbox");
  }

  pathIn(filename = ""): string {
    return path.join(this.inboxRoot, "in", filename);
  }

  pathOut(filename = ""): string {
    return path.join(this.inboxRoot, "out", filename);
  }

  pathThreads(filename = ""): string {
    return path.join(this.inboxRoot, "threads", filename);
  }

  private assertBasename(name: string): void {
    const b = path.basename(name);
    if (b !== name || name.includes("..") || name.includes("/") || name.includes("\\")) {
      throw new Error("Inbox file name MUST be a single path segment");
    }
  }

  async listIn(): Promise<string[]> {
    const dir = this.pathIn();
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return [];
      }
      throw e;
    }
    return names.filter((n) => !n.startsWith(".")).sort();
  }

  async readInFile(name: string): Promise<string> {
    this.assertBasename(name);
    return readFile(this.pathIn(name), "utf8");
  }

  async writeOutFile(name: string, content: string): Promise<void> {
    this.assertBasename(name);
    const p = this.pathOut(name);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content, "utf8");
  }
}
