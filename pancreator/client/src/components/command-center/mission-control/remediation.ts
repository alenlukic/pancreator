export const MISSION_CONTROL_TOAST_EVENT = "mission-control-toast";

export function showNotImplementedToast(action: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(MISSION_CONTROL_TOAST_EVENT, {
      detail: { message: `Action not available yet: ${action}` },
    }),
  );
}
