import { describe, expect, it } from "vitest";

import { clock, dayMonth, longDate, names } from "../src/share/format.js";

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
