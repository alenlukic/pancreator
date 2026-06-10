"use client";

export function ExecuteConfirmModal({
  command,
  taskLabel,
  open,
  onConfirm,
  onCancel,
}: {
  command: string;
  taskLabel: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop execute-confirm-modal" data-testid="execute-confirm-modal">
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="execute-confirm-title"
      >
        <h3 id="execute-confirm-title">Confirm execute action</h3>
        <p>
          Run <code>{command}</code> for <strong>{taskLabel}</strong>?
        </p>
        <p className="execute-confirm-warning">
          Mutating pan commands change pipeline state and cannot be undone from this panel.
        </p>
        <div className="modal-actions">
          <button type="button" data-testid="execute-confirm-button" onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" data-testid="execute-cancel-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
