import { stringifyCompactJson } from "@pancreator/core";
import { rfc3339UtcMs } from "@pancreator/run-logger";

/** Interval between heartbeat progress events during an SDK stage invocation. */
export const FEATURE_DELIVERY_SDK_HEARTBEAT_MS = 150_000;

export type FeatureDeliverySdkProgressKind =
  | "stage_transition"
  | "stage_enter"
  | "heartbeat"
  | "stage_complete";

export type FeatureDeliveryBatchProgressKind =
  | "batch_enter"
  | "batch_run_start"
  | "batch_run_complete"
  | "batch_run_failed"
  | "batch_slot_free"
  | "batch_merge_start"
  | "batch_complete";

export interface FeatureDeliveryBatchProgressEvent {
  kind: FeatureDeliveryBatchProgressKind;
  batchId: string;
  taskId?: string;
  atIso: string;
  parallelism?: number;
  inboxEntry?: string;
  branch?: string;
  error?: string;
  mergeBranch?: string;
}

export interface FeatureDeliverySdkProgressEvent {
  kind: FeatureDeliverySdkProgressKind;
  taskId: string;
  featureId: string;
  stageId: string;
  persona?: string;
  fromStage?: string;
  toStage?: string;
  event?: string;
  elapsedMs?: number;
  atIso: string;
}

export type FeatureDeliverySdkProgressFormat = "auto" | "text" | "ndjson";

export interface FeatureDeliverySdkProgressReporter {
  emit(event: FeatureDeliverySdkProgressEvent): void;
}

export interface FeatureDeliveryBatchProgressReporter {
  emit(event: FeatureDeliveryBatchProgressEvent): void;
}

export interface CreateFeatureDeliverySdkProgressReporterInput {
  writeErr: (chunk: string) => void;
  format?: FeatureDeliverySdkProgressFormat;
  /** Injectable clock for tests. */
  now?: () => Date;
}

function resolveProgressFormat(format: FeatureDeliverySdkProgressFormat | undefined): "text" | "ndjson" {
  const requested = format ?? readProgressFormatEnv();
  if (requested === "text") {
    return "text";
  }
  if (requested === "ndjson") {
    return "ndjson";
  }
  return process.stderr.isTTY ? "text" : "ndjson";
}

function readProgressFormatEnv(): FeatureDeliverySdkProgressFormat {
  const raw = process.env.PAN_FD_PROGRESS?.trim().toLowerCase();
  if (raw === "text" || raw === "ndjson" || raw === "auto") {
    return raw;
  }
  return "auto";
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatProgressText(event: FeatureDeliverySdkProgressEvent): string {
  const prefix = "[pan fd]";
  switch (event.kind) {
    case "stage_transition":
      return [
        "",
        `${prefix} stage transition`,
        `  task: ${event.taskId}`,
        `  from: ${event.fromStage ?? "?"}`,
        `  to: ${event.toStage ?? event.stageId}`,
        ...(event.event ? [`  event: ${event.event}`] : []),
      ].join("\n");
    case "stage_enter":
      return [
        "",
        `${prefix} stage enter`,
        `  task: ${event.taskId}`,
        `  stage: ${event.stageId}`,
        ...(event.persona ? [`  persona: ${event.persona}`] : []),
      ].join("\n");
    case "heartbeat":
      return `${prefix} heartbeat | task=${event.taskId} stage=${event.stageId}${event.persona ? ` persona=${event.persona}` : ""} elapsed=${formatElapsed(event.elapsedMs ?? 0)}`;
    case "stage_complete":
      return [
        "",
        `${prefix} stage complete`,
        `  task: ${event.taskId}`,
        `  stage: ${event.stageId}`,
        ...(event.persona ? [`  persona: ${event.persona}`] : []),
        `  elapsed: ${formatElapsed(event.elapsedMs ?? 0)}`,
      ].join("\n");
    default:
      return `${prefix} ${event.taskId}: ${event.stageId}`;
  }
}

function formatProgressNdjson(event: FeatureDeliverySdkProgressEvent): string {
  const { event: transitionEvent, ...rest } = event;
  return stringifyCompactJson({
    event: "feature_delivery_progress",
    ...rest,
    ...(transitionEvent !== undefined ? { transitionEvent } : {}),
  });
}

function formatBatchProgressText(event: FeatureDeliveryBatchProgressEvent): string {
  const prefix = "[pan fd]";
  switch (event.kind) {
    case "batch_enter":
      return `${prefix} batch ${event.batchId}: starting (${event.parallelism ?? 1} slot(s))`;
    case "batch_run_start":
      return `${prefix} batch ${event.batchId}: run start ${event.taskId ?? "?"} (${event.inboxEntry ?? ""})`;
    case "batch_run_complete":
      return `${prefix} batch ${event.batchId}: run complete ${event.taskId ?? "?"}`;
    case "batch_run_failed":
      return `${prefix} batch ${event.batchId}: run failed ${event.taskId ?? "?"} — ${event.error ?? "unknown"}`;
    case "batch_slot_free":
      return `${prefix} batch ${event.batchId}: slot free${event.taskId !== undefined ? ` (${event.taskId})` : ""}`;
    case "batch_merge_start":
      return `${prefix} batch ${event.batchId}: merge start → ${event.mergeBranch ?? "?"}`;
    case "batch_complete":
      return `${prefix} batch ${event.batchId}: complete`;
    default:
      return `${prefix} batch ${event.batchId}: ${event.kind}`;
  }
}

function formatBatchProgressNdjson(event: FeatureDeliveryBatchProgressEvent): string {
  return stringifyCompactJson({
    event: "feature_delivery_progress",
    ...event,
  });
}

export function createFeatureDeliverySdkProgressReporter(
  input: CreateFeatureDeliverySdkProgressReporterInput,
): FeatureDeliverySdkProgressReporter {
  const sinkFormat = resolveProgressFormat(input.format);
  return {
    emit(event: FeatureDeliverySdkProgressEvent): void {
      const payload =
        sinkFormat === "text" ? `${formatProgressText(event)}\n` : `${formatProgressNdjson(event)}\n`;
      input.writeErr(payload);
    },
  };
}

export function noopFeatureDeliverySdkProgressReporter(): FeatureDeliverySdkProgressReporter {
  return { emit: () => undefined };
}

export function createFeatureDeliveryBatchProgressReporter(
  input: CreateFeatureDeliverySdkProgressReporterInput,
): FeatureDeliveryBatchProgressReporter {
  const sinkFormat = resolveProgressFormat(input.format);
  return {
    emit(event: FeatureDeliveryBatchProgressEvent): void {
      const payload =
        sinkFormat === "text"
          ? `${formatBatchProgressText(event)}\n`
          : `${formatBatchProgressNdjson(event)}\n`;
      input.writeErr(payload);
    },
  };
}

export function noopFeatureDeliveryBatchProgressReporter(): FeatureDeliveryBatchProgressReporter {
  return { emit: () => undefined };
}

export function emitFeatureDeliveryStageTransition(
  progress: FeatureDeliverySdkProgressReporter | undefined,
  input: {
    taskId: string;
    featureId: string;
    fromStage: string;
    toStage: string;
    event?: string;
    persona?: string;
    now?: Date;
  },
): void {
  if (progress === undefined) {
    return;
  }
  progress.emit({
    kind: "stage_transition",
    taskId: input.taskId,
    featureId: input.featureId,
    stageId: input.toStage,
    fromStage: input.fromStage,
    toStage: input.toStage,
    event: input.event,
    persona: input.persona,
    atIso: rfc3339UtcMs(input.now ?? new Date()),
  });
}

/** Runs work with periodic heartbeat progress while an SDK stage invocation is in flight. */
export async function withFeatureDeliverySdkStageHeartbeat<T>(
  progress: FeatureDeliverySdkProgressReporter | undefined,
  context: {
    taskId: string;
    featureId: string;
    stageId: string;
    persona?: string;
    now?: Date;
  },
  work: () => Promise<T>,
): Promise<T> {
  if (progress === undefined) {
    return work();
  }

  const startedAt = context.now ?? new Date();
  const startMs = startedAt.getTime();
  progress.emit({
    kind: "stage_enter",
    taskId: context.taskId,
    featureId: context.featureId,
    stageId: context.stageId,
    persona: context.persona,
    elapsedMs: 0,
    atIso: rfc3339UtcMs(startedAt),
  });

  const timer = setInterval(() => {
    progress.emit({
      kind: "heartbeat",
      taskId: context.taskId,
      featureId: context.featureId,
      stageId: context.stageId,
      persona: context.persona,
      elapsedMs: Date.now() - startMs,
      atIso: rfc3339UtcMs(new Date()),
    });
  }, FEATURE_DELIVERY_SDK_HEARTBEAT_MS);
  timer.unref?.();

  try {
    return await work();
  } finally {
    clearInterval(timer);
    progress.emit({
      kind: "stage_complete",
      taskId: context.taskId,
      featureId: context.featureId,
      stageId: context.stageId,
      persona: context.persona,
      elapsedMs: Date.now() - startMs,
      atIso: rfc3339UtcMs(new Date()),
    });
  }
}
