/**
 * The website's Technical details page (src/site/technical.ts), drawn from the facts it's given: how
 * voicecap works, for auditors and developers. Its passes, flag rules, and defaults are voicecap's
 * own code's, the version and its tests are the facts', the shares a site keeps are the build's, and
 * the toolchain's licenses are held to the packages voicecap installs. Every command, file, and rule
 * it names exists. And the website's rules for a page: one file, with one style block and one script
 * under its own policy, and no style attribute.
 *
 * What the page does in a browser is in test/site-page-browser.test.ts.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { BUILT_IN_RULES } from "../src/flags/evaluate.js";
import { PASS_NAMES } from "../src/model.js";
import { count } from "../src/share/format.js";
import { SITE_SCRIPT } from "../src/site/client.js";
import { recordFactsOf, type VoicecapFacts } from "../src/site/facts.js";
import { siteBar, siteFooter } from "../src/site/frame.js";
import { inlineHashes } from "../src/site/headers.js";
import { netlifyToml } from "../src/site/netlify.js";
import type { SiteContent } from "../src/site/render.js";
import { SITE_CSS } from "../src/site/style.js";
import { renderTechnical, type TechnicalInput } from "../src/site/technical.js";
import { TECHNICAL_TEXT } from "../src/site/technical-text.js";
import { packageRoot } from "../src/util/version.js";
import { decode, rowsOf, tableOf, textOf } from "./helpers/share-html.js";
import { RECORDS, RESULTS_CONTENT } from "./helpers/trust-facts.js";

const GITHUB = "https://github.com/ICJIA/voicecap";
const NPM = "https://www.npmjs.com/package/";
const NOT_RECORDED = "not recorded in this build of voicecap";

/**
 * voicecap 9.8.7, released on 3 February 2031, whose release recorded 4,321 tests passed on Windows
 * (6 skipped, in 87 files) and CI's matrix of two systems and one Node version: facts no real
 * release has, so each number the page gives is plainly the facts'.
 */
const FACTS: VoicecapFacts = {
  version: "9.8.7",
  released: "2031-02-03",
  releases: [
    { version: "9.8.7", date: "2031-02-03", headline: "A release from the future", items: [] },
  ],
  release: {
    tests: { passed: 4321, skipped: 6, files: 87, system: "Windows" },
    commits: { count: 1234, first: "2030-01-02" },
    ci: { systems: ["Ubuntu", "Windows"], node: ["23"] },
  },
};

/** The page the tests mostly read: those facts, the tests' records, and a site that keeps 4. */
const INPUT: TechnicalInput = {
  voicecap: FACTS,
  records: RECORDS,
  content: RESULTS_CONTENT,
  keptPerSite: 4,
};

/** A website with no report yet, not even the demo's. */
const NO_REPORT: SiteContent = { demo: null, sites: [] };

const pageWith = (input: Partial<TechnicalInput> = {}): string =>
  renderTechnical({ ...INPUT, ...input });

/** How a policy names the hash of `text`: 'sha256-' and its SHA-256 as base64, in single quotes. */
function hashOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** The page's markup, with what its style and script elements hold left out. */
function markupOf(html: string): string {
  return html
    .replace(/(<style>)[\s\S]*?(<\/style>)/g, "$1$2")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, "$1$2");
}

/** The page's main part. */
function mainOf(html: string): string {
  return /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
}

/** The text of each element of a kind in some markup, in order, as a reader gets it. */
function textsOf(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map(
    ([, inner = ""]) => textOf(inner, ""),
  );
}

/** Each link in some markup: where it goes, as a reader gets it, and its words. */
function linksOf(html: string): { href: string; words: string }[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, tag = "", inner = ""]) => ({
    href: decode(/\shref="([^"]*)"/.exec(tag)?.[1] ?? ""),
    words: textOf(inner, ""),
  }));
}

/** The page's headings, in order: each one's level, its id (or ""), and its words. */
function headingsOf(html: string): { level: number; id: string; words: string }[] {
  return [...html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/g)].map(
    ([, level = "", tag = "", inner = ""]) => ({
      level: Number(level),
      id: /\sid="([^"]*)"/.exec(tag)?.[1] ?? "",
      words: textOf(inner, ""),
    }),
  );
}

/** "On this page": the navigation of the page's parts. */
function onThisPage(html: string): string {
  return /<nav class="card toc"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
}

/** The part whose heading has this id: from its section's start to its end. */
function partOf(html: string, id: string): string {
  const sections = mainOf(html).split(/(?=<section class="part)/);
  const found = sections.find((section) => section.includes(`<h2 id="${id}"`));
  if (found === undefined) throw new Error(`The page has no part headed #${id}.`);
  return found;
}

/** The cells of a table's body, a row each, as text. */
function bodyOf(table: string): string[][] {
  return rowsOf(table)
    .slice(1)
    .map((row) => row.split(" | "));
}

/** The source of voicecap's command line, where each command and option is declared. */
const CLI = readFileSync(path.join(packageRoot(), "src", "cli", "main.ts"), "utf8");

/** A regular expression's text for `words`, matched as they are. */
const literally = (words: string): string => words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What isn't so of a command line the page names, `voicecap <command> [--option ...]`, against the
 * command line's source: each word is a command it declares (`.command("<word>"`), and each option
 * is one it declares (`.option("--<option>`, `.requiredOption(…`, or `new Option(…`). A placeholder
 * (`<file>`) or an ellipsis is no word of it.
 */
function unknownIn(command: string): string[] {
  const [first, ...words] = command.split(/\s+/);
  if (first !== "voicecap") return [`${command}: doesn't start with voicecap`];
  return words.flatMap((word) => {
    if (word === "…" || word.startsWith("<")) return [];
    if (word.startsWith("--")) {
      const declared = new RegExp(
        `(?:\\.option|\\.requiredOption|new Option)\\(\\s*"${literally(word)}[\\s"]`,
      );
      return declared.test(CLI) ? [] : [`${command}: no option ${word}`];
    }
    return CLI.includes(`.command("${word}"`) ? [] : [`${command}: no command ${word}`];
  });
}

describe("renderTechnical", () => {
  const html = pageWith();

  it("is one file, under its own policy: one style block, one script last, no style attribute, nothing from outside", () => {
    expect(html.match(/<style\b/g)).toHaveLength(1);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).toMatch(/<\/script>\n<\/body>\n<\/html>\n$/);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    for (const outside of ["src=", "srcset", "<link", "<iframe", "@import", "url(", "@font-face"]) {
      expect(html, outside).not.toContain(outside);
    }
    expect(inlineHashes(html)).toEqual({
      styles: [hashOf(`\n${SITE_CSS}`)],
      scripts: [hashOf(SITE_SCRIPT)],
    });
  });

  it("has its own title, the bar the website's other pages have, with the views on the website's own page, and the website's footer", () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">\n<head>\n/);
    expect(textsOf(html, "title")).toEqual(["Technical details · Screen reader test results"]);
    const bar = /<header class="bar">[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    expect(linksOf(bar)).toEqual([
      { href: "index.html#demo", words: "The demo" },
      { href: "index.html#sites", words: "The sites" },
      { href: "index.html#by-date", words: "Every report, by date" },
      { href: "trust.html", words: "Can I trust this?" },
    ]);
    // None of its links is this page: the bar doesn't link to it yet.
    expect(bar).not.toContain("aria-current");
    expect(html).toContain(`\n${siteBar(RESULTS_CONTENT, "technical")}\n`);
    expect(html).toContain(siteFooter());
  });

  it("opens with its kicker, its heading, its lead, and the version it's from, then 'On this page' and the parts", () => {
    const main = mainOf(html);

    expect(textsOf(main, "p").slice(0, 3)).toEqual([
      "Technical details",
      "The technical reference, for auditors and developers: how a run works, what it records, how anyone can check the records, and how this website is built. Every claim here can be checked against voicecap's code. For the short version, see Can I trust this?",
      "From voicecap 9.8.7, released 3 February 2031.",
    ]);
    expect(textsOf(html, "h1")).toEqual(["How voicecap works"]);
    // The lead's last words are a link to the trust page, and the day is a time that holds it.
    expect(main).toContain('see <a href="trust.html">Can I trust this?</a></p>');
    expect(main).toContain('<time datetime="2031-02-03">3 February 2031</time>');
    const places = [
      '<p class="kicker">Technical details</p>',
      "<h1>",
      '<p class="lead">',
      '<p class="version-line">',
      '<nav class="card toc"',
      '<section class="part"',
    ].map((part) => main.indexOf(part));
    expect(places.every((place) => place >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });

  it("puts its headings in order, and links each part from 'On this page'", () => {
    const headings = headingsOf(html);

    // One heading of the first level, and none skips a level on the way down.
    expect(headings.filter(({ level }) => level === 1)).toHaveLength(1);
    headings.forEach(({ level, words }, index) => {
      expect(level - (headings[index - 1]?.level ?? 0), words).toBeLessThanOrEqual(1);
    });
    // Every link of "On this page" goes to a part's heading, each part's in turn, in its words.
    const parts = headings.filter(({ level }) => level === 2);
    expect(parts).toHaveLength(12);
    expect(parts.every(({ id }) => id !== "")).toBe(true);
    const links = linksOf(onThisPage(html));
    expect(links.map(({ href }) => href)).toEqual(parts.map(({ id }) => `#${id}`));
    expect(links.map(({ words }) => words)).toEqual(parts.map(({ words }) => words));
    // It's a navigation named for a screen reader, with its words shown for the eye.
    expect(onThisPage(html)).toMatch(/^<nav class="card toc" aria-label="On this page">/);
    // No two elements share an id.
    const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map(([, id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says the version, its date, the tests, and CI's matrix from the facts", () => {
    const text = textOf(markupOf(html));

    for (const fact of ["9.8.7", "3 February 2031", "4,321", "87", "Ubuntu", "23"]) {
      expect(text, fact).toContain(fact);
    }
    const tested = textOf(partOf(html, "verify-for-yourself"));
    expect(tested).toContain(
      "Before voicecap 9.8.7 was released, 4,321 tests passed on Windows, with 6 skipped, in 87 files.",
    );
    expect(tested).toContain(
      "On every change, CI runs the same tests on Ubuntu and Windows, with Node 23.",
    );
    expect(text).not.toContain(NOT_RECORDED);
  });

  it("says a missing release fact isn't recorded", () => {
    const page = pageWith({ voicecap: { ...FACTS, released: null, release: null } });

    const tested = textOf(partOf(page, "verify-for-yourself"));
    expect(tested).toContain(
      `How this version was tested, and where CI runs its tests, are ${NOT_RECORDED}.`,
    );
    for (const fact of ["4,321", "87", "Ubuntu", "Node 23"])
      expect(tested, fact).not.toContain(fact);
    // The stamp says the version, and that its day isn't recorded.
    expect(textsOf(mainOf(page), "p")[2]).toBe(
      `From voicecap 9.8.7, whose release date is ${NOT_RECORDED}.`,
    );
    expect(page).not.toContain("<time");
  });

  it("takes the passes, the rules, the defaults, and the shares kept from the code", () => {
    // The passes: a row each, in their order, with the key a person presses for each.
    const passes = bodyOf(tableOf(html, "passes"));
    expect(passes.map(([pass]) => pass)).toEqual([...PASS_NAMES]);
    expect(passes.map(([, key]) => key)).toEqual(["Down Arrow", "H", "Tab"]);
    expect(headingsOf(html).find(({ id }) => id === "the-passes")?.words).toBe(
      "NVDA's three passes",
    );

    // The rules: a row each, in their order, and how many there are.
    const rules = bodyOf(tableOf(html, "rules"));
    expect(rules.map(([rule]) => rule)).toEqual([...BUILT_IN_RULES]);
    expect(BUILT_IN_RULES).toHaveLength(7);
    expect(headingsOf(html).find(({ id }) => id === "the-rules")?.words).toBe(
      `The ${BUILT_IN_RULES.length} built-in rules`,
    );
    // Their thresholds are the defaults'.
    const { genericLinkText, tabBeforeMain, repeatedPhrase } = DEFAULT_CONFIG.flags;
    const said = Object.fromEntries(rules.map(([rule = "", words = ""]) => [rule, words]));
    expect(said["generic-link-text"]).toContain(`at least ${genericLinkText.minCount} times`);
    expect(said["tab-before-main"]).toContain(`${tabBeforeMain.maxStops} or more Tab stops`);
    expect(said["repeated-phrase"]).toContain(`${repeatedPhrase.minRun} or more times in a row`);

    // The defaults: each setting with voicecap's own value.
    const { stepCaps, timeouts } = DEFAULT_CONFIG;
    expect(bodyOf(tableOf(html, "defaults")).map(([setting, value]) => [setting, value])).toEqual([
      ...PASS_NAMES.map((pass) => [`stepCaps.${pass}`, count(stepCaps[pass])]),
      ["repeatLimit", count(DEFAULT_CONFIG.repeatLimit)],
      ["timeouts.stepMs", `${timeouts.stepMs / 1000} seconds`],
      ["timeouts.pageMs", `${timeouts.pageMs / 60_000} minutes`],
      ["pageAttempts", count(DEFAULT_CONFIG.pageAttempts)],
      ["restartEvery", count(DEFAULT_CONFIG.restartEvery)],
      ["maxConsecutiveFailures", count(DEFAULT_CONFIG.maxConsecutiveFailures)],
    ]);

    // The shares a site keeps are the input's, in the run's last step and in what's published.
    const text = textOf(markupOf(html));
    expect(text.match(/newest 4 shares/g)).toHaveLength(2);
    expect(textOf(markupOf(pageWith({ keptPerSite: 3 })))).toContain("newest 3 shares");
  });

  it("draws the run as an ordered list of its steps, whose arrows are the style's", () => {
    const flow = /<ol class="flow" role="list">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";

    const steps = flow.split("<li>").slice(1);
    expect(steps).toHaveLength(10);
    expect(steps.map((step) => textsOf(step, "p")[0])).toEqual([
      "The page list",
      "Quick checks",
      "The real tools start",
      "Each page, three ways",
      "Safeguards on every key",
      "Flags",
      "The person's review",
      "A sealed record",
      "Sharing",
      "This website",
    ]);
    expect(textOf(flow)).toContain(
      "NVDA reads the page line by line, heading by heading, and control by control, and every word is saved.",
    );
    // No arrow is in the markup: a screen reader hears the list.
    expect(markupOf(html)).not.toMatch(/[→↓]/);
  });

  it("draws whole for a website with no report", () => {
    const page = pageWith({
      records: recordFactsOf(NO_REPORT),
      content: NO_REPORT,
      voicecap: { ...FACTS, release: null },
    });

    // Every part is there, each linked from "On this page".
    expect(headingsOf(page).filter(({ level }) => level === 2)).toHaveLength(12);
    expect(linksOf(onThisPage(page))).toHaveLength(12);
    const now = textOf(partOf(page, "this-website"));
    expect(now).toContain("No site's report has been shared yet.");
    expect(now).toContain(
      "this website publishes only those that still match the fingerprints recorded when they were shared: 0 today.",
    );
    // The bar's one view is the sites', and nothing is empty.
    const bar = /<header class="bar">[\s\S]*?<\/header>/.exec(page)?.[0] ?? "";
    expect(linksOf(bar).map(({ href }) => href)).toEqual(["index.html#sites", "trust.html"]);
    expect(page).not.toMatch(/<(ul|ol|p|li|td|h2|h3)\b[^>]*>\s*<\/\1>/);
  });

  it("says what this website shows now, from the records", () => {
    const now = textOf(partOf(html, "this-website"));

    // RECORDS: 3 reports of 2 sites, 11 files published, and 2 left out.
    expect(now).toContain("It shows 3 reports of 2 sites.");
    expect(now).toContain(
      "this website publishes only those that still match the fingerprints recorded when they were shared: 11 today, and 2 left out.",
    );
  });

  it("names Guidepup in the toolchain table and nowhere else", () => {
    const table = tableOf(html, "toolchain");

    expect(table.match(/guidepup/gi)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(html.replace(table, "").match(/guidepup/gi) ?? []).toEqual([]);
  });

  it("gives each npm tool the license of the package voicecap installs", () => {
    const rows = TECHNICAL_TEXT.toolchain.filter(({ npm }) => npm !== undefined);
    const shown = bodyOf(tableOf(html, "toolchain"));

    expect(rows.length).toBeGreaterThan(10);
    for (const { npm = "", license, tool } of rows) {
      const installed = JSON.parse(
        readFileSync(path.join(packageRoot(), "node_modules", npm, "package.json"), "utf8"),
      ) as { license?: unknown };
      expect(license, npm).toBe(installed.license);
      expect(shown.find(([name]) => name === tool)?.[2], npm).toBe(license);
    }
    // Every package voicecap installs to run has its row, and voicecap's own license is its own.
    const own = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
      license: string;
      dependencies: Record<string, string>;
    };
    expect(
      Object.keys(own.dependencies).filter((name) => !rows.some((row) => row.npm === name)),
    ).toEqual([]);
    expect(TECHNICAL_TEXT.toolchain.find(({ tool }) => tool === "voicecap")?.license).toBe(
      own.license,
    );
  });

  it("names only commands, files, and rules that exist", () => {
    // Each command of the table is one voicecap's command line declares, with its options.
    expect(TECHNICAL_TEXT.commands.flatMap(({ name }) => unknownIn(name))).toEqual([]);
    expect(bodyOf(tableOf(html, "commands")).map(([name]) => name)).toEqual(
      TECHNICAL_TEXT.commands.map(({ name }) => name),
    );
    // So is every command the page sets in the fixed-width font, and every file it names is there.
    const codes = textsOf(markupOf(html), "code");
    const commands = codes.filter((code) => code.startsWith("voicecap "));
    expect(commands.length).toBeGreaterThan(10);
    expect(commands.flatMap(unknownIn)).toEqual([]);
    const files = [
      ...TECHNICAL_TEXT.code.map(({ path: file }) => file),
      ...codes.filter((code) => code.startsWith("src/")),
    ];
    expect(files.filter((file) => !existsSync(path.join(packageRoot(), file)))).toEqual([]);
    // The build's command is the one netlify.toml is written with.
    expect(codes).toContain(/command = "([^"]+)"/.exec(netlifyToml("9.8.7"))?.[1]);
    // Each rule is a built-in one, and no other.
    expect(new Set(bodyOf(tableOf(html, "rules")).map(([rule]) => rule))).toEqual(
      new Set(BUILT_IN_RULES),
    );
  });

  it("links the code at the version's tag", () => {
    const code = linksOf(partOf(html, "verify-for-yourself")).filter(({ href }) =>
      href.includes("/tree/"),
    );

    expect(code.map(({ href }) => href)).toEqual(
      TECHNICAL_TEXT.code.map(({ path: file }) => `${GITHUB}/tree/v9.8.7/${file}`),
    );
    expect(code.map(({ words }) => words)).toEqual(TECHNICAL_TEXT.code.map(({ label }) => label));
    for (const { href } of code) expect(href.startsWith(`${GITHUB}/tree/v9.8.7/`)).toBe(true);
  });

  it("links only to the website's pages, GitHub, and npm", () => {
    const parts = headingsOf(html).filter(({ level }) => level === 2);
    const allowed = new Set([
      "#main",
      "index.html#demo",
      "index.html#sites",
      "index.html#by-date",
      "trust.html",
      "whats-new.html",
      GITHUB,
      `${GITHUB}/blob/main/README.md`,
      ...parts.map(({ id }) => `#${id}`),
      ...TECHNICAL_TEXT.code.map(({ path: file }) => `${GITHUB}/tree/v9.8.7/${file}`),
      ...TECHNICAL_TEXT.toolchain.flatMap(({ npm, source }) =>
        npm !== undefined ? [`${NPM}${npm}`] : source !== undefined ? [source] : [],
      ),
    ]);

    const hrefs = linksOf(html).map(({ href }) => href);

    expect(new Set(hrefs)).toEqual(allowed);
    // Each is a part of this page, a page of the website, or on GitHub or npm.
    for (const href of hrefs) {
      expect(href, href).toMatch(
        /^(?:#[a-z-]+|(?:index|trust|whats-new)\.html(?:#[a-z-]+)?|https:\/\/(?:github\.com|www\.npmjs\.com)\/\S+)$/,
      );
    }
  });

  it("keeps a wide table in a scroll box that a keyboard can reach and that's named", () => {
    const tables = [...html.matchAll(/(<div class="scroll"[^>]*>)\n<table class="([a-z]+)">/g)];
    const ids = new Set(headingsOf(html).map(({ id }) => id));

    expect(tables.map(([, , name]) => name)).toEqual([
      "commands",
      "passes",
      "defaults",
      "rules",
      "toolchain",
    ]);
    expect(html.match(/<table\b/g)).toHaveLength(tables.length);
    for (const [, box = "", name = ""] of tables) {
      const named =
        /^<div class="scroll" tabindex="0" role="region" aria-labelledby="([a-z-]+)">$/.exec(box);
      expect(named, name).not.toBeNull();
      expect(ids.has(named?.[1] ?? ""), name).toBe(true);
    }
    // Each column's header says it's one, and each row's first cell names its row.
    for (const [, , name = ""] of tables) {
      const table = tableOf(html, name);
      expect(table.match(/<th\b(?! scope="(?:col|row)")/g) ?? [], name).toEqual([]);
      expect(table, name).toMatch(/^<table class="[a-z]+">\n<thead><tr><th scope="col">/);
      expect(
        (table.match(/<tbody>[\s\S]*<\/tbody>/)?.[0] ?? "").match(/<tr><th scope="row">/g)?.length,
        name,
      ).toBe(rowsOf(table).length - 1);
    }
  });

  it("keeps the wording rules", () => {
    const text = textOf(markupOf(html));
    const toolchain = bodyOf(tableOf(html, "toolchain"));

    expect(text).not.toMatch(/listened/i);
    // "Automated" is said of axe, in its row of the toolchain, and nowhere else.
    expect(text.match(/automat/gi)).toHaveLength(1);
    expect(toolchain.find(([tool]) => tool === "axe-core")?.join(" ")).toMatch(/automated/i);
    // No IP address, and no local address.
    expect(text).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    expect(text).not.toMatch(/localhost/i);
    // Every code span came out as code: no backtick is left in the words.
    expect(text).not.toContain("`");
  });

  it("draws every fact as text", () => {
    const hostile = "<script>alert(1)</script> & <b>";
    const page = pageWith({
      voicecap: {
        ...FACTS,
        version: `9.8.7${hostile}`,
        release: {
          tests: { passed: 1, skipped: 0, files: 1, system: hostile },
          commits: { count: 1, first: "2030-01-02" },
          ci: { systems: [hostile], node: [hostile] },
        },
      },
    });

    expect(page.match(/<script\b/g)).toHaveLength(1);
    const markup = markupOf(page);
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;");
    expect(markup).not.toMatch(/<b>|<script>alert/);
  });

  it("is the same page for the same input, and changes none of it", () => {
    const before = structuredClone(INPUT);

    expect(pageWith()).toBe(html);
    expect(INPUT).toEqual(before);
  });
});
