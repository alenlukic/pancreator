export const FDS_UTC_MS: number;
export const SID_SECONDS: number;

export function startOfUtcDayMs(d: Date): number;
export function daysToFds(date: Date): number;
export function secondsRemainingInDay(date: Date): number;
export function hhmm(date: Date): string;
export function mmDdYySuffix(d: Date): string;
