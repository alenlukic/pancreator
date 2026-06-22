import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { PanError, invariant } from "./errors.mjs";

export function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
        if (pkg.name === "pancreator-v2-prototype") return current;
      } catch {
        // Keep walking; malformed package files are handled by validation.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new PanError("Could not locate the Pancreator repository root.", {
        code: "ROOT_NOT_FOUND",
        details: { start },
      });
    }
    current = parent;
  }
}

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new PanError(`Failed to read JSON: ${filePath}`, {
      code: "INVALID_JSON",
      details: { cause: error.message },
    });
  }
}

export function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    throw new PanError(`Failed to read file: ${filePath}`, {
      code: "READ_FAILED",
      details: { cause: error.message },
    });
  }
}

export function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function writeTextAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export function sha256(value) {
  const input = typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function toRepoRelative(root, absoluteOrRelativePath) {
  const absolute = path.resolve(root, absoluteOrRelativePath);
  const relative = path.relative(root, absolute);
  invariant(relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
    `Path must remain inside the repository: ${absoluteOrRelativePath}`,
    { code: "PATH_ESCAPE" });
  return relative.split(path.sep).join("/");
}

export function resolveInside(root, relativePath) {
  invariant(typeof relativePath === "string" && relativePath.length > 0,
    "Expected a non-empty repository-relative path.", { code: "INVALID_PATH" });
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  invariant(!relative.startsWith("..") && !path.isAbsolute(relative),
    `Path escapes repository root: ${relativePath}`, { code: "PATH_ESCAPE" });
  return absolute;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function withFileLock(lockPath, callback) {
  ensureDir(path.dirname(lockPath));
  let descriptor;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(lockPath, "wx");
      writeFileSync(descriptor, `${process.pid}\n`, "utf8");
      break;
    } catch (error) {
      let owner = null;
      try {
        owner = Number(readFileSync(lockPath, "utf8").trim());
      } catch {
        // A malformed lock is stale and may be removed once.
      }
      if (attempt === 0 && !processIsAlive(owner)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      throw new PanError(`Another Pancreator operation holds the lock: ${lockPath}`, {
        code: "LOCK_HELD",
        details: { owner_pid: owner, cause: error.message },
      });
    }
  }

  try {
    return callback();
  } finally {
    try {
      closeSync(descriptor);
    } finally {
      rmSync(lockPath, { force: true });
    }
  }
}

export function fileExists(filePath) {
  return existsSync(filePath);
}

export function isFile(filePath) {
  return existsSync(filePath) && statSync(filePath).isFile();
}
