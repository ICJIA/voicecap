import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { FocusedElement } from "../src/drivers/types.js";
import {
  BUILT_IN_RULES,
  contentSteps,
  evaluateFlags,
  flagItemLines,
  flagQuotes,
  type PagePasses,
  type PassData,
} from "../src/flags/evaluate.js";
import type { DriverCommand, FlagResult, StepRecord, StopReason } from "../src/model.js";

const rules = DEFAULT_CONFIG.flags;

function steps(
  command: DriverCommand,
  speech: string[],
  extra: Partial<StepRecord>[] = [],
): StepRecord[] {
  return speech.map((spoken, i) => ({
    n: i + 1,
    command,
    spoken,
    durationMs: 1,
    offsetMs: i + 1,
    ...extra[i],
  }));
}

function read(lines: string[], stopReason: StopReason = "end-reached"): PassData {
  const last = lines.at(-1) ?? "";
  const body = stopReason === "end-reached" ? [...lines, last, last] : lines;
  return {
    stopReason,
    steps: [
      ...steps("toBottom", [last]),
      ...steps("toTop", [body[0] ?? ""]),
      ...steps("nextLine", body.slice(1)),
    ],
  };
}

function headings(list: string[]): PassData {
  return {
    stopReason: "no-next-heading",
    steps: steps("nextHeading", [...list, "no next heading"]),
  };
}

function el(name: string, options: Partial<FocusedElement> = {}): FocusedElement {
  return { tag: "a", role: "link", name, inMain: false, href: "/x", ...options };
}

function tab(stops: { spoken: string; focused: FocusedElement }[]): PassData {
  const all = [
    ...stops.map((stop) => ({
      spoken: stop.spoken,
      extra: { inDocument: true, focused: stop.focused },
    })),
    { spoken: "Address and search bar, edit", extra: { inDocument: false, focused: null } },
  ];
  return {
    stopReason: "left-document",
    steps: steps(
      "nextFocusable",
      all.map((s) => s.spoken),
      all.map((s) => s.extra),
    ),
  };
}

const rulesOf = (flags: ReturnType<typeof evaluateFlags>) =>
  flags.map((flag) => `${flag.rule}:${flag.pass}`);

describe("the built-in rules", () => {
  it("lists every built-in rule once, and each has its settings", () => {
    // A rule's id in camelCase is the name of its settings in the config: generic-link-text's are
    // flags.genericLinkText. The config's flags hold the built-in rules' settings, and the custom
    // rules, which are no built-in rule.
    const camelCase = (id: string): string =>
      id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

    expect(new Set(BUILT_IN_RULES).size).toBe(BUILT_IN_RULES.length);
    expect(BUILT_IN_RULES.map(camelCase).sort()).toEqual(
      Object.keys(DEFAULT_CONFIG.flags)
        .filter((key) => key !== "custom")
        .sort(),
    );
  });
});

describe("generic link text", () => {
  it("flags repeated generic links in browse and focus phrasing", () => {
    const flags = evaluateFlags(
      {
        read: read([
          "News item one",
          "link, Read more",
          "News item two",
          "visited link, Read more",
          "Footer",
        ]),
        tab: tab([
          { spoken: "Read more, link", focused: el("Read more") },
          { spoken: "Click here, link", focused: el("Click here") },
        ]),
      },
      rules,
    );
    const generic = flags.filter((flag) => flag.rule === "generic-link-text");
    expect(generic.map((flag) => flag.pass).sort()).toEqual(["read", "tab"]);
    expect(generic.find((flag) => flag.pass === "read")?.message).toContain('"read more" ×2');
  });

  it("does not flag a single generic link or descriptive links", () => {
    const flags = evaluateFlags(
      { read: read(["link, Read more", "link, Annual report 2026", "link, Grant opportunities"]) },
      rules,
    );
    expect(rulesOf(flags)).not.toContain("generic-link-text:read");
  });

  it("counts links with no name", () => {
    const flags = evaluateFlags(
      {
        tab: tab([
          { spoken: "link", focused: el("") },
          { spoken: "main landmark, link", focused: el("", { inMain: true }) },
        ]),
      },
      rules,
    );
    expect(flags.find((flag) => flag.rule === "generic-link-text")?.message).toContain("(no name)");
  });
});

describe("unlabeled items", () => {
  it("flags a bare role in focus speech, even after landmark context", () => {
    const flags = evaluateFlags(
      {
        tab: tab([
          { spoken: "button", focused: el("", { tag: "button", role: "button" }) },
          {
            spoken: "main landmark, edit, blank",
            focused: el("", { tag: "input", role: "textbox", inMain: true }),
          },
          { spoken: "Search, button", focused: el("Search", { tag: "button", role: "button" }) },
        ]),
      },
      rules,
    );
    const flag = flags.find((f) => f.rule === "unlabeled");
    expect(flag?.count).toBe(2);
    expect(flag?.message).toContain('"button" ×1');
    expect(flag?.message).toContain('"edit" ×1');
  });

  it("flags browse lines that are only a role, and anything NVDA calls unlabeled", () => {
    const flags = evaluateFlags(
      {
        read: read(["Intro", "button", "graphic", "unlabeled graphic", "button, Submit", "Footer"]),
      },
      rules,
    );
    expect(flags.find((f) => f.rule === "unlabeled")?.count).toBe(3);
  });

  it("leaves a form field's role alone on a browse line to the tab pass: NVDA reads its label as separate text", () => {
    // NVDA 2026.2 reading the demo's /ask-a-question/: a labeled textarea, its label a line of its own.
    const flags = evaluateFlags(
      {
        read: read([
          "Your question (required)",
          "edit, required, multi line",
          "out of edit, Ask anything about voicecap, or about this tour.",
          "Your country",
          "combo box, collapsed",
          "Subscribe",
          "check box, not checked",
          "Paper copy",
          "radio button, not checked",
          "Footer",
        ]),
      },
      rules,
    );
    expect(rulesOf(flags)).not.toContain("unlabeled:read");
  });

  it("flags a form field's role alone on a browse line when the config doesn't leave it to the tab pass", () => {
    const flags = evaluateFlags(
      { read: read(["Intro", "edit", "Footer"]) },
      { ...rules, unlabeled: { ...rules.unlabeled, tabOnlyRoles: [] } },
    );
    expect(flags.find((f) => f.rule === "unlabeled")?.message).toBe(
      'Unlabeled or poorly labeled items in the read pass: "edit" ×1.',
    );
  });

  it("does not flag labeled controls", () => {
    const flags = evaluateFlags(
      { tab: tab([{ spoken: "Search this site, edit, blank", focused: el("Search this site") }]) },
      rules,
    );
    expect(rulesOf(flags)).not.toContain("unlabeled:tab");
  });
});

describe("what a flag found", () => {
  it("lists the generic link texts, most often first, as the message lists them", () => {
    // "read more" is spoken first, but "click here" twice, so the order isn't the order spoken.
    const flags = evaluateFlags(
      {
        tab: tab([
          { spoken: "Read more, link", focused: el("Read more") },
          { spoken: "Click here, link", focused: el("Click here") },
          { spoken: "Annual report, link", focused: el("Annual report") },
          { spoken: "Click here, link", focused: el("Click here") },
        ]),
      },
      rules,
    );
    const flag = flags.find((f) => f.rule === "generic-link-text");

    expect(flag?.found).toEqual([
      { text: "click here", count: 2 },
      { text: "read more", count: 1 },
    ]);
    expect(flag?.count).toBe(3);
    expect(flag?.message).toBe(
      'Generic link text announced 3 times in the tab pass: "click here" ×2, "read more" ×1.',
    );
  });

  it("puts texts that were found as often in alphabetical order", () => {
    const flags = evaluateFlags(
      {
        read: read(["link, Read more", "link, Learn more", "link, Click here"]),
      },
      rules,
    );

    expect(flags.find((f) => f.rule === "generic-link-text")?.found).toEqual([
      { text: "click here", count: 1 },
      { text: "learn more", count: 1 },
      { text: "read more", count: 1 },
    ]);
  });

  it("lists a link that has no name as '(no name)'", () => {
    const flags = evaluateFlags(
      {
        tab: tab([
          { spoken: "link", focused: el("") },
          { spoken: "main landmark, link", focused: el("", { inMain: true }) },
        ]),
      },
      rules,
    );

    expect(flags.find((f) => f.rule === "generic-link-text")?.found).toEqual([
      { text: "(no name)", count: 2 },
    ]);
  });

  it("lists the unlabeled items, most often first, as the message lists them", () => {
    const flags = evaluateFlags(
      {
        tab: tab([
          { spoken: "button", focused: el("", { tag: "button", role: "button" }) },
          { spoken: "edit, blank", focused: el("", { tag: "input", role: "textbox" }) },
          { spoken: "edit, blank", focused: el("", { tag: "input", role: "textbox" }) },
        ]),
      },
      rules,
    );
    const flag = flags.find((f) => f.rule === "unlabeled");

    expect(flag?.found).toEqual([
      { text: "edit", count: 2 },
      { text: "button", count: 1 },
    ]);
    expect(flag?.count).toBe(3);
    expect(flag?.message).toBe(
      'Unlabeled or poorly labeled items in the tab pass: "edit" ×2, "button" ×1.',
    );
  });

  it("lists each pass's findings in that pass's own flag", () => {
    const flags = evaluateFlags(
      {
        read: read(["Intro", "button", "Footer"]),
        tab: tab([{ spoken: "edit, blank", focused: el("", { tag: "input", role: "textbox" }) }]),
      },
      rules,
    );
    const unlabeled = flags.filter((f) => f.rule === "unlabeled");

    expect(unlabeled.map((flag) => [flag.pass, flag.found])).toEqual([
      ["read", [{ text: "button", count: 1 }]],
      ["tab", [{ text: "edit", count: 1 }]],
    ]);
  });

  it("gives no list to the rules that don't find items", () => {
    const flags = evaluateFlags(
      {
        read: read(["a", "b"], "step-cap"),
        headings: headings(["heading, level 2, Resources"]),
        tab: tab([]),
      },
      rules,
    );

    expect(rulesOf(flags)).toEqual([
      "read-not-finished:read",
      "headings:headings",
      "tab-no-stops:tab",
    ]);
    for (const flag of flags) expect(flag).not.toHaveProperty("found");
  });
});

describe("structure rules", () => {
  it("flags a read pass that stopped at the cap or the safety net", () => {
    expect(rulesOf(evaluateFlags({ read: read(["a", "b"], "step-cap") }, rules))).toContain(
      "read-not-finished:read",
    );
    expect(rulesOf(evaluateFlags({ read: read(["a", "b"], "repeat-limit") }, rules))).toContain(
      "read-not-finished:read",
    );
    expect(rulesOf(evaluateFlags({ read: read(["a", "b"]) }, rules))).not.toContain(
      "read-not-finished:read",
    );
  });

  it("flags no headings, and a first heading that isn't level 1", () => {
    expect(evaluateFlags({ headings: headings([]) }, rules)[0]?.message).toBe(
      "The page has no headings.",
    );
    expect(
      evaluateFlags({ headings: headings(["heading, level 2, Resources"]) }, rules)[0]?.message,
    ).toBe("The first heading is level 2, not level 1.");
    expect(
      evaluateFlags(
        { headings: headings(["heading, level 1, Home", "heading, level 2, News"]) },
        rules,
      ),
    ).toEqual([]);
  });

  it("flags a tab pass with no focus stops", () => {
    expect(rulesOf(evaluateFlags({ tab: tab([]) }, rules))).toContain("tab-no-stops:tab");
  });

  it("flags a long run of stops before main content when there's no skip link", () => {
    const nav = Array.from({ length: 11 }, (_, i) => ({
      spoken: `Nav ${i}, link`,
      focused: el(`Nav ${i}`),
    }));
    const main = {
      spoken: "Read the report, link",
      focused: el("Read the report", { inMain: true }),
    };
    const flagged = evaluateFlags({ tab: tab([...nav, main]) }, rules);
    expect(flagged.find((f) => f.rule === "tab-before-main")?.message).toMatch(
      /11 focus stops before main content/,
    );

    const skip = {
      spoken: "Skip to main content, link",
      focused: el("Skip to main content", { href: "#main" }),
    };
    expect(rulesOf(evaluateFlags({ tab: tab([skip, ...nav, main]) }, rules))).not.toContain(
      "tab-before-main:tab",
    );
    expect(rulesOf(evaluateFlags({ tab: tab([...nav.slice(0, 3), main]) }, rules))).not.toContain(
      "tab-before-main:tab",
    );
  });

  it("judges skip links from the focused element, not from speech", () => {
    const nav = Array.from({ length: 11 }, (_, i) => ({
      spoken: `Nav ${i}, link`,
      focused: el(`Nav ${i}`),
    }));
    const fakeSkip = { spoken: "Skip to main content, link", focused: el("Home", { href: "/" }) };
    expect(rulesOf(evaluateFlags({ tab: tab([fakeSkip, ...nav]) }, rules))).toContain(
      "tab-before-main:tab",
    );
  });
});

describe("repeated phrases", () => {
  it("flags the same speech many times in a row, but not the read pass's end-of-page repeat", () => {
    const trap = tab(
      Array.from({ length: 5 }, () => ({ spoken: "Close, button", focused: el("Close") })),
    );
    expect(
      evaluateFlags({ tab: trap }, rules).find((f) => f.rule === "repeated-phrase")?.count,
    ).toBe(5);

    const normal = read(["Intro", "Body", "© 2026 Agency"]);
    expect(rulesOf(evaluateFlags({ read: normal }, rules))).not.toContain("repeated-phrase:read");
  });

  it("ignores the end repeat even when the arrival carried container context", () => {
    const data: PassData = {
      stopReason: "end-reached",
      steps: [
        ...steps("toBottom", ["content info landmark, © 2026"]),
        ...steps("toTop", ["Intro"]),
        ...steps("nextLine", [
          "out of list, content info landmark, © 2026",
          "© 2026",
          "© 2026",
          "© 2026",
        ]),
      ],
    };
    expect(contentSteps("read", data).map((s) => s.spoken)).toEqual([
      "Intro",
      "out of list, content info landmark, © 2026",
    ]);
    expect(evaluateFlags({ read: data }, rules)).toEqual([]);
  });
});

// A read pass that stopped for the repeat limit presses Ctrl+End once more, as a step of its own (see
// readPass), and ends "end-reached" when the page's end moved as it was read: r3.illinois.gov's
// "Scroll to top" button, shown at the very end once the page is scrolled down.
describe("a read pass that looked at the end of the page again", () => {
  const scrollToTop = Array.from({ length: 10 }, () => "button, Scroll to top");

  /**
   * A read: what Ctrl+End said first, the lines read, and what a second Ctrl+End said (null: the pass
   * pressed none), with the pass's stop reason.
   */
  function looked(
    first: string,
    lines: string[],
    second: string | null,
    stopReason: StopReason,
  ): PassData {
    return {
      stopReason,
      steps: [
        ...steps("toBottom", [first]),
        ...steps("toTop", [lines[0] ?? ""]),
        ...steps("nextLine", lines.slice(1)),
        ...(second === null ? [] : steps("toBottom", [second])),
      ],
    };
  }

  const FOOTER = "site footer, content info landmark, link, Contact";
  const moved = looked(
    FOOTER,
    ["banner landmark, link, Home", "heading, level 1, Meetings", "link, Contact", ...scrollToTop],
    "button, Scroll to top",
    "end-reached",
  );

  it("raises no read-not-finished, and no repeated-phrase for the run of the page's last line", () => {
    expect(evaluateFlags({ read: moved }, rules)).toEqual([]);
  });

  it("leaves out both Ctrl+End steps and the repeats, and keeps the last line once", () => {
    expect(contentSteps("read", moved).map((step) => step.spoken)).toEqual([
      "banner landmark, link, Home",
      "heading, level 1, Meetings",
      "link, Contact",
      "button, Scroll to top",
    ]);
  });

  it("raises neither flag for the run of the last line at the first end, where no look is made", () => {
    const first = looked(
      "link, Contact",
      ["link, Home", "link, Contact", "link, Contact", "link, Contact"],
      null,
      "end-reached",
    );

    expect(evaluateFlags({ read: first }, rules)).toEqual([]);
  });

  it("still raises a repeat elsewhere on the page, at the first end or the moved one", () => {
    const skips = Array.from({ length: 5 }, () => "link, Skip");
    const lines = ["banner landmark, link, Home", ...skips, "link, Contact"];
    const atFirstEnd = looked(
      "link, Contact",
      [...lines, "link, Contact", "link, Contact"],
      null,
      "end-reached",
    );
    const atMovedEnd = looked(
      FOOTER,
      [...lines, ...scrollToTop],
      "button, Scroll to top",
      "end-reached",
    );

    for (const read of [atFirstEnd, atMovedEnd]) {
      const flags = evaluateFlags({ read }, rules);
      expect(rulesOf(flags)).toContain("repeated-phrase:read");
      expect(flags.find((flag) => flag.rule === "repeated-phrase")?.count).toBe(5);
      expect(rulesOf(flags)).not.toContain("read-not-finished:read");
    }
  });

  it("raises both flags for a read that ended at the repeat limit, whatever the look said", () => {
    const stuck = looked(
      "© 2026 Agency",
      ["heading, level 1, Meetings", ...Array.from({ length: 10 }, () => "link, Read more")],
      "© 2026 Agency",
      "repeat-limit",
    );
    const passes = { read: stuck };
    const flags = evaluateFlags(passes, rules);

    expect(rulesOf(flags)).toContain("read-not-finished:read");
    const repeated = flags.find((flag) => flag.rule === "repeated-phrase")!;
    expect(repeated.count).toBe(10);
    expect(repeated.message).toBe(
      '"link, Read more" repeated 10 times in a row in the read pass (possible focus trap or duplicated content).',
    );
    // The line the pass stopped on is the last one read, never what the second Ctrl+End said.
    const notFinished = flags.find((flag) => flag.rule === "read-not-finished")!;
    expect(flagQuotes(passes, rules, notFinished)).toEqual(["link, Read more"]);
    expect(flagQuotes(passes, rules, repeated)).toEqual(["link, Read more"]);
  });
});

describe("custom and disabled rules", () => {
  it("applies custom phrase rules and respects enabled: false", () => {
    const custom = {
      ...rules,
      unlabeled: { ...rules.unlabeled, enabled: false },
      custom: [
        {
          id: "pdf-links",
          description: "Links to PDFs",
          passes: ["read" as const],
          pattern: "\\bpdf\\b",
          minCount: 1,
        },
      ],
    };
    const flags = evaluateFlags(
      { read: read(["link, Annual report (PDF)", "button", "End"]) },
      custom,
    );
    expect(rulesOf(flags)).toEqual(["pdf-links:read"]);
  });
});

describe("the lines that raised a flag", () => {
  /** The flag `rule` raised on `passes` with the default rules, and the lines it quotes. */
  function quotesOf(passes: PagePasses, rule: string, flagRules = rules): string[] {
    const flag = evaluateFlags(passes, flagRules).find((each) => each.rule === rule);
    if (flag === undefined) throw new Error(`No ${rule} flag`);
    return flagQuotes(passes, flagRules, flag);
  }

  it("quotes the generic links a flag found, each line once and at most three", () => {
    const passes = {
      tab: tab([
        { spoken: "Read more, link", focused: el("Read more") },
        { spoken: "Annual report, link", focused: el("Annual report") },
        { spoken: "Read more, link", focused: el("Read more") },
        { spoken: "Click here, link", focused: el("Click here") },
        { spoken: "main landmark, link", focused: el("", { inMain: true }) },
        { spoken: "Learn more, link", focused: el("Learn more") },
      ]),
    };

    expect(quotesOf(passes, "generic-link-text")).toEqual([
      "Read more, link",
      "Click here, link",
      "main landmark, link",
    ]);
  });

  it("quotes links with no name, which NVDA announces only as a link", () => {
    const passes = {
      read: read(["Intro", "link", "out of list, link", "Footer"]),
      tab: tab([
        { spoken: "link", focused: el("") },
        { spoken: "main landmark, link", focused: el("", { inMain: true }) },
      ]),
    };
    const flags = evaluateFlags(passes, rules).filter((flag) => flag.rule === "generic-link-text");

    expect(flags.map((flag) => [flag.pass, flag.found])).toEqual([
      ["read", [{ text: "(no name)", count: 2 }]],
      ["tab", [{ text: "(no name)", count: 2 }]],
    ]);
    expect(flags.map((flag) => flagQuotes(passes, rules, flag))).toEqual([
      ["link", "out of list, link"],
      ["link", "main landmark, link"],
    ]);
  });

  it("quotes the unlabeled items a flag found, in focus and browse speech alike", () => {
    const tabPasses = {
      tab: tab([
        { spoken: "button", focused: el("", { tag: "button", role: "button" }) },
        { spoken: "Search, button", focused: el("Search", { tag: "button", role: "button" }) },
        {
          spoken: "main landmark. edit, blank",
          focused: el("", { tag: "input", role: "textbox", inMain: true }),
        },
      ]),
    };
    expect(quotesOf(tabPasses, "unlabeled")).toEqual(["button", "main landmark. edit, blank"]);

    const readPasses = {
      read: read(["Intro", "button", "button, Submit", "unlabeled graphic", "edit", "Footer"]),
    };
    // A labeled button, and a form field whose label NVDA reads as separate text, aren't quoted.
    expect(quotesOf(readPasses, "unlabeled")).toEqual(["button", "unlabeled graphic"]);
  });

  it("quotes the first heading when it isn't level 1, and nothing when there are none", () => {
    const passes = {
      headings: headings(["heading, level 2, Resources", "heading, level 3, More"]),
    };
    expect(quotesOf(passes, "headings")).toEqual(["heading, level 2, Resources"]);
    expect(quotesOf({ headings: headings([]) }, "headings")).toEqual([]);
  });

  it("quotes the first stops before the main content", () => {
    const nav = Array.from({ length: 11 }, (_, i) => ({
      spoken: `Nav ${i}, link`,
      focused: el(`Nav ${i}`),
    }));
    const main = {
      spoken: "Read the report, link",
      focused: el("Read the report", { inMain: true }),
    };
    expect(quotesOf({ tab: tab([...nav, main]) }, "tab-before-main")).toEqual([
      "Nav 0, link",
      "Nav 1, link",
      "Nav 2, link",
    ]);
  });

  it("quotes the repeated line once, and the last line of a read that didn't finish", () => {
    const trap = tab(
      Array.from({ length: 5 }, () => ({ spoken: "Close, button", focused: el("Close") })),
    );
    expect(quotesOf({ tab: trap }, "repeated-phrase")).toEqual(["Close, button"]);
    expect(quotesOf({ read: read(["Intro", "Body"], "step-cap") }, "read-not-finished")).toEqual([
      "Body",
    ]);
  });

  it("quotes nothing when Tab reaches nothing", () => {
    expect(quotesOf({ tab: tab([]) }, "tab-no-stops")).toEqual([]);
  });

  it("quotes the lines a custom rule's pattern matched", () => {
    const custom = {
      ...rules,
      custom: [
        {
          id: "pdf-links",
          description: "Links to PDFs",
          passes: ["read" as const],
          pattern: "\\bpdf\\b",
          minCount: 1,
        },
      ],
    };
    const passes = { read: read(["link, Annual report (PDF)", "button", "link, Budget (PDF)"]) };
    expect(quotesOf(passes, "pdf-links", custom)).toEqual([
      "link, Annual report (PDF)",
      "link, Budget (PDF)",
    ]);
  });

  it("quotes nothing for a pass it isn't given, or a rule it doesn't know", () => {
    const flag: FlagResult = {
      rule: "headings",
      pass: "headings",
      message: "The page has no headings.",
    };
    expect(flagQuotes({}, rules, flag)).toEqual([]);
    const unknown: FlagResult = { rule: "retired-rule", pass: "read", message: "Something" };
    expect(flagQuotes({ read: read(["Something"]) }, rules, unknown)).toEqual([]);
  });
});

describe("each line a rule found an item on", () => {
  // What NVDA said of i2i's logo on its home page (v3--i2i.netlify.app), from the transcripts of
  // 6 October 2026: in the header and at its link's Tab stop, then again in the main content.
  const HOME_READ_HEADER =
    "banner landmark, same page, link, current page, Unlabeled graphic, i 2i Logo. To get missing image descriptions, open the context menu.";
  const HOME_READ_MAIN = "main landmark, Unlabeled graphic, i 2i logo";
  const HOME_TAB =
    "banner landmark, i 2i Logo. To get missing image descriptions, open the context menu., Unlabeled graphic, INSTITUTE 2 INNOVATE, same page, link, current page";

  it("gives each line of i2i's home page the unlabeled rule matched, in pass then step order", () => {
    const passes = {
      read: read([HOME_READ_HEADER, HOME_READ_MAIN]),
      tab: tab([{ spoken: HOME_TAB, focused: el("i 2i Logo INSTITUTE 2 INNOVATE") }]),
    };

    // The read pass's Ctrl+End and its end-of-page repeats aren't lines of the page.
    expect(flagItemLines(passes, rules)).toEqual([
      { rule: "unlabeled", pass: "read", item: "unlabeled graphic", spoken: HOME_READ_HEADER },
      { rule: "unlabeled", pass: "read", item: "unlabeled graphic", spoken: HOME_READ_MAIN },
      { rule: "unlabeled", pass: "tab", item: "unlabeled graphic", spoken: HOME_TAB },
    ]);
  });

  it("gives a link with no name as '(no name)', one line at a time, with its speech on one line", () => {
    const passes = { tab: tab([{ spoken: "  link ", focused: el("") }]) };

    // One line is enough: the lines are what the rule found, whether or not it raised a flag.
    expect(flagItemLines(passes, rules)).toEqual([
      { rule: "generic-link-text", pass: "tab", item: "(no name)", spoken: "link" },
    ]);
  });

  it("finds nothing for a rule that's off, and looks only in each rule's own passes", () => {
    const passes = {
      read: read([HOME_READ_HEADER, "link, Read more"]),
      tab: tab([{ spoken: "Read more, link", focused: el("Read more") }]),
    };
    const off = { ...rules, unlabeled: { ...rules.unlabeled, enabled: false } };
    const tabOnly = {
      ...rules,
      genericLinkText: { ...rules.genericLinkText, passes: ["tab" as const] },
    };

    expect(flagItemLines(passes, off)).toEqual([
      { rule: "generic-link-text", pass: "read", item: "read more", spoken: "link, Read more" },
      { rule: "generic-link-text", pass: "tab", item: "read more", spoken: "Read more, link" },
    ]);
    expect(flagItemLines(passes, tabOnly)).toEqual([
      { rule: "unlabeled", pass: "read", item: "unlabeled graphic", spoken: HOME_READ_HEADER },
      { rule: "generic-link-text", pass: "tab", item: "read more", spoken: "Read more, link" },
    ]);
  });
});
