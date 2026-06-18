import path from "node:path";

/** Repo-relative root for operator scratch QA and env-isolation control plane. */
export const SANDBOXES_DIR_REL = ".pan/sandboxes" as const;

export const DEFAULT_CONTEXT_REVIEW_WORKSPACE = path.posix.join(
  SANDBOXES_DIR_REL,
  "context-review",
);

export function sandboxDirRel(slug: string): string {
  return path.posix.join(SANDBOXES_DIR_REL, slug);
}

export function sandboxManifestRel(slug: string): string {
  return path.posix.join(sandboxDirRel(slug), "manifest.json");
}

export function assertSandboxWorkspace(rel: string, label = "workspace"): string {
  const norm = rel.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (norm === "" || norm.includes("\0") || norm.split("/").some((part) => part === "..")) {
    throw new Error(`${label} MUST be a safe repo-relative path.`);
  }
  const prefix = `${SANDBOXES_DIR_REL}/`;
  if (!norm.startsWith(prefix)) {
    throw new Error(`${label} MUST be under ${SANDBOXES_DIR_REL}/; got ${norm}.`);
  }
  return norm;
}
