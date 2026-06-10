import type { TaskRunStateEnvelope } from "@/services/run-state-shared";
import type { ShippedOutcome } from "@/services/run-state";
import type {
  ActivityPreviewEvent,
  CommandCenterSeverity,
  CommandCenterStatusPill,
} from "@/services/run-state-shared";
import type { StatusPillValue } from "../shared/StatusPill";
import type { SeverityChipValue } from "../shared/SeverityChip";

export type CommandCenterCardRegion =
  | "human-gates"
  | "anomalies"
  | "running-now"
  | "recent-outcomes";

export type CommandCenterRowOverflow = {
  taskId?: string;
  runDir?: string;
  inboxSource?: string;
  runCommand?: string;
  stageName?: string;
  gateAction?: "approve" | "reject" | "revise";
};

export type CommandCenterRowCta = {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
};

export type CommandCenterRowModel = {
  id: string;
  label: string;
  status: StatusPillValue;
  severity: SeverityChipValue;
  ageIso: string;
  ageLabel: string;
  metaHint?: string;
  primaryCta: CommandCenterRowCta;
  secondaryCta?: CommandCenterRowCta;
  overflow: CommandCenterRowOverflow;
};

export type CommandCenterCardModel = {
  region: CommandCenterCardRegion;
  testId: string;
  title: string;
  emptyCopy: string;
  rows: CommandCenterRowModel[];
  overflowHref?: string;
  dataAgeMs?: number;
  degradedSource?: string;
};

export type ComplianceFindingRow = {
  id: string;
  label: string;
  excerpt: string;
  severity: CommandCenterSeverity;
  blocks: boolean;
  detail?: string | null;
  missingArtifact?: boolean;
};

export type AutomationPreviewRow = {
  automationId: string;
  name: string;
  scheduleLabel: string;
  status: "success" | "failed" | "scheduled" | "paused";
  lastRunAt?: string;
  canRetry: boolean;
};

export type CommandCenterBuildInput = {
  tasks: TaskRunStateEnvelope[];
  complianceFindings: ComplianceFindingRow[];
  shippedOutcomes: ShippedOutcome[];
  activityEvents: ActivityPreviewEvent[];
  nowMs?: number;
  dataFetchedAtMs?: number;
  failedSources?: string[];
};

export const COMMAND_CENTER_STALE_DATA_MS = 60_000;
export const COMMAND_CENTER_ACTIVE_REVALIDATE_MS = 10_000;
export const COMMAND_CENTER_MAX_ROWS_PER_REGION = 5;

export type { CommandCenterSeverity, CommandCenterStatusPill };
