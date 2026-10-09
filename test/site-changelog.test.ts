/**
 * voicecap's CHANGELOG as the website reads it (src/site/changelog.ts): each dated release, with
 * its date, its headline, and its items (the bold words that begin each bullet of its entry, at the
 * first two levels); what is skipped; how a line's words are made plain, with a code span set apart
 * and a link as its words; and the address of a release's entry on GitHub.
 *
 * What the pages do with a release is in test/site-whats-new.test.ts and test/site-trust.test.ts.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { changelogHref, parseChangelog } from "../src/site/changelog.js";
import type { ReleaseItem, VoicecapRelease } from "../src/site/facts.js";
import { TRUST_TEXT } from "../src/site/trust-text.js";

/** A CHANGELOG as voicecap keeps one: the unreleased heading, then each release, newest first. */
const CHANGELOG = [
  "# Changelog",
  "",
  "All notable changes to voicecap are recorded here.",
  "",
  "## [Unreleased]",
  "",
  "## [0.13.1] - 2026-10-08",
  "",
  "### Changed",
  "",
  "- **The website's headings say more at a glance, and each site links to the site itself.** " +
    'The README\'s "The website: `voicecap site`" describes it.',
  '  - **Each site\'s name has "Visit the site" beside it:** a link to the site.',
  "",
  "## [0.10.0] - 2026-10-05",
  "",
  "Canonical site names: everything voicecap makes for readers names a site by its address.",
  "",
  "### Added",
  "",
  "- **Another thing.** Not the first line.",
  "",
  "## [0.4.1] - 2026-09-29",
  "",
  "- **`--sitemap` takes a sitemap's name or path**, such as `--sitemap sitemap.xml`.",
  "",
].join("\n");

/** What `CHANGELOG` comes to. */
const RELEASES: VoicecapRelease[] = [
  {
    version: "0.13.1",
    date: "2026-10-08",
    headline: "The website's headings say more at a glance, and each site links to the site itself",
    items: [['Each site\'s name has "Visit the site" beside it']],
  },
  {
    version: "0.10.0",
    date: "2026-10-05",
    headline: "Canonical site names",
    items: [["Another thing"]],
  },
  {
    version: "0.4.1",
    date: "2026-09-29",
    headline: "--sitemap takes a sitemap's name or path",
    items: [],
  },
];

/** A CHANGELOG of one release, `body` being what is under its heading. */
function changelogOf(body: string): string {
  return `## [1.0.0] - 2026-01-01\n\n${body}\n`;
}

/** The headline of the one release that `changelogOf(body)` makes. */
function headlineOf(body: string): string | undefined {
  return parseChangelog(changelogOf(body))[0]?.headline;
}

/**
 * The items of the one release whose entry is `lines`, a headline's line (a bullet, as an entry's
 * first line is) and then each of `lines`: so that no item of a test is its release's headline.
 */
function itemsOf(...lines: string[]): ReleaseItem[] | undefined {
  return parseChangelog(changelogOf(["- **The headline.** More", ...lines].join("\n")))[0]?.items;
}

describe("parseChangelog", () => {
  it("reads each dated release, newest first, with its first line and its items", () => {
    expect(parseChangelog(CHANGELOG)).toEqual(RELEASES);
  });

  it("reads a CHANGELOG written with Windows line endings the same", () => {
    expect(parseChangelog(CHANGELOG.replace(/\n/g, "\r\n"))).toEqual(RELEASES);
  });

  it("reads the real CHANGELOG", async () => {
    const text = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const releases = parseChangelog(text);
    // Between "Prepare x.y.z" and "Release vx.y.z" the CHANGELOG's newest entry is a version ahead
    // of package.json, so the installed version is one of the entries, not always the first.
    expect(releases.map((release) => release.version)).toContain(version);
    for (const { version, date, headline } of releases) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(headline).not.toBe("");
      // Plain text: no code marks, no bold, and no link markup left in it.
      expect(headline).not.toMatch(/`|\*\*|\]\(/);
      // The banner and the trust page print each headline, so none may name Guidepup or say a
      // person listened. (An item may: What's New is the record for those who want the detail.)
      expect(headline, version).not.toMatch(/guidepup|listen/i);
    }
  });

  it("gives the real CHANGELOG's items as words and code, with no empty piece and no link left in", async () => {
    const text = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const releases = parseChangelog(text);
    const pairs = releases.flatMap((release) => release.items.map((item) => ({ release, item })));
    // Most releases have points of their own.
    expect(pairs.length).toBeGreaterThan(releases.length);

    for (const { release, item } of pairs) {
      const where = `${release.version}: ${JSON.stringify(item)}`;
      expect(item.length, where).toBeGreaterThan(0);
      for (const piece of item) {
        if (typeof piece === "string") {
          expect(piece, where).not.toBe("");
          expect(piece, where).not.toMatch(/\]\(/);
        } else {
          expect(piece.code, where).not.toBe("");
          expect(piece.code, where).not.toContain("`");
        }
      }
      // The words begin and end with a word, not a space.
      const first = item[0];
      const last = item[item.length - 1];
      if (typeof first === "string") expect(first, where).toBe(first.trimStart());
      if (typeof last === "string") expect(last, where).toBe(last.trimEnd());
    }
  });

  it("skips [Unreleased] and any heading that isn't a dated release", () => {
    expect(
      parseChangelog("## [0.14.0]\n\n- **Soon.**\n\n## [Unreleased]\n\n- **Later.**\n"),
    ).toEqual([]);
  });

  it("skips [Unreleased], whose bullets are no release's items either", () => {
    const text = [
      "## [Unreleased]",
      "",
      "- **Later.**",
      "  - **Also later.**",
      "",
      "## [0.2.0] - 2026-09-27",
      "",
      "- **Now.**",
      "  - **A point of now.**",
      "",
      "## [Unreleased again]",
      "",
      "  - **Not a point of 0.2.0.**",
      "",
    ].join("\n");

    expect(parseChangelog(text)).toEqual([
      {
        version: "0.2.0",
        date: "2026-09-27",
        headline: "Now",
        items: [["A point of now"]],
      },
    ]);
  });

  it.each([
    ["a version with no date", "## [0.14.0]"],
    ["a date that isn't one", "## [0.14.0] - soon"],
    ["a date written another way", "## [0.14.0] - 2026-10-9"],
    ["a month the calendar doesn't have", "## [0.14.0] - 2026-13-01"],
    ["a day the calendar doesn't have", "## [0.14.0] - 2026-02-30"],
    ["a version of two numbers", "## [0.14] - 2026-10-08"],
    ["a version with no brackets", "## 0.14.0 - 2026-10-08"],
    ["a heading of another level", "### [0.14.0] - 2026-10-08"],
    ["a heading that doesn't start its line", " ## [0.14.0] - 2026-10-08"],
    ["a heading with more after the date", "## [0.14.0] - 2026-10-08 [YANKED]"],
  ])("skips %s", (_name, heading) => {
    expect(parseChangelog(`${heading}\n\n- **Words.**\n`)).toEqual([]);
  });

  it("ends a release at the next heading, whatever it is", () => {
    const text = [
      "## [0.3.0] - 2026-09-28",
      "",
      "## [Unreleased]",
      "",
      "- **Soon.**",
      "",
      "## [0.2.0] - 2026-09-27",
      "",
      "## [0.1.0] - 2026-09-26",
      "",
      "Phase A: everything.",
      "",
    ].join("\n");
    // A release with nothing under its heading is still a release, with no first line to give.
    expect(parseChangelog(text)).toEqual([
      { version: "0.3.0", date: "2026-09-28", headline: "", items: [] },
      { version: "0.2.0", date: "2026-09-27", headline: "", items: [] },
      { version: "0.1.0", date: "2026-09-26", headline: "Phase A", items: [] },
    ]);
  });

  it("gives nothing for a CHANGELOG with no release in it", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog("# Changelog\n\nNothing yet.\n")).toEqual([]);
  });

  describe("words a headline as plain text", () => {
    it.each([
      [
        "a bold bullet's words, less the comma that closes them",
        "- **It has a new order,** so a manager meets the result first.",
        "It has a new order",
      ],
      [
        "a bold bullet's words, less the period that closes them",
        "- **It has a new order.** The README says so.",
        "It has a new order",
      ],
      [
        "a bold bullet's words alone, when a colon follows them",
        "- **A preflight check at the start of `init`**: before any question, it shows details.",
        "A preflight check at the start of init",
      ],
      [
        "a bold bullet's words, with a link as its words",
        "- **See [the README](README.md#the-website) for it.** More.",
        "See the README for it",
      ],
      [
        "a bullet that isn't bold, up to its first colon",
        "- Plain bullet: with detail.",
        "Plain bullet",
      ],
      ["a bullet marked with a star", "* **Starred bullet.** With detail.", "Starred bullet"],
      [
        "a paragraph that starts with bold words, as a bold bullet does",
        "**Phase C.** The Mac comes later.",
        "Phase C",
      ],
      [
        "a paragraph, up to its first colon",
        "Phase B: the real NVDA driver, checked with NVDA 2026.2.",
        "Phase B",
      ],
      [
        "a paragraph, up to its first period and space",
        "Each run records an event log. The page shows it: minute by minute.",
        "Each run records an event log",
      ],
      ["a paragraph, up to whichever of the two comes first", "It works. Then: more.", "It works"],
      [
        "a paragraph, with code and a link as plain words",
        "The [website](https://example.org/): `voicecap site` writes a site. Later.",
        "The website",
      ],
      [
        "a paragraph with no colon or period and space, all of it",
        "One thing only",
        "One thing only",
      ],
      [
        "a paragraph whose points are in a number, not at a sentence's end",
        "NVDA 2026.2 on Windows 11",
        "NVDA 2026.2 on Windows 11",
      ],
    ])("takes %s", (_name, body, headline) => {
      expect(headlineOf(body)).toBe(headline);
    });

    it("takes the first line that isn't blank or a heading, and no later one", () => {
      // A line of only spaces or a tab is as blank as an empty one.
      const body = "  \n\t\n### Added\n\n### Changed\n\nFirst: line.\nSecond: line.";
      expect(headlineOf(body)).toBe("First");
    });
  });

  describe("gives a release its items", () => {
    it("gives each release its items: the bold words that begin each bullet at the first two levels, but the headline's", () => {
      expect(
        itemsOf(
          "  - **Item one:** more",
          "  - **Item `two`,** more",
          "    - **Too deep** x",
          "- plain bullet: the rest",
        ),
      ).toEqual([["Item one"], ["Item ", { code: "two" }], ["plain bullet"]]);
    });

    it("keeps a link's words, and no other Markdown", () => {
      expect(itemsOf("- **See [the README](x).**")).toEqual([["See the README"]]);
      // A link in a code span's place, and in words that aren't bold: its words, too.
      expect(itemsOf("- [`voicecap site`](README.md#the-website) builds it. More.")).toEqual([
        [{ code: "voicecap site" }, " builds it"],
      ]);
      // Nothing else becomes anything: a mark that isn't a link or a code span is a plain character.
      expect(itemsOf("- Some *words*, __more__, and ~~less~~: x")).toEqual([
        ["Some *words*, __more__, and ~~less~~"],
      ]);
    });

    it("takes an unbalanced backtick as a plain character", () => {
      expect(itemsOf("- **One ` tick**")).toEqual([["One ` tick"]]);
      // A pair is a code span, and the one left over is plain.
      expect(itemsOf("- **A `pair` and ` one**")).toEqual([["A ", { code: "pair" }, " and ` one"]]);
      expect(itemsOf("- ` one: two")).toEqual([["` one"]]);
    });

    it("splits the words at each balanced pair of backticks, the code's own spaces kept", () => {
      expect(itemsOf("- **`one` and `two words`, then `three`.** x")).toEqual([
        [{ code: "one" }, " and ", { code: "two words" }, ", then ", { code: "three" }],
      ]);
      expect(itemsOf("- **`a`**")).toEqual([[{ code: "a" }]]);
      // Two backticks with nothing between them are no code span.
      expect(itemsOf("- **Empty `` pair**")).toEqual([["Empty `` pair"]]);
    });

    it.each([
      ["a period", "- **Item.** More", "Item"],
      ["a comma", "- **Item,** More", "Item"],
      ["a colon", "- **Item:** More", "Item"],
      ["one mark, and no more", "- **Item..** More", "Item."],
      ["a mark that isn't one of the three", "- **Item!** More", "Item!"],
      ["a semicolon, which isn't one of the three", "- **Item;** More", "Item;"],
      ["none, with a colon after the bold words", "- **Item**: more", "Item"],
      ["none, with a comma after the bold words", "- **Item**, more", "Item"],
    ])("takes a bold bullet's words, less a closing mark: %s", (_name, line, words) => {
      expect(itemsOf(line)).toEqual([[words]]);
    });

    it.each([
      ["up to its first colon", "- Plain bullet: with detail.", "Plain bullet"],
      ["up to its first period and space", "- Plain bullet. With detail: more.", "Plain bullet"],
      ["up to whichever of the two comes first", "- One: two. Three.", "One"],
      ["all of it, with neither", "- Just a few words", "Just a few words"],
      ["all of it, its own period kept, when no space follows it", "- Just words.", "Just words."],
      [
        "up to a colon that has a space after it, and not one that hasn't",
        "- At 12:30: go",
        "At 12:30",
      ],
      ["a bullet marked with a star", "* Starred: more", "Starred"],
      ["a bullet marked with a plus", "+ Added: more", "Added"],
      ["a bullet whose words come after more than one space", "-   Spaced: more", "Spaced"],
    ])("takes the words of a bullet that isn't bold: %s", (_name, line, words) => {
      expect(itemsOf(line)).toEqual([[words]]);
    });

    it("does not end a bullet's words at a colon or a period inside a code span", () => {
      expect(itemsOf("- Run `voicecap site: now. ok` today: then more")).toEqual([
        ["Run ", { code: "voicecap site: now. ok" }, " today"],
      ]);
      // A code span that is followed by the colon, or the period, ends the words after it.
      expect(itemsOf("- `voicecap site`: builds the website")).toEqual([
        [{ code: "voicecap site" }],
      ]);
      expect(itemsOf("- Use `--rate`. It sets the speed")).toEqual([["Use ", { code: "--rate" }]]);
    });

    it.each([
      ["no space", "-**Not a bullet**"],
      ["a horizontal rule", "---"],
      ["a bullet three spaces in", "   - **Too deep**"],
      ["a bullet four spaces in", "    - **Too deep**"],
      ["a bullet that is tabbed in", "\t- **Too deep**"],
      ["a bullet in a numbered list", "1. **Numbered**"],
      ["a paragraph", "A paragraph: with words."],
      ["a heading", "### Added"],
      ["a blank line", ""],
    ])("counts no line that is %s", (_name, line) => {
      expect(itemsOf(line)).toEqual([]);
    });

    it("counts a bullet at the first level and at the second, and no deeper", () => {
      expect(
        itemsOf(
          "- **One.** x",
          " - **A space in.** x",
          "  - **Two spaces in.** x",
          "   - **Three spaces in.** x",
          "    - **Four spaces in.** x",
          "      - **Six spaces in.** x",
        ),
      ).toEqual([["One"], ["A space in"], ["Two spaces in"]]);
    });

    it("counts the bullets of every part of an entry, whatever its heading, in order", () => {
      const text = [
        "## [0.2.0] - 2026-09-27",
        "",
        "### Added",
        "",
        "- **A.** x",
        "  - **A one.** x",
        "",
        "### Changed",
        "",
        "- **B.** x",
        "",
        "### Fixed",
        "",
        "- **C.** x",
        "",
      ].join("\n");

      expect(parseChangelog(text)[0]).toEqual({
        version: "0.2.0",
        date: "2026-09-27",
        headline: "A",
        // The first bullet gave the headline; every other counts.
        items: [["A one"], ["B"], ["C"]],
      });
    });

    it("takes the first bullet as the headline's, and counts every bullet when the headline is a paragraph", () => {
      const text = [
        "## [0.2.0] - 2026-09-27",
        "",
        "Phase B: the real driver.",
        "",
        "### Added",
        "",
        "- **First.** x",
        "- **Second.** x",
        "",
      ].join("\n");

      expect(parseChangelog(text)[0]).toMatchObject({
        headline: "Phase B",
        items: [["First"], ["Second"]],
      });
    });

    it("gives no item for a bullet that has no words", () => {
      expect(itemsOf("- ", "- **.**", "- **  **", "- **Real.** x")).toEqual([["Real"]]);
    });

    it("gives the words of an item as the CHANGELOG has them, with no markup made of them", () => {
      expect(
        itemsOf("- **<script>alert(1)</script> & <b>bold</b>.** x", "- <i>x</i> & y: z"),
      ).toEqual([["<script>alert(1)</script> & <b>bold</b>"], ["<i>x</i> & y"]]);
    });

    it("counts a bullet whose words hold a line separator or a lone carriage return, neither of which ends a line here", () => {
      expect(itemsOf("- **A B.** x", "- C\rD: x")).toEqual([["A B"], ["C\rD"]]);
    });

    it("never gives an item to the release before, from a bullet under a heading that isn't a release", () => {
      const text = "## [0.2.0] - 2026-09-27\n\n- **Now.** x\n\n## [Unreleased]\n\n- **Later.** x\n";
      expect(parseChangelog(text)[0]?.items).toEqual([]);
    });
  });
});

describe("changelogHref", () => {
  it("links each release to its heading on GitHub", () => {
    expect(changelogHref({ version: "0.13.1", date: "2026-10-08" })).toBe(
      "https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md#0131---2026-10-08",
    );
    expect(changelogHref({ version: "0.4.1", date: "2026-09-29" })).toBe(
      "https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md#041---2026-09-29",
    );
  });

  it("makes the anchor as GitHub does of `## [x.y.z] - YYYY-MM-DD`: in lower case, with each character that isn't a letter, digit, space, or hyphen dropped, and each space a hyphen", () => {
    const anchor = (version: string, date: string): string =>
      changelogHref({ version, date }).split("#")[1] ?? "";

    expect(anchor("0.13.1", "2026-10-08")).toBe("0131---2026-10-08");
    expect(anchor("1.0.0-RC.1", "2026-01-01")).toBe("100-rc1---2026-01-01");
    // Nothing but those characters is left, whatever the version holds.
    expect(anchor("0.13.2<u>x</u>", "2026-10-09")).toBe("0132uxu---2026-10-09");
    expect(anchor('1.0.0"> <b>', "2026-10-09")).toBe("100-b---2026-10-09");
  });

  it("goes to the same CHANGELOG the trust page links to", () => {
    const href = changelogHref({ version: "0.13.1", date: "2026-10-08" });

    expect(href.startsWith(`${TRUST_TEXT.releases.changelog.href}#`)).toBe(true);
    expect(TRUST_TEXT.builder.dated.link.href).toBe(TRUST_TEXT.releases.changelog.href);
  });

  it("gives each release of the real CHANGELOG an address of its own", async () => {
    const text = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const releases = parseChangelog(text);

    const hrefs = releases.map((release) => changelogHref(release));

    expect(hrefs.length).toBeGreaterThan(1);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
