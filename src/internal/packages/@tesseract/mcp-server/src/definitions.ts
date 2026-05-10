const EMPTY_OBJECT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {} as const,
};

const TASK_ID_ARG = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    taskId: { type: "string" as const, description: "Task id under src/work/" },
  },
  required: ["taskId"] as const,
};

const RESUME_ARG = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    taskId: { type: "string" as const, description: "Task id under src/work/" },
    checkpoint: {
      type: "string" as const,
      description: "Optional checkpoint id for time-travel resume",
    },
  },
  required: ["taskId"] as const,
};

const ABORT_ARG = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    taskId: { type: "string" as const, description: "Task id under src/work/" },
    reason: { type: "string" as const, description: "Optional abort reason" },
  },
  required: ["taskId"] as const,
};

export type TessToolName =
  | "tess.init"
  | "tess.run"
  | "tess.inbox"
  | "tess.feature"
  | "tess.status"
  | "tess.approve"
  | "tess.memory"
  | "tess.contracts"
  | "tess.lint"
  | "tess.pause"
  | "tess.resume"
  | "tess.abort";

export interface ToolDefinition {
  name: TessToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The tools array SHALL match the MVP `tess` CLI command surface
 * (`parseAndRun` in `@tesseract/cli`).
 */
export function listToolDefinitions(): readonly ToolDefinition[] {
  return [
    {
      name: "tess.init",
      description: "Initialize a Tesseract workspace in the current repository",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.run",
      description: "Run a pipeline by name",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.inbox",
      description: "List pending human directives under src/inbox/in/",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.feature",
      description: "Manage feature-delivery artifacts",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.status",
      description: "Show pipeline and workspace status",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.approve",
      description: "Approve a gated action",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.memory",
      description: "Inspect Memory tier indexes",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.contracts",
      description: "List or evaluate Spec Contracts",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.lint",
      description: "Run repository lint and policy gates",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "tess.pause",
      description: "Append a pause intervention for a task",
      inputSchema: TASK_ID_ARG,
    },
    {
      name: "tess.resume",
      description: "Append a resume intervention for a task",
      inputSchema: RESUME_ARG,
    },
    {
      name: "tess.abort",
      description: "Append an abort intervention for a task",
      inputSchema: ABORT_ARG,
    },
  ];
}

/**
 * The resource templates SHALL cover `/src/memory/`, Inbox, and `src/work/<taskId>/run.log.jsonl` reads.
 */
export interface ResourceDefinitionEntry {
  readonly name: string;
  readonly uriTemplate: string;
  readonly description: string;
  readonly mimeType?: string;
}

export function listResourceDefinitions(): readonly ResourceDefinitionEntry[] {
  return [
    {
      name: "tesseract-memory-areas",
      uriTemplate: "memory://",
      description:
        "JSON text listing one Memory directory name for each child of `/src/memory/`.",
      mimeType: "application/json",
    },
    {
      name: "tesseract-inbox-queues",
      uriTemplate: "inbox://",
      description:
        "JSON text listing file names in `src/inbox/in/`, `src/inbox/out/`, and `src/inbox/threads/`.",
      mimeType: "application/json",
    },
    {
      name: "tesseract-work-run-log",
      uriTemplate: "work-run-log://{taskId}",
      description: "Text contents of `src/work/<taskId>/run.log.jsonl` when the file exists.",
      mimeType: "application/x-ndjson",
    },
  ];
}
