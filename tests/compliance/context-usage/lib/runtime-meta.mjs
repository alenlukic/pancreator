import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function readCursorSdkVersion() {
  try {
    const sdkEntry = require.resolve("@cursor/sdk");
    let dir = path.dirname(sdkEntry);
    for (let i = 0; i < 8; i += 1) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg?.name === "@cursor/sdk" && pkg?.version) {
          return String(pkg.version);
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  } catch {
    // fall through
  }
  return "unknown";
}

export function buildRuntimeMetadata() {
  return {
    sdk_version: readCursorSdkVersion(),
    node_version: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
}
