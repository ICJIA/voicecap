import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { lineText, type Line } from "../src/share/line.js";
import * as text from "../src/share/text.js";

const { HOW_LEAD, HOW_STEPS, STORY, TIMELINE, WHEN_TO_RUN, WORTH_KNOWING } = text;

/** A release's heading in the CHANGELOG: `## [x.y.z] - YYYY-MM-DD`. */
const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;

/** Every `## [` heading in the CHANGELOG, as written, `## [Unreleased]` among them. */
function changelogHeadings(): string[] {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  return changelog.split(/\r?\n/).filter((line) => line.startsWith("## ["));
}

/** The CHANGELOG's releases, as its `## [x.y.z] - YYYY-MM-DD` headings give them: version to date. */
function changelogReleases(): Map<string, string> {
  const releases = new Map<string, string>();
  for (const heading of changelogHeadings()) {
    const [, version, date] = RELEASE_HEADING.exec(heading) ?? [];
    if (version !== undefined && date !== undefined) releases.set(version, date);
  }
  return releases;
}

/** The versions a row's cells name in bold, as `<b>x.y.z</b>`. */
function boldVersions(row: text.TimelineRow): string[] {
  return [row.pc, row.mac, row.both].flatMap((cell) =>
    cell === null
      ? []
      : [...cell.matchAll(/<b>(\d+\.\d+\.\d+)<\/b>/g)].flatMap(([, version]) =>
          version === undefined ? [] : [version],
        ),
  );
}

/** What a function the module exports is called with, to hear what it says: a pass, and a name. */
const SAMPLE = ["read", "current.docx"];

/** Every string the module stores and every function it exports, however deep. */
function leavesOf(value: unknown): unknown[] {
  if (typeof value === "string" || typeof value === "function") return [value];
  if (Array.isArray(value)) return value.flatMap(leavesOf);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(leavesOf);
  return [];
}

/** Every string the module stores, however deep: the page's fixed text as it is written. */
function storedStrings(): string[] {
  return leavesOf(text).filter((leaf): leaf is string => typeof leaf === "string");
}

/**
 * What the module's functions say, each called with sample arguments: the sentence it gives, or the
 * words of the line it gives (its pieces joined, so a check reads across a piece in bold or in
 * code). `storedStrings` can't see these, since it reads no function.
 */
function spokenStrings(): string[] {
  return leavesOf(text)
    .filter((leaf): leaf is (...args: string[]) => string | Line => typeof leaf === "function")
    .map((say) => {
      const said = say(...SAMPLE);
      return typeof said === "string" ? said : lineText(said);
    });
}

/** Every string the module exports or says, however deep: all of the page's fixed text. */
function everyString(): string[] {
  return [...storedStrings(), ...spokenStrings()];
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

  it("names in bold only the release its dated row announces, and no version in a row with none", () => {
    // A bold version the row's `release` doesn't match is never checked against the CHANGELOG's
    // date, so its date could be wrong, or its release missing, with every other test passing.
    const wrong = TIMELINE.flatMap((row) =>
      row.date === null
        ? []
        : boldVersions(row)
            .filter((version) => version !== row.release)
            .map(
              (version) => `${row.date}: <b>${version}</b>, in a row that announces ${row.release}`,
            ),
    );

    // The rows read at all, with versions in bold among them, so a check of nothing can't pass.
    expect(TIMELINE.filter((row) => row.date !== null && boldVersions(row).length > 0)).not.toEqual(
      [],
    );
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

  it("doesn't leave a release in Next once the CHANGELOG has its heading", () => {
    const released = changelogReleases();
    const next = TIMELINE.at(-1);

    // The CHANGELOG read at all, so no release can pass for being absent from it.
    expect(released.has("0.5.0")).toBe(true);
    expect(
      next === undefined ? [] : boldVersions(next).filter((version) => released.has(version)),
    ).toEqual([]);
  });

  it("reads every release heading in the CHANGELOG, so a malformed one can't skip its release's check", () => {
    const headings = changelogHeadings();
    const malformed = headings.filter(
      (heading) => heading !== "## [Unreleased]" && !RELEASE_HEADING.test(heading),
    );

    // Read at all, with the one heading that isn't a release.
    expect(headings).toContain("## [Unreleased]");
    expect(malformed).toEqual([]);
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

  it("tells 0.6.0 in two rows: the shareable page and preflight, then the day it was published", () => {
    // The day before the release, and the release itself: not the row after them, which is dated
    // 2 October too (the Word copy and voicecap share).
    const rows = TIMELINE.filter((row) => row.date === "2026-10-01" || row.release === "0.6.0");

    expect(rows).toEqual([
      {
        date: "2026-10-01",
        release: null,
        pc: null,
        mac: null,
        both: "For 0.6.0, the shareable page: the site's standing, the person's review, and every problem, with a fingerprint check that works offline. Then <code>voicecap preflight</code>, which checks a computer without starting the screen reader.",
      },
      {
        date: "2026-10-02",
        release: "0.6.0",
        pc: null,
        mac: null,
        both: "<b>0.6.0</b>: the shareable page, what each run records for it, and <code>voicecap preflight</code>. A last check on a real Windows PC found that a run didn't end after its closing question, and that NVDA speaks too fast in a run to follow; the first was fixed that day, and the page now says the person heard NVDA speaking, and read the transcripts.",
      },
    ]);
    // 0.5.0's row says what 0.6.0 began to record: whether the person heard NVDA speaking.
    expect(TIMELINE.find((row) => row.release === "0.5.0")?.pc).toBe(
      "<b>0.5.0</b>: a guided demo, each failed page tried up to 5 times, and the reviewer's name on every run. The final checks on a real Windows PC passed. Then, for 0.6.0, runs began recording every failed attempt and whose problem it was, the computer they ran on, and whether the person heard NVDA speaking.",
    );
  });

  it("tells 0.7.0 in two rows: the day the Word copy and voicecap share were made, then the day they were published", () => {
    // Found by their day and release, never by their place: each later feature adds a row after
    // them, which moves them.
    const released = TIMELINE.find((row) => row.release === "0.7.0");
    const made = TIMELINE.find((row) => row.date === "2026-10-02" && row.release === null);

    // The release, across both tracks; and the day the Word copy and voicecap share were made,
    // which announces no release.
    expect(released).toEqual({
      date: "2026-10-03",
      release: "0.7.0",
      pc: null,
      mac: null,
      both: "<b>0.7.0</b>: the Word copy of the shareable report, <code>voicecap share</code>, and <code>voicecap verify</code>'s checks of what was sent.",
    });
    expect(made).toEqual({
      date: "2026-10-02",
      release: null,
      pc: null,
      mac: null,
      both: "For 0.7.0, the Word copy of the shareable report, and <code>voicecap share</code>: dated copies to send, each recorded with its fingerprint.",
    });
    // The day before the release comes first.
    expect(TIMELINE.indexOf(made!)).toBeLessThan(TIMELINE.indexOf(released!));
  });

  it("tells 0.8.0, the walkthrough file, in a row of its own, across both tracks, after 0.7.0's", () => {
    // Made and published on one day, so one row, as 0.4.0's and 0.5.0's are: found by its release.
    const before = TIMELINE.find((row) => row.release === "0.7.0");
    const walkthrough = TIMELINE.find((row) => row.release === "0.8.0");

    // What the file is, and the two ways to use it.
    expect(walkthrough).toEqual({
      date: "2026-10-03",
      release: "0.8.0",
      pc: null,
      mac: null,
      both: "<b>0.8.0</b>: the walkthrough file. <code>voicecap walkthrough</code> writes a run's recipe, and <code>--walkthrough</code> repeats the run exactly, then says page by page how it sounds against the original.",
    });
    expect(TIMELINE.indexOf(walkthrough!)).toBeGreaterThan(TIMELINE.indexOf(before!));
    // No row of that day is left without a release: the walkthrough's day is the release's.
    expect(TIMELINE.filter((row) => row.date === "2026-10-03" && row.release === null)).toEqual([]);
  });

  it("tells the website in a row of its own, across both tracks, after 0.8.0's", () => {
    const before = TIMELINE.find((row) => row.release === "0.8.0");
    // No release has this day yet: the row is found by its day, with no release, and never by its
    // place, which each later feature moves.
    const website = TIMELINE.find((row) => row.date === "2026-10-04" && row.release === null);

    // What the site is: every shared report, by site and by date, with each one's files.
    expect(website).toEqual({
      date: "2026-10-04",
      release: null,
      pc: null,
      mac: null,
      both: "The website: <code>voicecap site</code> builds a site of every shared report, by site and by date, with each one's page, Word copy, and walkthrough files, and their fingerprints.",
    });
    expect(TIMELINE.indexOf(website!)).toBeGreaterThan(TIMELINE.indexOf(before!));
  });

  it("leaves only the evidence recorded at the PC in Next, which is last, with no day and no release", () => {
    const next = TIMELINE.at(-1);

    expect(next?.date).toBeNull();
    expect(next?.release).toBeNull();
    // The website has its own row now: what still comes on the Windows PC is the evidence the runs
    // don't record yet.
    expect(next?.pc).toBe("The event log, screenshots, and NVDA's own log, recorded at the PC.");
    expect(next?.mac).toBe("Full runs with VoiceOver, with voicecap's VoiceOver driver.");
    expect(next?.both).toBeNull();
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

    // The word is there, about other tools (the lead's and the story's "automated checkers", and
    // card 5's axe); a test that found none would be reading nothing. A clause that names voicecap,
    // up to a full stop, a colon, or a semicolon, never calls it automated.
    expect(strings.some((string) => /\bautomated\b/i.test(string))).toBe(true);
    expect(strings.filter((string) => /voicecap[^.:;]*\bautomated\b/i.test(string))).toEqual([]);
  });

  it("says what axe checks: the design of the report's web page, in voicecap's own tests", () => {
    // The page a run writes isn't itself checked as it's written, so the card says what is. It
    // names the web page, so it's as true in the Word copy as on the page.
    expect(WORTH_KNOWING[4]).toEqual({
      title: "Both kinds of testing",
      text: "voicecap checks the design of this report's web page with axe in its own tests, with no violations: the automated checker and the listen-through, side by side.",
    });
  });

  it("tells how voicecap began, word for word, as the owner approved it", () => {
    expect(STORY.began).toBe(
      "voicecap began at the Illinois Criminal Justice Information Authority (ICJIA) with a practical need: more than a dozen websites to review before the April 2027 ADA Title II deadline for accessible digital content. Automated checkers such as axe, Lighthouse, and Pa11y were one half of that review. The other half was to go through every site methodically with a real screen reader, NVDA or VoiceOver, and keep a transcript of what it said.",
    );
  });

  it("opens the story with why voicecap was needed, naming the deadline as the owner does", () => {
    expect(STORY.began).toContain("more than a dozen websites");
    expect(STORY.began).toContain(
      "the April 2027 ADA Title II deadline for accessible digital content",
    );
  });

  it("never names a library as how voicecap began", () => {
    expect(everyString().join("\n")).not.toMatch(/guidepup/i);
  });

  it("reads the sentences its functions say, as well as the text it stores", () => {
    const spoken = spokenStrings();

    // One of each: a line with bold and code, a line with a link, a sentence with a pass in it,
    // and the footer's two lines. A walk that called no function can't pass for the checks above.
    for (const start of [
      "The tools differ between the two runs,",
      "This could be a problem in voicecap itself.",
      "The read pass sounds different,",
      "What the check proves:",
      "This file: read. Its Word copy: current.docx.",
      "This file: current.docx. Its web page: read.",
    ]) {
      expect(
        spoken.some((sentence) => sentence.startsWith(start)),
        start,
      ).toBe(true);
    }
  });

  it("says the person hears NVDA speaking and reads the transcripts, and that NVDA speaks very fast in a run", () => {
    expect(HOW_LEAD).toBe(
      "Automated checkers read a page's code and test it against rules. voicecap takes a real screen reader through each page the way a person would, and saves every word it says. It can spot-check a large site, zero in on the pages that need attention, or go through a whole small site. The person running it reads the transcripts and fixes what they find. voicecap presses the keys and turns the pages, and NVDA speaks very fast as it goes, so the transcripts are where its words are read.",
    );
    expect(HOW_STEPS[4]).toEqual({
      icon: "person",
      title: "A person reads and fixes",
      text: "The person running voicecap hears NVDA at work, and says so when the run ends. NVDA speaks very fast during a run, so the transcripts are where its words are read. The person reads them, records what they found, and fixes it. Flags point to moments worth a closer look.",
    });
  });

  it("never says the person listened during a run, and keeps the word only in the two phrases that stay", () => {
    // Card 5 says "the automated checker and the listen-through", and the band on when to run
    // voicecap says screen reader users hear the deployed site, "so that's the one to listen to".
    const kept = ["the listen-through", "the one to listen to"];
    const strings = everyString();
    const rest = strings.map((string) =>
      kept.reduce((left, phrase) => left.replaceAll(phrase, ""), string),
    );

    // The phrases are there, so a test that found no "listen" at all can't pass for this.
    expect(kept.filter((phrase) => !strings.some((string) => string.includes(phrase)))).toEqual([]);
    expect(rest.filter((string) => /listen/i.test(string))).toEqual([]);
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

  it("leaves no stored text blank, or padded with spaces", () => {
    // The pieces of a line, which a function gives, end in a space where a word in bold or code
    // follows, so only what the module stores is read.
    expect(storedStrings().filter((string) => string === "" || string !== string.trim())).toEqual(
      [],
    );
  });

  it("quotes the study by its article's own headline, once in the story, for the renderer to link to Deque", () => {
    const { title, url } = STORY.deque;

    // Deque's headline word for word, as the article prints it (published 10 March 2021). A quoted
    // title shown to auditors must be exact, so it is never trimmed.
    expect(title).toBe(
      "Deque Study Shows Its Automated Testing Identifies 57 Percent of Digital Accessibility Issues, Surpassing Accepted Industry Benchmarks",
    );
    expect(STORY.why.split(title)).toHaveLength(2);
    expect(STORY.why).toContain(`“${title}”`);
    expect(new URL(url).protocol).toBe("https:");
    expect(new URL(url).hostname).toBe("www.deque.com");
  });
});
