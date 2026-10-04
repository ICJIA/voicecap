import { describe, expect, it } from "vitest";

import {
  clock,
  dateRange,
  dayMonth,
  longDate,
  names,
  pagePath,
  pageTitle,
  seconds,
  sizeLine,
  sizeWords,
  utcOffset,
} from "../src/share/format.js";

describe("longDate, dayMonth, and clock", () => {
  it("write a recorded time as its date and time, for a reader", () => {
    const time = "2026-09-29T13:15:02-05:00";

    expect(longDate(time)).toBe("29 September 2026");
    expect(dayMonth(time)).toBe("29 September");
    expect(clock(time)).toBe("13:15");
  });

  it("read a time recorded to the millisecond the same way", () => {
    const time = "2026-09-30T14:05:09.482-05:00";

    expect(longDate(time)).toBe("30 September 2026");
    expect(dayMonth(time)).toBe("30 September");
    expect(clock(time)).toBe("14:05");
  });

  it("leave off a day's leading zero, and keep a clock's", () => {
    const time = "2026-01-05T00:07:00-06:00";

    expect(longDate(time)).toBe("5 January 2026");
    expect(dayMonth(time)).toBe("5 January");
    expect(clock(time)).toBe("00:07");
  });

  it("name every month", () => {
    const months = [
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

    expect(
      months.map((_, index) =>
        dayMonth(`2026-${String(index + 1).padStart(2, "0")}-15T10:00:00-06:00`),
      ),
    ).toEqual(months.map((month) => `15 ${month}`));
  });

  it("go by the time's own fields, never the machine's time zone", () => {
    // In UTC the first is 04:30 on 30 September, and the second 14:20 on 29 September. Whatever the
    // machine's zone, at least one would read differently if it were applied.
    const behindUtc = "2026-09-29T23:30:00-05:00";
    const aheadOfUtc = "2026-09-30T00:20:00+10:00";

    expect([dayMonth(behindUtc), clock(behindUtc)]).toEqual(["29 September", "23:30"]);
    expect([dayMonth(aheadOfUtc), clock(aheadOfUtc)]).toEqual(["30 September", "00:20"]);
    expect(longDate(behindUtc)).toBe("29 September 2026");
    expect(longDate(aheadOfUtc)).toBe("30 September 2026");
  });

  it.each([
    "yesterday",
    "",
    "2026-09-29",
    "on 2026-09-29T13:15:02-05:00",
    "2026-00-10T10:00:00-05:00",
    "2026-13-01T10:00:00-05:00",
    "2026-09-00T10:00:00-05:00",
    "2026-09-32T10:00:00-05:00",
    "2026-09-29T24:00:00-05:00",
    "2026-09-29T10:60:00-05:00",
  ])("refuse %j, which isn't a recorded local time", (text) => {
    expect(() => longDate(text)).toThrow(/local ISO time/);
    expect(() => dayMonth(text)).toThrow(/local ISO time/);
    expect(() => clock(text)).toThrow(/local ISO time/);
  });
});

describe("utcOffset", () => {
  it("writes a recorded time's offset from UTC as a reader does, with a minus sign", () => {
    expect(utcOffset("2026-09-29T13:15:02-05:00")).toBe("UTC−05:00");
    expect(utcOffset("2026-09-29T13:15:02.481+05:30")).toBe("UTC+05:30");
    expect(utcOffset("2026-09-29T18:15:02.481Z")).toBe("UTC+00:00");
  });

  it("refuses a time with no offset", () => {
    expect(() => utcOffset("2026-09-29T13:15:02")).toThrow("Not a local ISO time");
  });
});

describe("names", () => {
  it("joins a list the way a sentence does", () => {
    expect(names([])).toBe("");
    expect(names(["A"])).toBe("A");
    expect(names(["A", "B"])).toBe("A and B");
    expect(names(["A", "B", "C"])).toBe("A, B, and C");
    expect(names(["A", "B", "C", "D"])).toBe("A, B, C, and D");
  });

  it("leaves each name as it is", () => {
    expect(names(["Pat Reviewer, Sr.", "Lee"])).toBe("Pat Reviewer, Sr. and Lee");
  });
});

describe("dateRange", () => {
  it.each([
    ["the same day", "2026-09-30T09:00:00-05:00", "2026-09-30T17:30:00-05:00", "30 September 2026"],
    [
      "the same time",
      "2026-09-30T09:00:00-05:00",
      "2026-09-30T09:00:00-05:00",
      "30 September 2026",
    ],
    [
      "two days of a month",
      "2026-09-29T23:30:00-05:00",
      "2026-09-30T00:20:00-05:00",
      "29 to 30 September 2026",
    ],
    [
      "two months of a year",
      "2026-09-30T10:00:00-05:00",
      "2026-10-02T10:00:00-05:00",
      "30 September to 2 October 2026",
    ],
    [
      "two years",
      "2026-12-30T10:00:00-06:00",
      "2027-01-02T10:00:00-06:00",
      "30 December 2026 to 2 January 2027",
    ],
  ])("writes %s as one date or a range", (_, first, last, expected) => {
    expect(dateRange(first, last)).toBe(expected);
  });

  it("leaves off a day's leading zero, and reads times to the millisecond", () => {
    expect(dateRange("2026-01-05T00:07:00.250-06:00", "2026-01-09T10:00:00.000-06:00")).toBe(
      "5 to 9 January 2026",
    );
  });

  it("goes by the times' own dates, never the machine's time zone", () => {
    // In UTC the first is 04:30 on 30 September and the second 14:20 on 29 September: the other way
    // round. Whatever the machine's zone, a range read through it would differ.
    expect(dateRange("2026-09-29T23:30:00-05:00", "2026-09-30T00:20:00+10:00")).toBe(
      "29 to 30 September 2026",
    );
  });

  it("refuses a time that isn't a recorded local time", () => {
    expect(() => dateRange("yesterday", "2026-09-30T09:00:00-05:00")).toThrow(/local ISO time/);
    expect(() => dateRange("2026-09-30T09:00:00-05:00", "2026-09-31")).toThrow(/local ISO time/);
  });
});

describe("seconds", () => {
  it.each([
    [0, "0.0 s"],
    [50, "0.1 s"],
    [1_249, "1.2 s"],
    [1_276, "1.3 s"],
    [1_318, "1.3 s"],
    [2_742, "2.7 s"],
    [61_931, "61.9 s"],
  ])("writes %i ms in seconds, to the tenth", (ms, expected) => {
    expect(seconds(ms)).toBe(expected);
  });
});

describe("sizeWords", () => {
  it.each([
    // Whole KB, rounded, and never under 1, with thousands separators, for as long as the rounded
    // KB is under 1,024.
    [0, "1 KB"],
    [1, "1 KB"],
    [512, "1 KB"],
    [3_676, "4 KB"],
    [317_440, "310 KB"],
    [1_047_551, "1,023 KB"],
    [1_048_063, "1,023 KB"],
    // From there MB with one decimal: the switch is where the rounded KB reaches 1,024 (1,048,064
    // bytes, which is 1,023.5 KB), not at 1,048,576 bytes, so no size ever reads "1,024 KB".
    [1_048_064, "1.0 MB"],
    [1_048_576, "1.0 MB"],
    [1_234_567, "1.2 MB"],
    [24_536_679, "23.4 MB"],
  ])("gives %i bytes as %s, with no count of bytes", (bytes, said) => {
    expect(sizeWords(bytes)).toBe(said);
  });
});

describe("sizeLine", () => {
  it.each([
    [0, "1 KB (0 bytes)"],
    [1, "1 KB (1 byte)"],
    [512, "1 KB (512 bytes)"],
    [317_440, "310 KB (317,440 bytes)"],
    [1_047_551, "1,023 KB (1,047,551 bytes)"],
    [1_048_063, "1,023 KB (1,048,063 bytes)"],
    [1_048_064, "1.0 MB (1,048,064 bytes)"],
    [1_048_575, "1.0 MB (1,048,575 bytes)"],
    [1_048_576, "1.0 MB (1,048,576 bytes)"],
    [1_234_567, "1.2 MB (1,234,567 bytes)"],
    [24_536_679, "23.4 MB (24,536,679 bytes)"],
  ])("gives %i bytes as %s", (bytes, said) => {
    expect(sizeLine(bytes)).toBe(said);
  });

  it("is the size in words, then its bytes", () => {
    for (const bytes of [0, 1, 999, 317_440, 1_048_064, 24_536_679]) {
      expect(sizeLine(bytes)).toBe(
        `${sizeWords(bytes)} (${bytes.toLocaleString("en-US")} ${bytes === 1 ? "byte" : "bytes"})`,
      );
    }
  });

  it("never says 1,024 KB, and goes from KB to MB once, at 1,048,064 bytes", () => {
    // Every size from a way under the switch to a way over it.
    const lines: string[] = [];
    for (let bytes = 1_000_000; bytes <= 1_100_000; bytes++) lines.push(sizeLine(bytes));
    const unit = (line: string) => (line.includes(" KB (") ? "KB" : "MB");
    const first = lines.findIndex((line) => unit(line) === "MB");
    expect(1_000_000 + first).toBe(1_048_064);
    expect(lines.slice(0, first).every((line) => unit(line) === "KB")).toBe(true);
    expect(lines.slice(first).every((line) => unit(line) === "MB")).toBe(true);
    expect(lines.some((line) => /^1,?024 KB/.test(line))).toBe(false);
  });
});

describe("pagePath", () => {
  it("leaves the site off a page's address, and keeps its query", () => {
    expect(pagePath("http://127.0.0.1:4848/")).toBe("/");
    expect(pagePath("http://127.0.0.1:4848/how-a-run-works/")).toBe("/how-a-run-works/");
    expect(pagePath("https://example.illinois.gov/grants?year=2027#apply")).toBe(
      "/grants?year=2027",
    );
  });
});

describe("pageTitle", () => {
  it("is the page's label, without the spaces around it", () => {
    expect(pageTitle({ label: "  About us ", url: "http://127.0.0.1:4848/about/" })).toBe(
      "About us",
    );
  });

  it("is the page's address without the site's when it has no label, or a blank one", () => {
    expect(pageTitle({ url: "http://127.0.0.1:4848/how-a-run-works/" })).toBe("/how-a-run-works/");
    expect(pageTitle({ label: "   ", url: "https://example.illinois.gov/grants?year=2027" })).toBe(
      "/grants?year=2027",
    );
  });
});
