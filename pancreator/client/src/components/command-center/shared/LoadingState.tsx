export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="command-center-muted command-center-loading" aria-busy="true">
      {label}
    </p>
  );
}
