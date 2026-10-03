/**
 * How a repeat of a walkthrough sounds against the original, page by page: `compareWithOriginal`
 * pairs the walkthrough's fingerprints with the repeat's record, and `comparisonLines` says the
 * result as the terminal shows it. Every run here is built in memory (`shareRun`): no scripted
 * driver, nothing on disk. The same lines out of a real scripted run are in
 * test/run-walkthrough.test.ts.
 */
import { describe, expect, it } from "vitest";

import { PASS_NAMES, type EnvironmentRecord, type PassName, type RunJson } from "../src/model.js";
import {
  compareWithOriginal,
  comparisonLines,
  parseWalkthrough,
  walkthroughJson,
  walkthroughOf,
  type Walkthrough,
  type WalkthroughComparison,
} from "../src/share/walkthrough.js";
import { shareRun, type SharePageSpec, type ShareRunSpec } from "./helpers/share-data.js";

const SITE = "https://example.illinois.gov";
const ORIGINAL = "2026-09-26_1405";
const REPEAT = "2026-10-03_0900";

const READ = [
  "banner landmark, link, Skip to main content",
  "heading, level 1, Home",
  "content info landmark, © 2026 Example Agency",
];
const HEADINGS = ["heading, level 1, Home", "no next heading"];
const TAB = ["Skip to main content, link", "Home, link"];

/** What a page says in every pass, as the body lines of each pass's transcript. */
const SAID: Record<PassName, string[]> = { read: READ, headings: HEADINGS, tab: TAB };

/** Each pass said another way, so a pass that's changed has another fingerprint. */
const CHANGED: Record<PassName, string[]> = {
  read: [...READ, "link, Grants"],
  headings: ["heading, level 1, Welcome", "no next heading"],
  tab: ["Skip to main content, link", "Grants, link"],
};

/** A repeat that read `repeat`, compared with the walkthrough of an original that read `pages`. */
function compared(pages: SharePageSpec[], repeat: SharePageSpec[]): WalkthroughComparison {
  return compareWithOriginal(
    walkthroughOf(shareRun({ id: ORIGINAL, pages })),
    shareRun({ id: REPEAT, pages: repeat }),
  );
}

/** A run of a spec, with `change` made to its record afterwards (what a spec can't say). */
function made(spec: ShareRunSpec, change: (run: RunJson) => void = () => {}): RunJson {
  const run = shareRun(spec);
  change(run);
  return run;
}

/** What a run's environment says of a screen reader or a browser. */
const NVDA = (version: string): EnvironmentRecord["screenReader"] => ({
  name: "NVDA",
  version,
  build: null,
  language: "en",
});
const CHROME = (version: string): EnvironmentRecord["browser"] => ({ name: "Chrome", version });

const HOME: SharePageSpec = { path: "/", passes: { read: READ } };

/**
 * A run whose session recorded these versions of NVDA, the browser, and voicecap: null for a screen
 * reader or a browser the session didn't record.
 */
function running(
  nvda: string | null,
  chrome: string | null,
  voicecap: string,
): Partial<ShareRunSpec> {
  return {
    voicecapVersion: voicecap,
    sessions: [
      {
        environment: {
          screenReader: nvda === null ? null : NVDA(nvda),
          browser: chrome === null ? null : CHROME(chrome),
        },
      },
    ],
  };
}

/**
 * The versions a repeat names, for an original and a repeat that read the home page and whose
 * runs are `original` and `repeat`, both with the spec each says.
 */
function versionsOf(original: Partial<ShareRunSpec>, repeat: Partial<ShareRunSpec>): string[] {
  return compareWithOriginal(
    walkthroughOf(shareRun({ id: ORIGINAL, pages: [HOME], ...original })),
    shareRun({ id: REPEAT, pages: [HOME], ...repeat }),
  ).versions;
}

/** The NVDA settings a repeat names, for an original and a repeat that ran with these settings. */
function settingsOf(original: Record<string, unknown>, repeat: Record<string, unknown>): string[] {
  const walkthrough = walkthroughOf(
    made({ id: ORIGINAL, pages: [HOME] }, (run) => {
      run.settings.nvdaSettings = original;
    }),
  );
  const again = made({ id: REPEAT, pages: [HOME] }, (run) => {
    run.settings.nvdaSettings = repeat;
  });
  return compareWithOriginal(walkthrough, again).nvdaSettings;
}

describe("compareWithOriginal", () => {
  it("says a page sounds the same when every pass of it says what it said in the original", () => {
    const comparison = compared(
      [
        { path: "/", passes: SAID },
        { path: "/about", passes: { read: ["a"] } },
      ],
      [
        { path: "/", passes: SAID },
        { path: "/about", passes: { read: ["a"] } },
      ],
    );

    expect(comparison.original).toBe(ORIGINAL);
    expect(comparison.pages).toStrictEqual([
      { url: `${SITE}/`, result: "same" },
      { url: `${SITE}/about`, result: "same" },
    ]);
  });

  it.each<[changed: PassName[]]>([
    [["read"]],
    [["headings"]],
    [["tab"]],
    [["read", "tab"]],
    [["headings", "tab"]],
    [["read", "headings", "tab"]],
  ])("says a page sounds different, naming only the passes that differ: %j", (changed) => {
    const repeat = Object.fromEntries(
      PASS_NAMES.map((pass) => [pass, changed.includes(pass) ? CHANGED[pass] : SAID[pass]]),
    );

    const comparison = compared([{ path: "/", passes: SAID }], [{ path: "/", passes: repeat }]);

    // Only those that were changed, in the passes' order.
    expect(comparison.pages).toStrictEqual([
      { url: `${SITE}/`, result: "different", passes: changed },
    ]);
  });

  it("says a page that sounds different in one pass sounds the same in the others", () => {
    const comparison = compared(
      [
        { path: "/", passes: SAID },
        { path: "/about", passes: SAID },
      ],
      [
        { path: "/", passes: { ...SAID, headings: CHANGED.headings } },
        { path: "/about", passes: SAID },
      ],
    );

    expect(comparison.pages).toStrictEqual([
      { url: `${SITE}/`, result: "different", passes: ["headings"] },
      { url: `${SITE}/about`, result: "same" },
    ]);
  });

  it.each(["failed", "skipped", "pending"] as const)(
    "says a page wasn't read in the original when the original left it %s, and the repeat read it",
    (status) => {
      const comparison = compared(
        // A failed page may keep a pass it had begun: the original said nothing of it.
        [{ path: "/", status, passes: { read: ["partial"] } }],
        [{ path: "/", passes: SAID }],
      );

      expect(comparison.pages).toStrictEqual([{ url: `${SITE}/`, result: "not-read-originally" }]);
    },
  );

  it.each(["failed", "skipped", "pending"] as const)(
    "says a page couldn't be read now when the repeat left it %s",
    (status) => {
      const comparison = compared(
        [{ path: "/", passes: SAID }],
        [{ path: "/", status, passes: { read: ["partial"] } }],
      );

      expect(comparison.pages).toStrictEqual([{ url: `${SITE}/`, result: "not-read-now" }]);
    },
  );

  it("says a page couldn't be read now when the repeat has no record of it", () => {
    const comparison = compared(
      [
        { path: "/", passes: SAID },
        { path: "/about", passes: SAID },
      ],
      [{ path: "/", passes: SAID }],
    );

    expect(comparison.pages).toStrictEqual([
      { url: `${SITE}/`, result: "same" },
      { url: `${SITE}/about`, result: "not-read-now" },
    ]);
  });

  it("says a page couldn't be read now, and no more, when neither the original nor the repeat read it", () => {
    const comparison = compared(
      [{ path: "/", status: "failed" }],
      [{ path: "/", status: "skipped" }],
    );

    expect(comparison.pages).toStrictEqual([{ url: `${SITE}/`, result: "not-read-now" }]);
  });

  it("holds every page of the file, in the file's order, whatever order or form the repeat read them in", () => {
    const comparison = compared(
      [
        { path: "/", passes: SAID },
        { path: "/about", passes: SAID },
        { path: "/resources", passes: SAID },
      ],
      [
        // Another order, and /about/ for /about: the same page, by its address.
        { path: "/resources", passes: CHANGED },
        { path: "/", passes: SAID },
        { path: "/about/", passes: SAID },
      ],
    );

    expect(comparison.pages).toStrictEqual([
      { url: `${SITE}/`, result: "same" },
      { url: `${SITE}/about`, result: "same" },
      { url: `${SITE}/resources`, result: "different", passes: ["read", "headings", "tab"] },
    ]);
  });

  it("leaves out a page the repeat read that the file doesn't list", () => {
    const comparison = compared(
      [{ path: "/", passes: SAID }],
      [
        { path: "/", passes: SAID },
        { path: "/extra", passes: SAID },
      ],
    );

    expect(comparison.pages).toStrictEqual([{ url: `${SITE}/`, result: "same" }]);
  });

  it("compares a page the file lists twice once, by its first listing, as the repeat reads it once", () => {
    const walkthrough = walkthroughOf(
      shareRun({
        id: ORIGINAL,
        pages: [
          { path: "/", passes: SAID },
          { path: "/about", passes: SAID },
        ],
      }),
    );
    const [home, about] = walkthrough.pages;
    // The same page again: another form of its address, a fragment, and fingerprints of its own.
    walkthrough.pages.push(
      { ...about!, url: `${SITE}/about/`, original: { status: "failed", passes: {} } },
      {
        ...home!,
        url: `${SITE}/#top`,
        original: { status: "done", passes: { read: "0".repeat(64) } },
      },
    );

    const comparison = compareWithOriginal(
      walkthrough,
      shareRun({
        id: REPEAT,
        pages: [
          { path: "/", passes: SAID },
          { path: "/about", passes: SAID },
        ],
      }),
    );

    expect(comparison.pages).toStrictEqual([
      { url: `${SITE}/`, result: "same" },
      { url: `${SITE}/about`, result: "same" },
    ]);
  });

  it("counts a pass that only one side has as a difference, and one that neither has as none", () => {
    const comparison = compared(
      [
        { path: "/", passes: SAID },
        { path: "/about", passes: { read: READ } },
        { path: "/resources", passes: { read: READ } },
      ],
      [
        // The repeat didn't read the tab pass, and the original didn't read the headings pass.
        { path: "/", passes: { read: READ, headings: HEADINGS } },
        { path: "/about", passes: { read: READ, headings: HEADINGS } },
        { path: "/resources", passes: { read: READ } },
      ],
    );

    expect(comparison.pages).toStrictEqual([
      { url: `${SITE}/`, result: "different", passes: ["tab"] },
      { url: `${SITE}/about`, result: "different", passes: ["headings"] },
      { url: `${SITE}/resources`, result: "same" },
    ]);
  });

  describe("versions", () => {
    it("names NVDA, the browser, and voicecap, each as the repeat's with the original's after it", () => {
      const versions = versionsOf(
        running("2026.2", "154.0", "0.7.0"),
        running("2026.3", "155.0", "0.8.0"),
      );

      expect(versions).toStrictEqual([
        "NVDA 2026.3 (was 2026.2)",
        "Chrome 155.0 (was 154.0)",
        "voicecap 0.8.0 (was 0.7.0)",
      ]);
    });

    it.each<[name: string, repeat: Partial<ShareRunSpec>, expected: string[]]>([
      ["NVDA", running("2026.3", "154.0", "0.7.0"), ["NVDA 2026.3 (was 2026.2)"]],
      ["the browser", running("2026.2", "155.0", "0.7.0"), ["Chrome 155.0 (was 154.0)"]],
      ["voicecap", running("2026.2", "154.0", "0.8.0"), ["voicecap 0.8.0 (was 0.7.0)"]],
      ["nothing: they're all the same", running("2026.2", "154.0", "0.7.0"), []],
    ])("names only what differs: %s", (_name, repeat, expected) => {
      expect(versionsOf(running("2026.2", "154.0", "0.7.0"), repeat)).toStrictEqual(expected);
    });

    it.each<[name: string, was: string, now: string, expected: string[]]>([
      ["another version", "2026.2", "14.4", ["VoiceOver 14.4 (was NVDA 2026.2)"]],
      // The same number doesn't make it the same program.
      ["the same version", "14.4", "14.4", ["VoiceOver 14.4 (was NVDA 14.4)"]],
    ])(
      "names the original's screen reader too when it was another, at %s",
      (_name, was, now, expected) => {
        const voiceOver: EnvironmentRecord["screenReader"] = {
          name: "VoiceOver",
          version: now,
          build: null,
          language: "en",
        };

        expect(
          versionsOf(running(was, "154.0", "0.7.0"), {
            voicecapVersion: "0.7.0",
            sessions: [{ environment: { screenReader: voiceOver, browser: CHROME("154.0") } }],
          }),
        ).toStrictEqual(expected);
      },
    );

    it("names the original's browser too when it was another, at the same version", () => {
      const edge: EnvironmentRecord["browser"] = { name: "Microsoft Edge", version: "155.0" };

      expect(
        versionsOf(running("2026.2", "155.0", "0.7.0"), {
          voicecapVersion: "0.7.0",
          sessions: [{ environment: { screenReader: NVDA("2026.2"), browser: edge } }],
        }),
      ).toStrictEqual(["Microsoft Edge 155.0 (was Chrome 155.0)"]);
    });

    it.each<
      [
        name: string,
        original: Partial<ShareRunSpec>,
        repeat: Partial<ShareRunSpec>,
        expected: string[],
      ]
    >([
      [
        "the original recorded neither a screen reader nor a browser",
        running(null, null, "0.7.0"),
        running("2026.3", "155.0", "0.8.0"),
        ["voicecap 0.8.0 (was 0.7.0)"],
      ],
      [
        "the repeat recorded neither a screen reader nor a browser",
        running("2026.2", "154.0", "0.7.0"),
        running(null, null, "0.8.0"),
        ["voicecap 0.8.0 (was 0.7.0)"],
      ],
      [
        "the original recorded no browser",
        running("2026.2", null, "0.7.0"),
        running("2026.3", "155.0", "0.7.0"),
        ["NVDA 2026.3 (was 2026.2)"],
      ],
      [
        "neither recorded a screen reader or a browser, and voicecap is the same",
        running(null, null, "0.7.0"),
        running(null, null, "0.7.0"),
        [],
      ],
    ])("names a version only when both recorded it: %s", (_name, original, repeat, expected) => {
      expect(versionsOf(original, repeat)).toStrictEqual(expected);
    });

    it("names none when the original recorded no environment, or the repeat did", () => {
      const withoutEnvironment = (run: RunJson) => {
        run.sessions[0]!.environment = null;
      };
      const recorded = running("2026.3", "155.0", "0.8.0");
      const original = made({ id: ORIGINAL, pages: [HOME] }, withoutEnvironment);
      const walkthrough = walkthroughOf(original);

      expect(walkthrough.original).toMatchObject({
        voicecap: null,
        screenReader: null,
        browser: null,
      });
      expect(
        compareWithOriginal(walkthrough, shareRun({ id: REPEAT, pages: [HOME], ...recorded }))
          .versions,
      ).toStrictEqual([]);
      expect(
        compareWithOriginal(
          walkthroughOf(shareRun({ id: ORIGINAL, pages: [HOME] })),
          made({ id: REPEAT, pages: [HOME], ...recorded }, withoutEnvironment),
        ).versions,
      ).toStrictEqual([]);
    });

    it("takes the repeat's last session that recorded an environment", () => {
      const walkthrough = walkthroughOf(
        shareRun({
          id: ORIGINAL,
          voicecapVersion: "0.7.0",
          pages: [HOME],
          sessions: [{ environment: { screenReader: NVDA("2026.2"), browser: CHROME("154.0") } }],
        }),
      );
      const repeat = made(
        {
          id: REPEAT,
          voicecapVersion: "0.8.0",
          pages: [HOME],
          sessions: [
            { environment: { screenReader: NVDA("2026.1"), browser: CHROME("153.0") } },
            { environment: { screenReader: NVDA("2026.3"), browser: CHROME("155.0") } },
            {},
          ],
        },
        (run) => {
          // The last session never started its screen reader: it recorded nothing.
          run.sessions[2]!.environment = null;
        },
      );

      expect(compareWithOriginal(walkthrough, repeat).versions).toStrictEqual([
        "NVDA 2026.3 (was 2026.2)",
        "Chrome 155.0 (was 154.0)",
        "voicecap 0.8.0 (was 0.7.0)",
      ]);
    });

    it("takes the original's versions from the walkthrough, as it was written to a file and read back", () => {
      const original = shareRun({
        id: ORIGINAL,
        voicecapVersion: "0.7.0",
        pages: [HOME],
        sessions: [{ environment: { screenReader: NVDA("2026.2"), browser: CHROME("154.0") } }],
      });
      const fromFile = parseWalkthrough(walkthroughJson(walkthroughOf(original)), "w.json");
      const repeat = shareRun({
        id: REPEAT,
        voicecapVersion: "0.8.0",
        pages: [HOME],
        sessions: [{ environment: { screenReader: NVDA("2026.3"), browser: CHROME("155.0") } }],
      });

      expect(compareWithOriginal(fromFile, repeat)).toStrictEqual(
        compareWithOriginal(walkthroughOf(original), repeat),
      );
      expect(compareWithOriginal(fromFile, repeat).versions).toHaveLength(3);
    });
  });

  describe("NVDA settings", () => {
    it("names the settings whose values differ, by name, sorted", () => {
      expect(
        settingsOf(
          { "speech.rate": 50, "speech.pitch": 40, "keyboard.typed": true },
          { "speech.rate": 55, "speech.pitch": 45, "keyboard.typed": true },
        ),
      ).toStrictEqual(["speech.pitch", "speech.rate"]);
    });

    it("names a setting that only one side has", () => {
      expect(settingsOf({ "speech.rate": 50 }, {})).toStrictEqual(["speech.rate"]);
      expect(settingsOf({}, { "speech.rate": 50 })).toStrictEqual(["speech.rate"]);
      expect(settingsOf({ b: 1, c: 3 }, { a: 1, c: 3, d: 4 })).toStrictEqual(["a", "b", "d"]);
    });

    it("names none when the settings are the same, or both are empty", () => {
      expect(settingsOf({}, {})).toStrictEqual([]);
      expect(
        settingsOf({ speech: { rate: 50 }, list: [1, 2] }, { speech: { rate: 50 }, list: [1, 2] }),
      ).toStrictEqual([]);
    });

    it("compares a setting's value as canonical JSON: whatever order its keys were written in", () => {
      // The same value written another way is no difference...
      expect(
        settingsOf(
          { speech: { rate: 50, pitch: 40, inner: { a: 1, b: 2 } } },
          { speech: { inner: { b: 2, a: 1 }, pitch: 40, rate: 50 } },
        ),
      ).toStrictEqual([]);
      // ...and a different value, however deep, is one, named by the top-level key it's under.
      expect(
        settingsOf(
          { speech: { inner: { a: 1, b: 2 } }, other: 1 },
          { speech: { inner: { a: 1, b: 3 } }, other: 1 },
        ),
      ).toStrictEqual(["speech"]);
      // A list's order is part of its value.
      expect(settingsOf({ list: [1, 2] }, { list: [2, 1] })).toStrictEqual(["list"]);
    });

    it("tells a number from the same number in text, and null from nothing", () => {
      expect(settingsOf({ rate: 50 }, { rate: "50" })).toStrictEqual(["rate"]);
      expect(settingsOf({ rate: null }, {})).toStrictEqual(["rate"]);
      expect(settingsOf({ rate: false }, { rate: 0 })).toStrictEqual(["rate"]);
    });

    it("counts a setting whose value is undefined as one that isn't there, as a run's seal does", () => {
      expect(settingsOf({}, { speech: undefined })).toStrictEqual([]);
      expect(settingsOf({ speech: undefined, rate: 1 }, { rate: 1 })).toStrictEqual([]);
      expect(settingsOf({ speech: undefined }, { speech: 1 })).toStrictEqual(["speech"]);
    });

    it("keeps a setting named __proto__, which a file may hold, as any other", () => {
      const file = (settings: string) =>
        parseWalkthrough(
          walkthroughJson(walkthroughOf(shareRun({ id: ORIGINAL, pages: [HOME] }))).replace(
            '"nvdaSettings": {}',
            `"nvdaSettings": ${settings}`,
          ),
          "w.json",
        );
      const now = (settings: string) =>
        made({ id: REPEAT, pages: [HOME] }, (run) => {
          run.settings.nvdaSettings = JSON.parse(settings) as Record<string, unknown>;
        });
      const proto = '{"__proto__": {"rate": 50}}';

      // Own keys of parsed JSON, as a file gives them: neither side's `__proto__` is lost.
      expect(Object.keys(file(proto).original.nvdaSettings)).toStrictEqual(["__proto__"]);
      expect(compareWithOriginal(file(proto), now("{}")).nvdaSettings).toStrictEqual(["__proto__"]);
      expect(compareWithOriginal(file("{}"), now(proto)).nvdaSettings).toStrictEqual(["__proto__"]);
      expect(compareWithOriginal(file(proto), now(proto)).nvdaSettings).toStrictEqual([]);
      expect(
        compareWithOriginal(file(proto), now('{"__proto__": {"rate": 60}}')).nvdaSettings,
      ).toStrictEqual(["__proto__"]);
      // A side without it has none: it isn't the prototype every object has, which is `{}` too.
      expect(compareWithOriginal(file('{"__proto__": {}}'), now("{}")).nvdaSettings).toStrictEqual([
        "__proto__",
      ]);
      expect(compareWithOriginal(file("{}"), now('{"__proto__": {}}')).nvdaSettings).toStrictEqual([
        "__proto__",
      ]);
    });

    it("compares the original's settings with the repeat's own, not with any other", () => {
      const walkthrough = walkthroughOf(
        made({ id: ORIGINAL, pages: [HOME] }, (run) => {
          run.settings.nvdaSettings = { "speech.rate": 50 };
        }),
      );
      const repeat = made({ id: REPEAT, pages: [HOME] }, (run) => {
        run.settings.nvdaSettings = { "speech.rate": 50 };
      });

      expect(compareWithOriginal(walkthrough, repeat).nvdaSettings).toStrictEqual([]);
      // A run records the settings it ran with: this is what a change to the computer's would be.
      repeat.settings.nvdaSettings = { "speech.rate": 55 };
      expect(compareWithOriginal(walkthrough, repeat).nvdaSettings).toStrictEqual(["speech.rate"]);
    });
  });

  it("gives the same comparison for a walkthrough read back from its file as for the one it was written from", () => {
    const original = shareRun({
      id: ORIGINAL,
      pages: [
        { path: "/", passes: SAID },
        { path: "/about", passes: SAID },
        { path: "/resources", status: "failed" },
      ],
    });
    const repeat = shareRun({
      id: REPEAT,
      pages: [
        { path: "/", passes: CHANGED },
        { path: "/about", passes: SAID },
        { path: "/resources", passes: SAID },
      ],
    });
    const walkthrough = walkthroughOf(original);

    expect(
      compareWithOriginal(parseWalkthrough(walkthroughJson(walkthrough), "w.json"), repeat),
    ).toStrictEqual(compareWithOriginal(walkthrough, repeat));
  });

  it("doesn't change the walkthrough or the run it's given", () => {
    const walkthrough: Walkthrough = walkthroughOf(
      made({ id: ORIGINAL, pages: [{ path: "/", passes: SAID }] }, (run) => {
        run.settings.nvdaSettings = { speech: { rate: 50 } };
      }),
    );
    const repeat = made(
      { id: REPEAT, pages: [{ path: "/", passes: CHANGED }], voicecapVersion: "0.9.0" },
      (run) => {
        run.settings.nvdaSettings = { speech: { rate: 60 } };
      },
    );
    const before = structuredClone({ walkthrough, repeat });

    compareWithOriginal(walkthrough, repeat);

    expect({ walkthrough, repeat }).toStrictEqual(before);
  });
});

describe("comparisonLines", () => {
  const FIRST = `Compared with run ${ORIGINAL}, from its walkthrough file:`;

  it("says each result of each page, then how many sound the same, the versions, and the settings", () => {
    const comparison: WalkthroughComparison = {
      original: ORIGINAL,
      pages: [
        { url: `${SITE}/`, result: "same" },
        { url: `${SITE}/about`, result: "different", passes: ["headings", "tab"] },
        { url: `${SITE}/resources`, result: "not-read-originally" },
        { url: `${SITE}/contact`, result: "not-read-now" },
      ],
      versions: [
        "NVDA 2026.3 (was 2026.2)",
        "Chrome 155.0 (was 154.0)",
        "voicecap 0.8.0 (was 0.7.0)",
      ],
      nvdaSettings: ["speech.rate", "speech.pitch"],
    };

    expect(comparisonLines(comparison)).toStrictEqual([
      FIRST,
      `  ${SITE}/: sounds the same`,
      `  ${SITE}/about: sounds different (headings, tab)`,
      `  ${SITE}/resources: wasn't read in the original`,
      `  ${SITE}/contact: couldn't be read now`,
      "1 of 4 pages sound the same.",
      "Different from the original: NVDA 2026.3 (was 2026.2), Chrome 155.0 (was 154.0), voicecap 0.8.0 (was 0.7.0).",
      "NVDA's settings here differ from the original's in: speech.rate, speech.pitch.",
    ]);
  });

  it("says nothing of versions or settings when none differs", () => {
    const lines = comparisonLines({
      original: ORIGINAL,
      pages: [
        { url: `${SITE}/`, result: "same" },
        { url: `${SITE}/about`, result: "same" },
      ],
      versions: [],
      nvdaSettings: [],
    });

    expect(lines).toStrictEqual([
      FIRST,
      `  ${SITE}/: sounds the same`,
      `  ${SITE}/about: sounds the same`,
      "2 of 2 pages sound the same.",
    ]);
  });

  it("says a line for the versions that differ, or the settings that do, and not the other", () => {
    const pages: WalkthroughComparison["pages"] = [{ url: `${SITE}/`, result: "same" }];

    expect(
      comparisonLines({
        original: ORIGINAL,
        pages,
        versions: ["voicecap 0.8.0 (was 0.7.0)"],
        nvdaSettings: [],
      }).slice(3),
    ).toStrictEqual(["Different from the original: voicecap 0.8.0 (was 0.7.0)."]);
    expect(
      comparisonLines({ original: ORIGINAL, pages, versions: [], nvdaSettings: ["speech"] }).slice(
        3,
      ),
    ).toStrictEqual(["NVDA's settings here differ from the original's in: speech."]);
  });

  it("says 0 of the pages sound the same when none does", () => {
    expect(
      comparisonLines({
        original: ORIGINAL,
        pages: [
          { url: `${SITE}/`, result: "not-read-now" },
          { url: `${SITE}/about`, result: "different", passes: ["read"] },
        ],
        versions: [],
        nvdaSettings: [],
      }).at(-1),
    ).toBe("0 of 2 pages sound the same.");
  });

  it("counts every page of the file, so one page is '1 of 1 pages'", () => {
    expect(
      comparisonLines({
        original: ORIGINAL,
        pages: [{ url: `${SITE}/`, result: "same" }],
        versions: [],
        nvdaSettings: [],
      }),
    ).toStrictEqual([FIRST, `  ${SITE}/: sounds the same`, "1 of 1 pages sound the same."]);
  });

  it("says the same lines of a comparison made from two runs", () => {
    const original = made(
      {
        id: ORIGINAL,
        voicecapVersion: "0.7.0",
        sessions: [{ environment: { screenReader: NVDA("2026.2"), browser: CHROME("154.0") } }],
        pages: [
          { path: "/", passes: SAID },
          { path: "/about", passes: SAID },
          { path: "/resources", status: "failed" },
          { path: "/contact", passes: SAID },
        ],
      },
      (run) => {
        run.settings.nvdaSettings = { "speech.rate": 50, "speech.pitch": 40, same: { a: 1 } };
      },
    );
    const repeat = made(
      {
        id: REPEAT,
        voicecapVersion: "0.8.0",
        sessions: [{ environment: { screenReader: NVDA("2026.3"), browser: CHROME("155.0") } }],
        pages: [
          { path: "/", passes: SAID },
          { path: "/about", passes: { ...SAID, headings: CHANGED.headings, tab: CHANGED.tab } },
          { path: "/resources", passes: SAID },
          { path: "/contact", status: "failed" },
        ],
      },
      (run) => {
        run.settings.nvdaSettings = { "speech.rate": 55, "speech.pitch": 45, same: { a: 1 } };
      },
    );

    expect(comparisonLines(compareWithOriginal(walkthroughOf(original), repeat))).toStrictEqual([
      FIRST,
      `  ${SITE}/: sounds the same`,
      `  ${SITE}/about: sounds different (headings, tab)`,
      `  ${SITE}/resources: wasn't read in the original`,
      `  ${SITE}/contact: couldn't be read now`,
      "1 of 4 pages sound the same.",
      "Different from the original: NVDA 2026.3 (was 2026.2), Chrome 155.0 (was 154.0), voicecap 0.8.0 (was 0.7.0).",
      "NVDA's settings here differ from the original's in: speech.pitch, speech.rate.",
    ]);
  });

  describe("text that came from the file", () => {
    // A walkthrough file may come from anyone, and its versions and its NVDA settings' names aren't
    // checked for what's in them. A comparison holds them as a refusal shows the file's own words:
    // with every control character written out as an escape, so a file can't move the terminal's
    // cursor or clear the screen, and cut short.
    const ESCAPE = "\u{1b}[2J";

    it("shows a version with its control characters escaped", () => {
      const original = shareRun({
        id: ORIGINAL,
        pages: [HOME],
        sessions: [
          {
            environment: {
              screenReader: NVDA(`2026.${ESCAPE}`),
              browser: { name: `Chrome${ESCAPE}`, version: "154.0" },
            },
          },
        ],
        voicecapVersion: `0.7.${ESCAPE}`,
      });
      const repeat = shareRun({
        id: REPEAT,
        pages: [HOME],
        sessions: [{ environment: { screenReader: NVDA("2026.3"), browser: CHROME("155.0") } }],
        voicecapVersion: "0.8.0",
      });

      const lines = comparisonLines(compareWithOriginal(walkthroughOf(original), repeat));

      expect(lines.filter((line) => /\p{Cc}/u.test(line))).toStrictEqual([]);
      expect(lines).toContain(
        "Different from the original: NVDA 2026.3 (was 2026.\\u{1b}[2J), Chrome 155.0 (was Chrome\\u{1b}[2J 154.0), voicecap 0.8.0 (was 0.7.\\u{1b}[2J).",
      );
    });

    it("shows a setting's name with its control characters escaped", () => {
      const original = made({ id: ORIGINAL, pages: [HOME] }, (run) => {
        run.settings.nvdaSettings = { [`\u{1b}[31mred`]: 1, "\u{202e}rate": 1 };
      });
      const repeat = shareRun({ id: REPEAT, pages: [HOME] });

      const comparison = compareWithOriginal(walkthroughOf(original), repeat);
      const lines = comparisonLines(comparison);

      expect(comparison.nvdaSettings).toStrictEqual(["\\u{1b}[31mred", "\\u{202e}rate"]);
      expect(lines.at(-1)).toBe(
        "NVDA's settings here differ from the original's in: \\u{1b}[31mred, \\u{202e}rate.",
      );
      expect(lines.filter((line) => /\p{Cc}|\p{Cf}/u.test(line))).toStrictEqual([]);
    });

    it("cuts a very long version short", () => {
      const original = shareRun({
        id: ORIGINAL,
        pages: [HOME],
        sessions: [{ environment: { screenReader: NVDA("9".repeat(10_000)) } }],
      });
      const repeat = shareRun({
        id: REPEAT,
        pages: [HOME],
        sessions: [{ environment: { screenReader: NVDA("2026.3") } }],
      });

      const lines = comparisonLines(compareWithOriginal(walkthroughOf(original), repeat));

      // The version is cut, and the line is still closed: "NVDA 2026.3 (was 99999…)."
      const line = lines.find((text) => text.startsWith("Different from the original")) ?? "";
      expect(line.length).toBeLessThan(200);
      expect(line).toMatch(/^Different from the original: NVDA 2026\.3 \(was 9+…\)\.$/);
    });
  });
});
