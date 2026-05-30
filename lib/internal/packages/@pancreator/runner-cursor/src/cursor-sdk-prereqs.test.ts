import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureCursorSdkRipgrepConfigured,
  resolveCursorRipgrepBinaryPath,
} from "./cursor-sdk-prereqs.js";

const CANONICAL_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

describe("cursor-sdk-prereqs", () => {
  const previousRipgrepPath = process.env.CURSOR_RIPGREP_PATH;

  afterEach(() => {
    if (previousRipgrepPath === undefined) {
      delete process.env.CURSOR_RIPGREP_PATH;
    } else {
      process.env.CURSOR_RIPGREP_PATH = previousRipgrepPath;
    }
  });

  it("resolves bundled rg from the workspace when platform package is installed", () => {
    const resolved = resolveCursorRipgrepBinaryPath(CANONICAL_REPO_ROOT);
    if (resolved === undefined) {
      expect.soft(resolved).toBeDefined();
      return;
    }
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toMatch(/[/\\]bin[/\\]rg(\.exe)?$/u);
  });

  it("ensureCursorSdkRipgrepConfigured sets CURSOR_RIPGREP_PATH", () => {
    delete process.env.CURSOR_RIPGREP_PATH;
    const configured = ensureCursorSdkRipgrepConfigured(CANONICAL_REPO_ROOT);
    if (!configured) {
      expect.soft(configured).toBe(true);
      return;
    }
    expect(process.env.CURSOR_RIPGREP_PATH).toMatch(/[/\\]bin[/\\]rg(\.exe)?$/u);
  });
});
