/**
 * @packageDocumentation
 * Structural types for Anthropic Claude Agent SDK persona frontmatter plus Pancreator `metadata`.
 */

/** Closed `permissionMode` values from `/lib/memory/handbook/persona-spec.md` §2. */
export type PersonaPermissionMode = "default" | "read-only";

/** Closed `isolation` values from `/lib/memory/handbook/persona-spec.md` §2. */
export type PersonaIsolation = "worktree" | "none";

/** Closed `memory` values from `/lib/memory/handbook/persona-spec.md` §2. */
export type PersonaMemory = "project" | "private";

/** Closed `effort` values from `/lib/memory/handbook/persona-spec.md` §2. */
export type PersonaEffort = "low" | "medium" | "high";

/**
 * Pancreator extension block from `/lib/memory/handbook/persona-spec.md` §3.
 * The parser requires the five keys below for every persona file.
 */
export interface PersonaMetadata {
  "pancreator-risk-tier": "low" | "medium" | "high" | "any";
  "pancreator-pipeline-stages": string[];
  "pancreator-bootstrap-only": boolean;
  "pancreator-stability": "experimental" | "stable" | "deprecated";
  "pancreator-required-docs"?: string[];
  [key: string]: unknown;
}

/**
 * Validated 16-field Anthropic frontmatter plus required `metadata`.
 * Optional fields 14–16 (`hooks`, `initialPrompt`, `background`) omit when unused.
 */
export interface PersonaSpec {
  name: string;
  description: string;
  model: string;
  permissionMode: PersonaPermissionMode;
  tools: string[];
  disallowedTools: string[];
  mcpServers: string[];
  maxTurns: number;
  skills: string[];
  isolation: PersonaIsolation;
  memory: PersonaMemory;
  effort: PersonaEffort;
  color: string;
  hooks?: Record<string, unknown>;
  initialPrompt?: string;
  background?: string;
  metadata: PersonaMetadata;
}

/**
 * Result of parsing `lib/personas/<name>.md`: validated spec, raw body, and full frontmatter
 * (including `references` and other extensions) for stable emit.
 */
export interface ParsedPersonaFile {
  spec: PersonaSpec;
  body: string;
  /** Full YAML frontmatter object (preserves extensions such as `references`). */
  frontmatter: Record<string, unknown>;
}
