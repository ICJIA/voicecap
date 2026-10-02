/**
 * Dates, times, lists, numbers, and page names and addresses in the plain words the shareable
 * report uses.
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

/**
 * The days from one time to another, as short as they can be written: "30 September 2026" for one
 * day, "29 to 30 September 2026", "30 September to 2 October 2026", and "30 December 2026 to
 * 2 January 2027". Each end goes by its own date; `first` is the earlier.
 */
export function dateRange(first: string, last: string): string {
  const from = fieldsOf(first);
  const to = fieldsOf(last);
  if (from.year !== to.year) return `${longDate(first)} to ${longDate(last)}`;
  if (from.month !== to.month) {
    return `${from.day} ${from.month} to ${to.day} ${to.month} ${to.year}`;
  }
  if (from.day !== to.day) return `${from.day} to ${to.day} ${to.month} ${to.year}`;
  return longDate(first);
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

/**
 * A recorded time's offset from UTC, as a reader writes it: "UTC−05:00", with a minus sign, not a
 * hyphen, and "UTC+00:00" for a time recorded in UTC ("Z").
 */
export function utcOffset(iso: string): string {
  const found = /(?:([+-])(\d{2}):(\d{2})|Z)$/.exec(iso);
  if (found === null) throw new Error(`Not a local ISO time: ${JSON.stringify(iso)}`);
  const [, sign = "+", hours = "00", minutes = "00"] = found;
  return `UTC${sign === "-" ? "−" : "+"}${hours}:${minutes}`;
}

/** How long something took, in seconds to the nearest tenth: "1.3 s". */
export function seconds(ms: number): string {
  return `${(Math.round(Math.max(0, ms) / 100) / 10).toFixed(1)} s`;
}

/** A page's address without the site's: its path, and its query if it has one ("/about/"). */
export function pagePath(url: string): string {
  const { pathname, search } = new URL(url);
  return `${pathname}${search}`;
}

/** What a page is called on a line of the page: its label, else its address without the site's. */
export function pageTitle(page: { label?: string; url: string }): string {
  return page.label?.trim() || pagePath(page.url);
}

/** A list as a sentence has it: "A", "A and B", "A, B, and C". */
export function names(list: readonly string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")}, and ${list.at(-1)}`;
}

/**
 * A whole number as a report writes it, on any computer: "1,204". It's made a number first, so a
 * record's field that holds something else never reaches a copy as markup.
 */
export const count = (value: number): string => Number(value).toLocaleString("en-US");
