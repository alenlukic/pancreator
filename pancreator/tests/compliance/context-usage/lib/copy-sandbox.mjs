import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { getTaskSpec } from "./tasks.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} dir
 * @returns {number}
 */
function countFiles(dir) {
  let count = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      count += countFiles(full);
    } else if (ent.isFile()) {
      count += 1;
    }
  }
  return count;
}

/**
 * @param {string} src
 * @param {string} dest
 */
function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyRecursive(from, to);
    } else if (ent.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * @param {string} taskId
 * @returns {Promise<string>} absolute path to temp sandbox cwd
 */
export async function copyTaskFixtureToTemp(taskId) {
  const spec = getTaskSpec(taskId);
  if (!fs.existsSync(spec.fixtureRoot)) {
    throw new Error(`[context-usage] missing fixture: ${spec.fixtureRoot}`);
  }
  const fileCount = countFiles(spec.fixtureRoot);
  if (fileCount < 5) {
    throw new Error(
      `[context-usage] fixture sanity check failed for ${taskId}: expected non-empty tree, found ${fileCount} files`,
    );
  }
  const prefix = path.join(os.tmpdir(), `context-usage-${taskId}-`);
  const dest = await fs.promises.mkdtemp(prefix);
  copyRecursive(spec.fixtureRoot, dest);
  return dest;
}

/**
 * @deprecated Use copyTaskFixtureToTemp(taskId). Kept for transitional imports.
 * @param {string} [taskId]
 */
export async function copySandboxToTemp(taskId = "task-low") {
  return copyTaskFixtureToTemp(taskId);
}

export function resolveFixtureRoot(taskId) {
  return getTaskSpec(taskId).fixtureRoot;
}

export { HARNESS_ROOT };
