import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { FocusedElement } from "../src/drivers/types.js";
import { contentSteps, evaluateFlags, type PassData } from "../src/flags/evaluate.js";
import type { DriverCommand, StepRecord, StopReason } from "../src/model.js";

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
