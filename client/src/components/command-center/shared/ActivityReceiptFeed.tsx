"use client";

export type ActivityReceipt = {
  id: string;
  actor: string;
  verb: string;
  object: string;
  timestamp: string;
  artifactHref?: string;
  artifactLabel?: string;
};

export function ActivityReceiptFeed({
  receipts,
  emptyLabel = "No recent activity",
  testId = "activity-receipt-feed",
}: {
  receipts: ActivityReceipt[];
  emptyLabel?: string;
  testId?: string;
}) {
  if (receipts.length === 0) {
    return (
      <div className="activity-receipt-feed activity-receipt-feed-empty" data-testid={testId}>
        <p>{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ul className="activity-receipt-feed" data-testid={testId} aria-label="Activity receipts">
      {receipts.map((receipt) => (
        <li key={receipt.id} className="activity-receipt-item" data-testid={`receipt-${receipt.id}`}>
          <span className="activity-receipt-actor">{receipt.actor}</span>
          <span className="activity-receipt-verb">{receipt.verb}</span>
          <span className="activity-receipt-object">{receipt.object}</span>
          <time className="activity-receipt-time" dateTime={receipt.timestamp}>
            {receipt.timestamp}
          </time>
          {receipt.artifactHref ? (
            <a href={receipt.artifactHref} className="activity-receipt-artifact">
              {receipt.artifactLabel ?? "View artifact"}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
