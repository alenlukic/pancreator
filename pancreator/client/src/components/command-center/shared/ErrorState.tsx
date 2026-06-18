export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="command-center-error-state" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="command-center-action-button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
