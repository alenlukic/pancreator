import { readFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

/** Reads a JSON or YAML policy file into a plain object tree. */
export async function readPolicyDocument(filePath: string): Promise<unknown> {
  const abs = path.resolve(filePath);
  const raw = await readFile(abs, "utf8");
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    return YAML.parse(raw) as unknown;
  }
  return JSON.parse(raw) as unknown;
}
