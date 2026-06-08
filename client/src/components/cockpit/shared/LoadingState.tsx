export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="cockpit-muted cockpit-loading" aria-busy="true">
      {label}
    </p>
  );
}
