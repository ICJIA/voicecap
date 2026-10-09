import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { axeScript, keptAxeResults, type KeptAxeResults } from "../src/axe/results.js";
import { rawAxe, rawNode, rawRule, type RawAxeNode } from "./helpers/raw-axe.js";

const URL_HOME = "http://127.0.0.1:4747/";

/** The file keptAxeResults writes for `raw`, read back. */
function keptFile(raw: unknown): KeptAxeResults {
  return JSON.parse(keptAxeResults(raw, URL_HOME).json) as KeptAxeResults;
}

/** `count` elements a rule found, numbered from 0. */
function elements(count: number): RawAxeNode[] {
  return Array.from({ length: count }, (_, index) => rawNode(`.item-${index}`));
}

/** `value` with every object's keys in the opposite order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reversed(item)]),
  );
}

describe("what voicecap keeps of axe's results", () => {
  it("keeps at most 50 elements a rule, and counts the rest", () => {
    const file = keptFile(
      rawAxe({
        violations: [
          rawRule("color-contrast", { nodes: elements(120) }),
          rawRule("link-name", { nodes: elements(50) }),
        ],
        incomplete: [rawRule("aria-valid-attr-value", { nodes: elements(51) })],
      }),
    );
    const [contrast, links] = file.violations;
    // The first 50, in axe's order.
    expect(contrast?.nodes.map((node) => node.target)).toEqual(
      Array.from({ length: 50 }, (_, index) => [`.item-${index}`]),
    );
    expect(contrast?.moreNodes).toBe(70);
    expect(links?.nodes).toHaveLength(50);
    expect(links?.moreNodes).toBe(0);
    // What needs review is kept the same way.
    expect(file.incomplete[0]?.nodes).toHaveLength(50);
    expect(file.incomplete[0]?.moreNodes).toBe(1);
  });

  it("cuts an element's HTML to 300 characters", () => {
    const long = `<p class="intro">${"word ".repeat(200)}</p>`;
    const exactly = "x".repeat(300);
    // A character written with two UTF-16 units counts as one, and isn't cut in two.
    const smiling = `${"x".repeat(299)}\u{1F600}${"y".repeat(10)}`;
    const file = keptFile(
      rawAxe({
        violations: [
          rawRule("region", {
            nodes: [
              rawNode(".long", { html: long }),
              rawNode(".exactly", { html: exactly }),
              rawNode(".short", { html: "<p>Short</p>" }),
              rawNode(".smiling", { html: smiling }),
            ],
          }),
        ],
      }),
    );
    expect(file.violations[0]?.nodes.map((node) => node.html)).toEqual([
      long.slice(0, 300),
      exactly,
      "<p>Short</p>",
      `${"x".repeat(299)}\u{1F600}`,
    ]);
  });

  it("counts violations, needs review, passes, and rules that didn't apply, and violations by impact", () => {
    const raw = rawAxe({
      violations: [
        rawRule("image-alt", { impact: "critical" }),
        rawRule("color-contrast", { impact: "serious" }),
        rawRule("link-name", { impact: "serious" }),
        rawRule("region", { impact: "moderate" }),
        rawRule("tabindex", { impact: "minor" }),
        rawRule("given-none", { impact: null }),
        rawRule("left-out", { impact: undefined }),
      ],
      incomplete: [
        rawRule("aria-hidden-focus", { impact: "critical" }),
        rawRule("video-caption", { impact: "serious" }),
      ],
      passes: 31,
      inapplicable: 44,
    });
    const { json, summary } = keptAxeResults(raw, URL_HOME);
    expect(summary).toEqual({
      axeVersion: "4.13.0",
      counts: { violations: 7, incomplete: 2, passes: 31, inapplicable: 44 },
      // Violations only, and only those axe gave an impact.
      impacts: { critical: 1, serious: 2, moderate: 1, minor: 1 },
    });
    const file = JSON.parse(json) as KeptAxeResults;
    expect(file.counts).toEqual(summary.counts);
    // Each rule's impact as axe gives it, or null where it gives none.
    expect(file.violations.map((rule) => rule.impact)).toEqual([
      "critical",
      "serious",
      "serious",
      "moderate",
      "minor",
      null,
      null,
    ]);
  });

  it("writes the same bytes for the same results", () => {
    const raw = rawAxe({
      violations: [
        rawRule("button-name", {
          impact: "critical",
          tags: ["cat.name-role-value", "wcag2a", "wcag412"],
          help: "Buttons must have discernible text",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.13/button-name?application=axeAPI",
          nodes: [
            rawNode(".icon-button", {
              html: '<button class="icon-button"></button>',
              failureSummary:
                "Fix any of the following:\n  Element does not have inner text that is visible to screen readers",
            }),
          ],
        }),
      ],
      incomplete: [
        rawRule("color-contrast", {
          impact: null,
          tags: ["cat.color", "wcag2aa", "wcag143"],
          help: "Elements must meet minimum color contrast ratio thresholds",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI",
          nodes: [
            rawNode(".hero", { html: '<p class="hero">Welcome</p>', failureSummary: undefined }),
          ],
        }),
      ],
      passes: 2,
      inapplicable: 1,
    });
    const { json } = keptAxeResults(raw, URL_HOME);
    // Keys sorted at every level, two spaces an indent, and a final newline. Of axe's results,
    // only this: no rule's description, no element's checks, no time the check ran.
    expect(json).toBe(
      [
        "{",
        '  "axeVersion": "4.13.0",',
        '  "counts": {',
        '    "inapplicable": 1,',
        '    "incomplete": 1,',
        '    "passes": 2,',
        '    "violations": 1',
        "  },",
        '  "incomplete": [',
        "    {",
        '      "help": "Elements must meet minimum color contrast ratio thresholds",',
        '      "helpUrl": "https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI",',
        '      "id": "color-contrast",',
        '      "impact": null,',
        '      "moreNodes": 0,',
        '      "nodes": [',
        "        {",
        '          "failureSummary": "",',
        '          "html": "<p class=\\"hero\\">Welcome</p>",',
        '          "target": [',
        '            ".hero"',
        "          ]",
        "        }",
        "      ],",
        '      "tags": [',
        '        "cat.color",',
        '        "wcag2aa",',
        '        "wcag143"',
        "      ]",
        "    }",
        "  ],",
        '  "schemaVersion": 1,',
        '  "tags": [',
        '    "wcag2a",',
        '    "wcag2aa",',
        '    "wcag21a",',
        '    "wcag21aa",',
        '    "wcag22aa",',
        '    "best-practice"',
        "  ],",
        '  "url": "http://127.0.0.1:4747/",',
        '  "violations": [',
        "    {",
        '      "help": "Buttons must have discernible text",',
        '      "helpUrl": "https://dequeuniversity.com/rules/axe/4.13/button-name?application=axeAPI",',
        '      "id": "button-name",',
        '      "impact": "critical",',
        '      "moreNodes": 0,',
        '      "nodes": [',
        "        {",
        '          "failureSummary": "Fix any of the following:\\n  Element does not have inner text that is visible to screen readers",',
        '          "html": "<button class=\\"icon-button\\"></button>",',
        '          "target": [',
        '            ".icon-button"',
        "          ]",
        "        }",
        "      ],",
        '      "tags": [',
        '        "cat.name-role-value",',
        '        "wcag2a",',
        '        "wcag412"',
        "      ]",
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
    // The same results with their keys in another order give the same bytes.
    expect(keptAxeResults(reversed(raw), URL_HOME).json).toBe(json);
  });

  it("writes the selectors of an element in a shadow root as one, from its host in", () => {
    const file = keptFile(
      rawAxe({
        violations: [
          rawRule("button-name", {
            nodes: [
              rawNode(".menu", { target: [["site-menu", "#open"]] }),
              rawNode(".card", { target: [["outer-card", "inner-card", "button"]] }),
            ],
          }),
        ],
      }),
    );
    expect(file.violations[0]?.nodes.map((node) => node.target)).toEqual([
      ["site-menu >>> #open"],
      ["outer-card >>> inner-card >>> button"],
    ]);
  });

  it("refuses something that isn't axe's results", () => {
    expect(() => keptAxeResults({}, URL_HOME)).toThrow(/^axe's results couldn't be read/);
    // Each says what it couldn't read.
    expect(() => keptAxeResults({ ...rawAxe(), violations: "none" }, URL_HOME)).toThrow(
      /^axe's results couldn't be read \(violations: /,
    );
    const notAxe: unknown[] = [
      undefined,
      null,
      "results",
      [],
      { ...rawAxe(), testEngine: { name: "axe-core" } },
      { ...rawAxe(), passes: 3 },
      rawAxe({
        violations: [{ ...rawRule("image-alt"), nodes: [{ target: [".photo"] }] }] as never,
      }),
      rawAxe({ violations: [rawRule("image-alt", { impact: "blocker" })] }),
      rawAxe({
        incomplete: [rawRule("region", { nodes: [rawNode(".x", { target: [3] as never })] })],
      }),
      rawAxe({ violations: [{ ...rawRule("label"), help: undefined }] as never }),
    ];
    for (const raw of notAxe) {
      expect(() => keptAxeResults(raw, URL_HOME), JSON.stringify(raw)).toThrow(
        /^axe's results couldn't be read/,
      );
    }
  });
});

describe("axe-core's script", () => {
  it("finds axe-core's own script", async () => {
    const pins = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    // A dependency, pinned exactly: the script voicecap runs is the one it was released with.
    const version = pins.dependencies["axe-core"];
    expect(version).toBe("4.13.0");
    const script = await axeScript();
    expect(script.startsWith(`/*! axe v${version}\n`)).toBe(true);
    // Its license notice comes first, as the license asks of every copy.
    const notice = script.slice(0, script.indexOf("*/")).replace(/\n \*/g, "").replace(/\s+/g, " ");
    expect(notice).toContain("Copyright (c) 2015 - 2026 Deque Systems, Inc.");
    expect(notice).toContain("subject to the terms of the Mozilla Public License, v. 2.0.");
    expect(notice).toContain(
      "This entire copyright notice must appear in every copy of this file you distribute",
    );
    // Unchanged: the installed file, character for character.
    const installed = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
    expect(script).toBe(readFileSync(installed, "utf8"));
  });
});
