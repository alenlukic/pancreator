import type { ReactNode } from "react";

export function AttentionBanner({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="command-center-attention-banner" role="status" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
