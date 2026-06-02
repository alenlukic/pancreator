import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_ROOT = path.join(HARNESS_ROOT, "fixtures", "tier-sandbox");

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
 * Copies the committed tier sandbox to a temp directory for isolated SDK runs.
 * @returns {Promise<string>} absolute path to the copy (SDK cwd)
 */
export async function copySandboxToTemp() {
  if (!fs.existsSync(FIXTURE_ROOT)) {
    throw new Error(`[context-usage] missing fixture: ${FIXTURE_ROOT}`);
  }
  const fileCount = countFiles(FIXTURE_ROOT);
  if (fileCount < 5) {
    throw new Error(
      `[context-usage] fixture sanity check failed: expected non-empty tree, found ${fileCount} files`,
    );
  }
  const prefix = path.join(os.tmpdir(), "context-usage-sandbox-");
  const dest = await fs.promises.mkdtemp(prefix);
  copyRecursive(FIXTURE_ROOT, dest);
  const copiedCount = countFiles(dest);
  if (copiedCount < fileCount) {
    throw new Error(
      `[context-usage] copy incomplete: source ${fileCount} files, destination ${copiedCount}`,
    );
  }
  return dest;
}
