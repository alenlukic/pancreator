import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FeatureId } from "@pancreator/core";
import { stringifyMemoryJson } from "./canonical-json-io.js";

/**
 * Mem0-shaped key-value view over a repository `lib/memory/` tree.
 */
export interface MemoryStore {
  readonly memoryRoot: string;
  get(relativeKey: string): Promise<string | undefined>;
  set(relativeKey: string, value: string): Promise<void>;
  remove(relativeKey: string): Promise<void>;
  listKeys(relativePrefix: string): Promise<string[]>;
}

function assertSafeRelativeKey(relativeKey: string): void {
  const norm = path.posix.normalize(relativeKey.split(path.sep).join("/"));
  if (norm.startsWith("..") || path.isAbsolute(norm)) {
    throw new Error("MemoryStore key MUST stay within the memory root");
  }
}

/**
 * The system SHALL read and write UTF-8 text at keys under a single memory root.
 */
export class FileMemoryStore implements MemoryStore {
  readonly memoryRoot: string;

  /**
   * @param memoryRoot - Absolute path to the repository `lib/memory/` directory.
   */
  constructor(memoryRoot: string) {
    this.memoryRoot = path.resolve(memoryRoot);
  }

  private resolveKey(relativeKey: string): string {
    assertSafeRelativeKey(relativeKey);
    return path.join(this.memoryRoot, ...relativeKey.split("/"));
  }

  async get(relativeKey: string): Promise<string | undefined> {
    const full = this.resolveKey(relativeKey);
    try {
      return await readFile(full, "utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return undefined;
      }
      throw e;
    }
  }

  async set(relativeKey: string, value: string): Promise<void> {
    const full = this.resolveKey(relativeKey);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, value, "utf8");
  }

  async remove(relativeKey: string): Promise<void> {
    const full = this.resolveKey(relativeKey);
    try {
      await unlink(full);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return;
      }
      throw e;
    }
  }

  async listKeys(relativePrefix: string): Promise<string[]> {
    assertSafeRelativeKey(relativePrefix);
    const prefixSegs = relativePrefix.split("/").filter(Boolean);
    const base = path.join(this.memoryRoot, ...prefixSegs);
    const keys: string[] = [];
    async function walk(dir: string, relFromRoot: string): Promise<void> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          return;
        }
        throw e;
      }
      for (const name of names) {
        const rel = relFromRoot ? `${relFromRoot}/${name}` : name;
        const abs = path.join(dir, name);
        const st = await stat(abs);
        if (st.isDirectory()) {
          await walk(abs, rel);
        } else {
          keys.push(rel.split(path.sep).join("/"));
        }
      }
    }
    try {
      const st = await stat(base);
      if (st.isFile()) {
        return [prefixSegs.join("/")];
      }
      if (st.isDirectory()) {
        const relBase = prefixSegs.join("/");
        await walk(base, relBase);
        return keys.sort();
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return [];
      }
      throw e;
    }
    return keys.sort();
  }

  private async resolveFeatureIndexKey(id: FeatureId): Promise<string | undefined> {
    const rootRaw = await this.get("features/index.json");
    if (rootRaw !== undefined) {
      try {
        const root = JSON.parse(rootRaw) as unknown;
        const categories =
          root !== null && typeof root === "object" && "categories" in root
            ? (root as { categories?: unknown }).categories
            : undefined;
        if (Array.isArray(categories)) {
          for (const category of categories) {
            if (category === null || typeof category !== "object" || !("features" in category)) {
              continue;
            }
            const features = (category as { features?: unknown }).features;
            if (!Array.isArray(features)) {
              continue;
            }
            const match = features.find(
              (feature) =>
                feature !== null &&
                typeof feature === "object" &&
                (feature as { feature_id?: unknown }).feature_id === id &&
                typeof (feature as { path?: unknown }).path === "string",
            ) as { path?: string } | undefined;
            if (match?.path !== undefined) {
              const rel = match.path.replace(/^lib\/memory\//, "");
              assertSafeRelativeKey(rel);
              return rel;
            }
          }
        }
      } catch {
        // Fall through to direct and scanned lookup for partially migrated repos.
      }
    }

    const direct = `features/${id}/index.json`;
    if ((await this.get(direct)) !== undefined) {
      return direct;
    }

    const indexKeys = (await this.listKeys("features")).filter((key) => key.endsWith("/index.json"));
    for (const key of indexKeys) {
      const raw = await this.get(key);
      if (raw === undefined) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          (parsed as { feature_id?: unknown }).feature_id === id
        ) {
          return key;
        }
      } catch {
        // Ignore malformed feature indexes during fallback scanning.
      }
    }

    return undefined;
  }

  /**
   * The system SHALL read category-aware `lib/memory/features/**/<id>/index.json` when present.
   */
  async readJsonFeatureIndex(id: FeatureId): Promise<unknown | undefined> {
    const rel = await this.resolveFeatureIndexKey(id);
    if (rel === undefined) {
      return undefined;
    }
    const raw = await this.get(rel);
    if (raw === undefined) {
      return undefined;
    }
    return JSON.parse(raw) as unknown;
  }

  /**
   * The system SHALL write feature indexes as formatted JSON, preserving category-aware paths.
   */
  async writeJsonFeatureIndex(id: FeatureId, value: unknown): Promise<void> {
    const rel = (await this.resolveFeatureIndexKey(id)) ?? `features/uncategorized/${id}/index.json`;
    const text = stringifyMemoryJson(this.memoryRoot, value);
    await this.set(rel, text);
  }
}
