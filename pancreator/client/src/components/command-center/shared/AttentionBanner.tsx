import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

export function AttentionBanner({
  title,
  children,
  variant = "default",
  action,
}: {
  title: string;
  children: ReactNode;
  variant?: "default" | "degraded";
  action?: ReactNode;
}) {
  return (
    <section
      className={
        variant === "degraded"
          ? "command-center-attention-banner command-center-degraded-banner"
          : "command-center-attention-banner"
      }
      role="status"
      aria-label={title}
    >
      {variant === "degraded" ? (
        <div className="command-center-degraded-banner-layout">
          <div className="command-center-degraded-banner-copy">
            <TriangleAlert aria-hidden="true" className="command-center-degraded-banner-icon" size={20} />
            <div className="command-center-degraded-banner-text">
              <h3>{title}</h3>
              {children}
            </div>
          </div>
          {action ? <div className="command-center-degraded-banner-action">{action}</div> : null}
        </div>
      ) : (
        <>
          <h3>{title}</h3>
          {children}
        </>
      )}
    </section>
  );
}
