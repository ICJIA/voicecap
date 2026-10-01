/** Local date and time as used in run ids and manual session names, e.g. 2026-09-26_1405. */
export function localStamp(date: Date): string {
  return `${localDate(date)}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Local calendar date, e.g. 2026-09-26. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO 8601 with the local UTC offset, e.g. 2026-09-26T14:05:09-05:00. */
export function isoLocal(date: Date): string {
  return localIso(date, "");
}

/** The same to the millisecond, e.g. 2026-09-26T14:05:09.482-05:00. */
export function isoLocalMs(date: Date): string {
  return localIso(date, `.${String(date.getMilliseconds()).padStart(3, "0")}`);
}

/** `fraction` (".482", or nothing) follows the seconds. */
function localIso(date: Date, fraction: string): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${fraction}`;
  return `${localDate(date)}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Human duration: 850ms, 12s, 5m 48s, 7h 10m, 2d 3h. */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (safe < 1000) return `${Math.round(safe)}ms`;
  const totalSeconds = Math.round(safe / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
