import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as text from "../src/share/text.js";

const { HOW_STEPS, STORY, TIMELINE, WHEN_TO_RUN, WORTH_KNOWING } = text;

/** The CHANGELOG's releases, as its `## [x.y.z] - YYYY-MM-DD` headings give them: version to date. */
function changelogReleases(): Map<string, string> {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const releases = new Map<string, string>();
  for (const heading of changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm)) {
    const [, version, date] = heading;
    if (version !== undefined && date !== undefined) releases.set(version, date);
  }
  return releases;
}

/** Every string the module exports, however deep: all of the page's fixed text. */
function everyString(): string[] {
  const found: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") found.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(collect);
  };
  collect(text);
  return found;
}

describe("the timeline", () => {
  it("dates every release in the timeline as the CHANGELOG does", () => {
    const dates = changelogReleases();

    const wrong = TIMELINE.flatMap((row) => {
      if (row.release === null) return [];
      const recorded = dates.get(row.release);
      return row.date === recorded
        ? []
        : [`${row.release}: the row says ${row.date}, the CHANGELOG says ${recorded}`];
    });

    expect(wrong).toEqual([]);
  });

  it("gives every minor release its line", () => {
    const minors = [...changelogReleases().keys()].filter((version) =>
      /^\d+\.\d+\.0$/.test(version),
    );
    const announced = new Set(TIMELINE.map((row) => row.release));

    // The CHANGELOG read at all, so an empty list can't pass for "every release has its line".
    expect(minors).toEqual(expect.arrayContaining(["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]));
    expect(minors.filter((version) => !announced.has(version))).toEqual([]);
  });

  it("keeps the rows in date order, with Next last", () => {
    const dates = TIMELINE.map((row) => row.date);
    const dated = dates.slice(0, -1);

    expect(dates.at(-1)).toBeNull();
    expect(dated.every((date) => date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true);
    expect(dated).toEqual([...dated].sort());
  });

  it("puts a row's words in its two tracks, or across both", () => {
    const wrong = TIMELINE.filter((row) =>
      row.both === null ? row.pc === null && row.mac === null : row.pc !== null || row.mac !== null,
    );

    expect(wrong).toEqual([]);
  });

  it("writes each cell as bold and code only, or leaves it null, so the renderer can insert it as given", () => {
    const cells = TIMELINE.flatMap((row) => [row.pc, row.mac, row.both]).filter(
      (cell) => cell !== null,
    );
    const markup = /<(b|code)>[^<>&]*<\/\1>/g;

    expect(cells.filter((cell) => cell.trim() === "")).toEqual([]);
    expect(cells.filter((cell) => /[<>&]/.test(cell.replace(markup, "")))).toEqual([]);
  });
});

describe("the fixed text", () => {
  it("never calls voicecap automated", () => {
    const strings = everyString();

    // The word is there, about other tools (the lead's and the story's "automated checkers"); a test
    // that found none would be reading nothing.
    expect(strings.some((string) => /\bautomated\b/i.test(string))).toBe(true);
    expect(strings.filter((string) => /voicecap[^.]*\bautomated\b/i.test(string))).toEqual([]);
  });

  it("has the parts the renderers draw: six steps with their icons, four stages with one marked, six cards", () => {
    expect(HOW_STEPS.map((step) => step.icon)).toEqual([
      "list",
      "reader",
      "three",
      "words",
      "person",
      "seal",
    ]);
    expect(WHEN_TO_RUN.stages).toHaveLength(4);
    expect(WHEN_TO_RUN.stages.filter((stage) => stage.marked).map((stage) => stage.title)).toEqual([
      "Before launch",
    ]);
    expect(WORTH_KNOWING).toHaveLength(6);
  });

  it("leaves no text blank, or padded with spaces", () => {
    expect(everyString().filter((string) => string === "" || string !== string.trim())).toEqual([]);
  });

  it("quotes the study's title once in the story, for the renderer to link to Deque", () => {
    const { title, url } = STORY.deque;

    expect(STORY.why.split(title)).toHaveLength(2);
    expect(new URL(url).protocol).toBe("https:");
    expect(new URL(url).hostname).toBe("www.deque.com");
  });
});
