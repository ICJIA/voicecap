/**
 * Dates, times, and lists in the plain words the shareable page uses.
 *
 * The times are the local ISO times voicecap records ("2026-09-29T13:15:02-05:00", or to the
 * millisecond). Each is read from its own date and time fields, never through the machine's time
 * zone, so a page reads the same wherever it is built.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

interface Fields {
  year: string;
  /** Without a leading zero. */
  day: string;
  month: string;
  hour: string;
  minute: string;
}

function fieldsOf(iso: string): Fields {
  const found = LOCAL_ISO.exec(iso);
  const [, year, month, day, hour, minute] = found ?? [];
  const monthName = MONTHS[Number(month) - 1];
  if (
    year === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    monthName === undefined ||
    Number(day) < 1 ||
    Number(day) > 31 ||
    Number(hour) > 23 ||
    Number(minute) > 59
  ) {
    throw new Error(`Not a local ISO time: ${JSON.stringify(iso)}`);
  }
  return { year, day: String(Number(day)), month: monthName, hour, minute };
}

/** "30 September 2026". */
export function longDate(iso: string): string {
  const { day, month, year } = fieldsOf(iso);
  return `${day} ${month} ${year}`;
}

/** "29 September". */
export function dayMonth(iso: string): string {
  const { day, month } = fieldsOf(iso);
  return `${day} ${month}`;
}

/** The time of day on a 24-hour clock: "13:15". */
export function clock(iso: string): string {
  const { hour, minute } = fieldsOf(iso);
  return `${hour}:${minute}`;
}

/** A list as a sentence has it: "A", "A and B", "A, B, and C". */
export function names(list: readonly string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")}, and ${list.at(-1)}`;
}
