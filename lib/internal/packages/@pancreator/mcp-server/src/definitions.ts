const EMPTY_OBJECT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {} as const,
};

const TASK_ID_ARG = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    taskId: { type: "string" as const, description: "Task id under work/" },
  },
  required: ["taskId"] as const,
};

const FEATURE_ARG = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    action: {
      type: "string" as const,
      enum: ["list", "show"] as const,
      description: "Read-only feature action (default list)",
    },
    featureId: {
      type: "string" as const,
      description: "Feature id for action show",
    },
  },
};

const STATUS_ARG = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    taskId: {
      type: "string" as const,
      description: "Optional feature-delivery task id for task-scoped status",
    },
  },
};

const MEMORY_QUERY_ARG = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    query: {
      type: "string" as const,
      description: "Free-text query routed through handbook and active memory",
    },
  },
  required: ["query"] as const,
};

const RESUME_ARG = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    taskId: { type: "string" as const, description: "Task id under work/" },
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
    taskId: { type: "string" as const, description: "Task id under work/" },
    reason: { type: "string" as const, description: "Optional abort reason" },
  },
  required: ["taskId"] as const,
};

export type DdlToolName =
  | "pan.init"
  | "pan.run"
  | "pan.inbox"
  | "pan.feature"
  | "pan.status"
  | "pan.approve"
  | "pan.memory"
  | "pan.contracts"
  | "pan.lint"
  | "pan.pause"
  | "pan.resume"
  | "pan.abort";

export interface ToolDefinition {
  name: DdlToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The tools array SHALL match the MVP `pan` CLI command surface
 * (`parseAndRun` in `@pancreator/cli`).
 */
export function listToolDefinitions(): readonly ToolDefinition[] {
  return [
    {
      name: "pan.init",
      description:
        "Initialize a Pancreator workspace in the current repository [deferred: M3]",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "pan.run",
      description: "Run a pipeline by name [deferred: M2]",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "pan.inbox",
      description: "List pending human directives under lib/inbox/in/",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "pan.feature",
      description:
        "Read-only feature memory queries (`action`: list | show) [write paths deferred: M2]",
      inputSchema: FEATURE_ARG,
    },
    {
      name: "pan.status",
      description:
        "Read pipeline and workspace status; pass taskId for task-scoped detail",
      inputSchema: STATUS_ARG,
    },
    {
      name: "pan.approve",
      description: "Approve a gated action [deferred: M3]",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "pan.memory",
      description:
        "Query handbook routing and active-memory tiers (`query` required) [write paths deferred: M2]",
      inputSchema: MEMORY_QUERY_ARG,
    },
    {
      name: "pan.contracts",
      description: "List or evaluate Spec Contracts [deferred: M2]",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "pan.lint",
      description: "Run repository lint and policy gates [deferred: M1]",
      inputSchema: EMPTY_OBJECT_SCHEMA,
    },
    {
      name: "pan.pause",
      description: "Append a pause intervention for a task",
      inputSchema: TASK_ID_ARG,
    },
    {
      name: "pan.resume",
      description: "Append a resume intervention for a task",
      inputSchema: RESUME_ARG,
    },
    {
      name: "pan.abort",
      description: "Append an abort intervention for a task",
      inputSchema: ABORT_ARG,
    },
  ];
}

/**
 * The resource templates SHALL cover `/lib/memory/`, Inbox, and `work/<taskId>/run.log.jsonl` reads.
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
      name: "pancreator-memory-areas",
      uriTemplate: "memory://",
      description:
        "JSON text listing one Memory directory name for each child of `/lib/memory/`.",
      mimeType: "application/json",
    },
    {
      name: "pancreator-inbox-queues",
      uriTemplate: "inbox://",
      description:
        "JSON text listing file names in `lib/inbox/in/`, `lib/inbox/out/`, and `lib/inbox/threads/`.",
      mimeType: "application/json",
    },
    {
      name: "pancreator-work-run-log",
      uriTemplate: "work-run-log://{taskId}",
      description: "Text contents of `work/<taskId>/run.log.jsonl` when the file exists.",
      mimeType: "application/x-ndjson",
    },
  ];
}
