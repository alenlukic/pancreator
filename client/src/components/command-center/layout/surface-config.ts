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

/** Six shipped destinations per command-center-rebuild ux-spec. */
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

/** Mobile tab bar mirrors the six shipped destinations. */
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

export type CommandPaletteAction = {
  id: string;
  label: string;
  group: "navigation" | "frequent" | "context";
  href?: string;
  destructive?: boolean;
  keywords?: string[];
};

/** Ten most frequent operator actions mirrored on owning surfaces. */
export const FREQUENT_COMMAND_ACTIONS: CommandPaletteAction[] = [
  { id: "nav-home", label: "Open Home", group: "navigation", href: "/command-center" },
  {
    id: "nav-delivery",
    label: "Open Feature Delivery",
    group: "navigation",
    href: "/mission-control",
  },
  {
    id: "nav-compliance",
    label: "Open Compliance + Recovery",
    group: "navigation",
    href: "/compliance",
  },
  { id: "nav-automations", label: "Open Automations", group: "navigation", href: "/automations" },
  {
    id: "nav-activity",
    label: "Open Activity Log",
    group: "navigation",
    href: "/activity-log",
  },
  {
    id: "approve-gate",
    label: "Approve pending human gate",
    group: "frequent",
    href: "/command-center",
    keywords: ["ratify", "gate"],
  },
  {
    id: "open-run",
    label: "Open run detail",
    group: "frequent",
    href: "/mission-control",
    keywords: ["mission", "supervise"],
  },
  {
    id: "rerun-compliance",
    label: "Re-run compliance audit",
    group: "frequent",
    href: "/compliance",
    keywords: ["audit", "recovery"],
  },
  {
    id: "create-automation",
    label: "Create automation",
    group: "frequent",
    href: "/automations",
    keywords: ["cron", "schedule"],
  },
  {
    id: "view-activity",
    label: "View recent receipts",
    group: "frequent",
    href: "/activity-log",
    keywords: ["receipt", "audit"],
  },
  {
    id: "abort-run",
    label: "Abort active run",
    group: "frequent",
    href: "/mission-control",
    destructive: true,
    keywords: ["stop", "destructive"],
  },
];

export function getSurfaceByRoute(pathname: string): CommandCenterSurfaceConfig | undefined {
  const normalized = pathname === "/" ? "/command-center" : pathname;
  return COMMAND_CENTER_SURFACES.find((surface) => surface.route === normalized);
}

export function filterCommandPaletteActions(
  query: string,
  includeDestructiveByDefault = false,
): CommandPaletteAction[] {
  const normalized = query.trim().toLowerCase();
  const navigation: CommandPaletteAction[] = COMMAND_CENTER_SURFACES.map((surface) => ({
    id: `nav-${surface.id}`,
    label: `Open ${surface.label}`,
    group: "navigation",
    href: surface.route,
  }));

  const merged: CommandPaletteAction[] = [
    ...navigation,
    ...FREQUENT_COMMAND_ACTIONS.filter((action) => action.group === "frequent"),
  ];

  const filtered = merged.filter((action) => {
    if (action.destructive && !includeDestructiveByDefault && normalized.length === 0) {
      return false;
    }
    if (normalized.length === 0) {
      return true;
    }
    const haystack = `${action.label} ${action.keywords?.join(" ") ?? ""}`.toLowerCase();
    return haystack.includes(normalized);
  });

  const seen = new Set<string>();
  return filtered.filter((action) => {
    if (seen.has(action.id)) {
      return false;
    }
    seen.add(action.id);
    return true;
  });
}
