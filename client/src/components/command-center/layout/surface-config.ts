export type CommandCenterSurfaceId =
  | "command-center"
  | "feature-backlog"
  | "work-intake"
  | "mission-control"
  | "compliance"
  | "repo-explorer"
  | "agent-chat"
  | "sandboxes"
  | "activity-log"
  | "automations";

export type CommandCenterSurfaceConfig = {
  id: CommandCenterSurfaceId;
  label: string;
  shortLabel: string;
  route: string;
  firstSlice: boolean;
  icon: string;
  description: string;
};

export const COMMAND_CENTER_SURFACES: CommandCenterSurfaceConfig[] = [
  {
    id: "command-center",
    label: "Command Center",
    shortLabel: "Command",
    route: "/command-center",
    firstSlice: true,
    icon: "⌂",
    description: "Operator overview and active work orientation.",
  },
  {
    id: "feature-backlog",
    label: "Feature Backlog",
    shortLabel: "Backlog",
    route: "/feature-backlog",
    firstSlice: false,
    icon: "☰",
    description: "Ranked product backlog and intake queue.",
  },
  {
    id: "work-intake",
    label: "Work Intake / Kickoff",
    shortLabel: "Intake",
    route: "/work-intake",
    firstSlice: true,
    icon: "✎",
    description: "Start feature delivery from inbox directives.",
  },
  {
    id: "mission-control",
    label: "FD Mission Control",
    shortLabel: "Mission",
    route: "/mission-control",
    firstSlice: true,
    icon: "◎",
    description: "Stage rail and run telemetry for active tasks.",
  },
  {
    id: "compliance",
    label: "Compliance + Recovery",
    shortLabel: "Compliance",
    route: "/compliance",
    firstSlice: true,
    icon: "⚑",
    description: "Audit runs, findings, and recovery actions.",
  },
  {
    id: "repo-explorer",
    label: "Repo Explorer",
    shortLabel: "Repo",
    route: "/repo-explorer",
    firstSlice: false,
    icon: "⎘",
    description: "Browse repository files and artifacts.",
  },
  {
    id: "agent-chat",
    label: "Agent Chat",
    shortLabel: "Chat",
    route: "/agent-chat",
    firstSlice: false,
    icon: "💬",
    description: "Conversational operator console for agents.",
  },
  {
    id: "sandboxes",
    label: "Sandbox Manager",
    shortLabel: "Sandboxes",
    route: "/sandboxes",
    firstSlice: false,
    icon: "▣",
    description: "Scratch workspaces and port registry.",
  },
  {
    id: "activity-log",
    label: "Activity Log",
    shortLabel: "Activity",
    route: "/activity-log",
    firstSlice: true,
    icon: "☰",
    description: "Chronological operator and pipeline events.",
  },
  {
    id: "automations",
    label: "Automations / Cron",
    shortLabel: "Automations",
    route: "/automations",
    firstSlice: true,
    icon: "⏱",
    description: "Scheduled agent runs and cron automations.",
  },
];

export const FIRST_SLICE_SURFACES = COMMAND_CENTER_SURFACES.filter((surface) => surface.firstSlice);

/** Mobile tab bar order per ux-spec (differs from rail enumeration order). */
const MOBILE_TAB_ORDER: CommandCenterSurfaceId[] = [
  "command-center",
  "mission-control",
  "work-intake",
  "compliance",
  "activity-log",
  "automations",
];

export const MOBILE_TAB_SURFACES = MOBILE_TAB_ORDER.map(
  (id) => COMMAND_CENTER_SURFACES.find((surface) => surface.id === id)!,
);

export function getSurfaceByRoute(pathname: string): CommandCenterSurfaceConfig | undefined {
  const normalized = pathname === "/" ? "/command-center" : pathname;
  return COMMAND_CENTER_SURFACES.find((surface) => surface.route === normalized);
}
