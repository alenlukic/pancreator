export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="cockpit-error-state" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="cockpit-action-button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
