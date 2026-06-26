export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function progressPercent(createdAt: Date, unlocksAt: Date, now = new Date()): number {
  const total = unlocksAt.getTime() - createdAt.getTime();
  if (total <= 0) return 100;
  const elapsed = now.getTime() - createdAt.getTime();
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

export function formatUnlockDate(d: Date): string {
  return d
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

/**
 * Format a date with time shown in UTC, GMT, and WAT (UTC+1).
 * Returns an array of { label, value } rows for display.
 */
export function formatUnlockTimezones(d: Date): Array<{ label: string; value: string }> {
  const pad = (n: number) => String(n).padStart(2, "0");

  // UTC / GMT (same offset)
  const utcDate = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).toUpperCase();
  const utcTime = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

  // WAT = UTC+1
  const watMs = d.getTime() + 60 * 60 * 1000;
  const wat = new Date(watMs);
  const watDate = wat.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // already shifted
  }).toUpperCase();
  const watTime = `${pad(wat.getUTCHours())}:${pad(wat.getUTCMinutes())}:${pad(wat.getUTCSeconds())}`;

  return [
    { label: "UTC", value: `${utcDate}  ${utcTime}` },
    { label: "GMT", value: `${utcDate}  ${utcTime}` },
    { label: "WAT", value: `${watDate}  ${watTime}` },
  ];
}

export function formatCountdown(unlocksAt: Date, now = new Date()): string {
  const ms = unlocksAt.getTime() - now.getTime();
  if (ms <= 0) return "Matured";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (days > 0)
    return `${days}d ${hours.toString().padStart(2, "0")}h ${minutes
      .toString()
      .padStart(2, "0")}m`;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
