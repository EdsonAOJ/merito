export function isWithinReplayWindow(
  occurredAt: Date,
  now: Date = new Date(),
): boolean {
  const MAX_AGE_MS = 5 * 60 * 1000;

  const difference = Math.abs(now.getTime() - occurredAt.getTime());

  return Number.isFinite(difference) && difference <= MAX_AGE_MS;
}
