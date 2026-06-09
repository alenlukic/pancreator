import type { TaskRunStateEnvelope } from "@/services/run-state-shared";
import type {
  ActivityPreviewEvent,
  CommandCenterSeverity,
  CommandCenterStatusPill,
} from "@/services/run-state-shared";
import type { StatusPillValue } from "../shared/StatusPill";
import type { SeverityChipValue } from "../shared/SeverityChip";

export type CommandCenterCardRegion =
  | "needs-you"
  | "running-now"
  | "compliance-issues"
  | "hanging-tasks"
  | "recent-automations"
  | "recent-activity";

export type CommandCenterRowOverflow = {
  taskId?: string;
  runDir?: string;
  inboxSource?: string;
  runCommand?: string;
  stageName?: string;
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
  overflow: CommandCenterRowOverflow;
};

export type CommandCenterCardModel = {
  region: CommandCenterCardRegion;
  testId: string;
  title: string;
  emptyCopy: string;
  rows: CommandCenterRowModel[];
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
  automationRows: AutomationPreviewRow[];
  activityEvents: ActivityPreviewEvent[];
  nowMs?: number;
};

export type { CommandCenterSeverity, CommandCenterStatusPill };
