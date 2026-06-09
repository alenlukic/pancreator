"use client";

import { CommandCenterCard } from "../CommandCenterCard";
import type { CommandCenterCardModel } from "../command-center-types";

export function RecentAutomationsCard({
  card,
  loading,
}: {
  card: CommandCenterCardModel;
  loading?: boolean;
}) {
  return <CommandCenterCard card={card} loading={loading} />;
}
