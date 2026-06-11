export type CommandCenterSurfaceId =
  | "command-center"
  | "mission-control"
  | "compliance"
  | "automations"
  | "activity-log";

export type CommandCenterSurfaceConfig = {
  id: CommandCenterSurfaceId;
  label: string;
  shortLabel: string;
  route: string;
  firstSlice: boolean;
  iconLabel: string;
  description: string;
  operatorJob: string;
};

/** Five shipped destinations per command-center-rebuild ux-spec. */
export const COMMAND_CENTER_SURFACES: CommandCenterSurfaceConfig[] = [
  {
    id: "command-center",
    label: "Home",
    shortLabel: "Home",
    route: "/command-center",
    firstSlice: true,
    iconLabel: "HM",
    description: "Orientation across human gates, anomalies, running work, and recent outcomes.",
    operatorJob: "Answer what needs attention within 30 seconds.",
  },
  {
    id: "mission-control",
    label: "Feature Delivery",
    shortLabel: "Delivery",
    route: "/mission-control",
    firstSlice: true,
    iconLabel: "FD",
    description: "Active run supervision, human gates, and intervention levers.",
    operatorJob: "Supervise active feature-delivery runs and human gates.",
  },
  {
    id: "compliance",
    label: "Compliance + Recovery",
    shortLabel: "Compliance",
    route: "/compliance",
    firstSlice: true,
    iconLabel: "CR",
    description: "Audit runs, findings, and recovery actions.",
    operatorJob: "Triage compliance failures and recover delivery health.",
  },
  {
    id: "automations",
    label: "Automations",
    shortLabel: "Auto",
    route: "/automations",
    firstSlice: true,
    iconLabel: "AU",
    description: "Scheduled agent runs and cron automations.",
    operatorJob: "Manage automation lifecycle and run history.",
  },
  {
    id: "activity-log",
    label: "Activity Log",
    shortLabel: "Activity",
    route: "/activity-log",
    firstSlice: true,
    iconLabel: "AL",
    description: "Mutation receipts for operator and pipeline actions.",
    operatorJob: "Audit state mutations with actor, verb, object, and artifact links.",
  },
];

export const FIRST_SLICE_SURFACES = COMMAND_CENTER_SURFACES.filter((surface) => surface.firstSlice);

/** Mobile tab bar mirrors the five shipped destinations. */
const MOBILE_TAB_ORDER: CommandCenterSurfaceId[] = [
  "command-center",
  "mission-control",
  "compliance",
  "automations",
  "activity-log",
];

export const MOBILE_TAB_SURFACES = MOBILE_TAB_ORDER.map(
  (id) => COMMAND_CENTER_SURFACES.find((surface) => surface.id === id)!,
);

export function getSurfaceByRoute(pathname: string): CommandCenterSurfaceConfig | undefined {
  const normalized = pathname === "/" ? "/command-center" : pathname;
  return COMMAND_CENTER_SURFACES.find((surface) => surface.route === normalized);
}
