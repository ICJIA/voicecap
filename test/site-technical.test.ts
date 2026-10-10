/**
 * The website's Technical details page (src/site/technical.ts), drawn from the facts it's given: how
 * voicecap works, for auditors and developers. Its passes, flag rules, and defaults are voicecap's
 * own code's, the version and its tests are the facts', the shares a site keeps are the build's, and
 * the toolchain's licenses are held to the packages voicecap installs, and the encoder's version to
 * the one package.json pins. What it says of NVDA's voice, the voice page, and the Windows build the
 * recording needs is held to the code's own words. Every command, file, and rule it names exists.
 * And the website's rules for a page: one file, with one style block and one script under its own
 * policy, and no style attribute.
 *
 * What the page does in a browser is in test/site-page-browser.test.ts.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadLibopus } from "libopus-wasm";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { RECORDER_SCRIPT } from "../src/drivers/guidepup/voice-recorder.js";
import { BUILT_IN_RULES } from "../src/flags/evaluate.js";
import { AXE_FILE, PASS_NAMES, SCREENSHOT_FILE, VOICE_FILE } from "../src/model.js";
import { NVDA_LOG_FOLDER } from "../src/run/events.js";
import { count, names } from "../src/share/format.js";
import { VOICE_TEXT } from "../src/share/text.js";
import { VOICE_SCRIPT } from "../src/share/voice-page.js";
import { SITE_SCRIPT } from "../src/site/client.js";
import { recordFactsOf, type VoicecapFacts } from "../src/site/facts.js";
import { backLink, siteBar, siteFooter } from "../src/site/frame.js";
import { contentSecurityPolicy, inlineHashes } from "../src/site/headers.js";
import { netlifyToml } from "../src/site/netlify.js";
import type { SiteContent } from "../src/site/render.js";
import { SITE_CSS } from "../src/site/style.js";
import { renderTechnical, type TechnicalInput } from "../src/site/technical.js";
import { TECHNICAL_TEXT } from "../src/site/technical-text.js";
import { SITE_TEXT } from "../src/site/text.js";
import { packageRoot } from "../src/util/version.js";
import { decode, rowsOf, tableOf, textOf } from "./helpers/share-html.js";
import { RECORDS } from "./helpers/trust-facts.js";

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

  it("has its own title, and the two bars of its page, whose link to it is the page the reader is on", () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">\n<head>\n/);
    expect(textsOf(html, "title")).toEqual(["Technical details · Screen reader test results"]);
    const bar = /<header class="bar">[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    expect(linksOf(bar)).toEqual([
      { href: "index.html", words: "ICJIA Screen Reader Tests" },
      { href: "trust.html", words: "Can I trust this?" },
      { href: "whats-new.html", words: "What's New" },
      { href: "technical-details.html", words: "Technical details" },
    ]);
    expect(bar.match(/aria-current="page"/g)).toHaveLength(1);
    expect(bar).toContain('<a href="technical-details.html" aria-current="page">');
    expect(html).toContain(`\n${siteBar("technical")}\n`);
    // The bottom bar says the version of the facts, and that this page is the current one.
    const footer = siteFooter("technical", FACTS.version);
    expect(html).toContain(`\n${footer}\n`);
    expect(footer).toContain('<span class="sr">voicecap version 9.8.7</span>');
    expect(footer).toContain('<a href="technical-details.html" aria-current="page">');
  });

  it("opens its main part with the way back to the test results", () => {
    expect(mainOf(html).startsWith(`\n${backLink()}\n<div class="hero">`)).toBe(true);
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
      "A sealed record",
      "The person's review",
      "Sharing",
      "This website",
    ]);
    expect(textOf(flow)).toContain(
      "NVDA reads the page line by line, heading by heading, and control by control, and every word is saved.",
    );
    // The end of the run asks its question, whose answer the seal covers, then seals the record and
    // writes the report: the person's review, and the replay of the shareable page's transcripts,
    // come after it.
    const [sealed = "", review = ""] = steps.slice(6, 8).map((step) => textOf(step));
    expect(sealed).toContain("asks whether the person heard NVDA");
    expect(sealed.indexOf("heard NVDA")).toBeLessThan(sealed.indexOf("is sealed"));
    expect(sealed).toContain("the shareable page, and its Word copy are written");
    expect(review).toContain("voicecap review");
    expect(review).toContain("voicecap review --replay");
    expect(review).not.toContain("heard NVDA");
    // Sharing makes what a share holds: the page and its Word copy, the report for AI tools as
    // Markdown and as JSON, and each run's walkthrough file (src/share/share.ts).
    expect(textOf(steps[8] ?? "")).toContain(
      "voicecap share makes a dated copy of the shareable page and its Word copy, the report as Markdown and as JSON for AI tools, and each run's walkthrough file, recorded in a sealed, chained shares.json",
    );
    // A switch to another window inside a frame is noticed only if it lasts to the step's end.
    expect(textOf(steps[4] ?? "")).toContain(
      "While focus is inside a frame, a switch to another window is noticed only if it lasts until the step ends.",
    );
    // No arrow is in the markup: a screen reader hears the list.
    expect(markupOf(html)).not.toMatch(/[→↓]/);
  });

  it("draws whole for a website with no report", () => {
    const page = pageWith({
      records: recordFactsOf(NO_REPORT),
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
    // The bars are the same as ever, and nothing is empty.
    const bar = /<header class="bar">[\s\S]*?<\/header>/.exec(page)?.[0] ?? "";
    expect(linksOf(bar).map(({ href }) => href)).toEqual([
      "index.html",
      "trust.html",
      "whats-new.html",
      "technical-details.html",
    ]);
    expect(page).not.toMatch(/<(ul|ol|p|li|td|h2|h3)\b[^>]*>\s*<\/\1>/);
  });

  it("says what this website shows now, from the records", () => {
    const now = textOf(partOf(html, "this-website"));

    // RECORDS: 3 reports of 2 sites, 15 files published, and 2 left out.
    expect(now).toContain("It shows 3 reports of 2 sites.");
    expect(now).toContain(
      "this website publishes only those that still match the fingerprints recorded when they were shared: 15 today, and 2 left out.",
    );
  });

  it("names Guidepup in the toolchain table and nowhere else", () => {
    const table = tableOf(html, "toolchain");

    expect(table.match(/guidepup/gi)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(html.replace(table, "").match(/guidepup/gi) ?? []).toEqual([]);
  });

  it("gives each npm tool the license of the package voicecap installs", () => {
    // voicecap's own package isn't one it installs: its row is held to its own package.json.
    const own = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
      name: string;
      license: string;
      dependencies: Record<string, string>;
    };
    const rows = TECHNICAL_TEXT.toolchain.filter(
      ({ npm }) => npm !== undefined && npm !== own.name,
    );
    const shown = bodyOf(tableOf(html, "toolchain"));

    expect(rows.length).toBeGreaterThan(10);
    // The one row that says more than its package's license: libopus-wasm holds libopus, a C library
    // of Xiph.Org's under a BSD license of its own, which the package's notice gives as it ships it.
    const NOTES: Record<string, string> = { "libopus-wasm": " (libopus: BSD, Xiph.Org)" };
    for (const { npm = "", license, tool } of rows) {
      const installed = JSON.parse(
        readFileSync(path.join(packageRoot(), "node_modules", npm, "package.json"), "utf8"),
      ) as { license?: unknown };
      expect(license, npm).toBe(`${String(installed.license)}${NOTES[npm] ?? ""}`);
      expect(shown.find(([name]) => name === tool)?.[2], npm).toBe(license);
    }
    const notice = readFileSync(
      path.join(packageRoot(), "node_modules", "libopus-wasm", "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    expect(notice).toMatch(/Xiph\.Org/);
    expect(notice).toMatch(/BSD/);
    // Every package voicecap installs to run has its row, and voicecap's own license is its own.
    expect(
      Object.keys(own.dependencies).filter((name) => !rows.some((row) => row.npm === name)),
    ).toEqual([]);
    expect(TECHNICAL_TEXT.toolchain.find(({ tool }) => tool === "voicecap")?.license).toBe(
      own.license,
    );
  });

  it("says axe-core checks each page during a run, as well as in voicecap's tests, from the package voicecap installs to run", () => {
    const own = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const installed = JSON.parse(
      readFileSync(path.join(packageRoot(), "node_modules", "axe-core", "package.json"), "utf8"),
    ) as { version?: unknown };

    // A run checks each page with axe-core's own script, from the installed package (axeScript, in
    // src/axe/results.ts), before the first key of the page's first pass.
    expect(bodyOf(tableOf(html, "toolchain")).find(([tool]) => tool === "axe-core")).toEqual([
      "axe-core",
      "An automated accessibility checker: during a run, it checks each page before NVDA reads it, and voicecap's tests run it on the shareable page and on this website, in both themes",
      "MPL-2.0",
      "A run, and voicecap's tests",
    ]);
    // So it's a dependency, which an install of voicecap brings, not one for its tests alone, and
    // the version that checks the pages is the one voicecap's package.json pins.
    expect(Object.keys(own.devDependencies)).not.toContain("axe-core");
    expect(own.dependencies["axe-core"]).toBe(installed.version);
  });

  it("names libopus-wasm in the toolchain with its version from package.json, and the libopus in it", async () => {
    const own = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const installed = JSON.parse(
      readFileSync(
        path.join(packageRoot(), "node_modules", "libopus-wasm", "package.json"),
        "utf8",
      ),
    ) as { version?: unknown };
    const version = own.dependencies["libopus-wasm"];

    // The encoder is pinned exactly, since the same sound must always give the same bytes (a golden
    // hash in test/voice-encode.test.ts tells if a version changes them), and a dependency, which an
    // install of voicecap brings: the version that encodes is the one package.json pins.
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed.version).toBe(version);
    expect(Object.keys(own.devDependencies)).not.toContain("libopus-wasm");
    // The libopus it holds is the one the package says, so the row names it as the package does.
    const { version: libopus } = await loadLibopus();
    expect(libopus).toMatch(/^libopus \d+\.\d+\.\d+$/);

    expect(bodyOf(tableOf(html, "toolchain")).find(([tool]) => tool === "libopus-wasm")).toEqual([
      "libopus-wasm",
      `Encodes each page's recording of NVDA's voice as Opus, in a small WebM file: ${libopus} compiled to WebAssembly. This package is pinned at version ${version}, so that the same sound always gives the same file`,
      "MIT (libopus: BSD, Xiph.Org)",
      "A run",
    ]);
    // It links to its package on npm, as each package's row does, and the row is the one row for it.
    expect(tableOf(html, "toolchain")).toContain(
      '<a href="https://www.npmjs.com/package/libopus-wasm">libopus-wasm</a>',
    );
    expect(TECHNICAL_TEXT.toolchain.filter(({ tool }) => tool === "libopus-wasm")).toHaveLength(1);
  });

  it("links voicecap's own row to its page on npm, as each package's row links its own", () => {
    const own = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
      name: string;
    };
    const voicecap = TECHNICAL_TEXT.toolchain.find(({ tool }) => tool === "voicecap");

    // Its package, the package.json's own name, and its name in the table the link to its page.
    expect(voicecap?.npm).toBe(own.name);
    expect(own.name).toBe("@icjia/voicecap");
    expect(tableOf(html, "toolchain")).toContain(
      '<a href="https://www.npmjs.com/package/@icjia/voicecap">voicecap</a>',
    );
    // The page links it once, and the website nowhere else: the trust page's line of links went with
    // 0.15.0. GitHub, its source, is still linked here, by "Source on GitHub" and the bottom bar.
    const hrefs = linksOf(html).map(({ href }) => href);
    expect(hrefs.filter((href) => href === `${NPM}@icjia/voicecap`)).toHaveLength(1);
    expect(hrefs).toContain(GITHUB);
    // The words under the table say whose license each npm row gives: voicecap installs every
    // package but its own.
    expect(textOf(partOf(html, "the-toolchain"))).toContain(
      "Each npm package's license is that of the package voicecap installs, or, for voicecap itself, of its own package, and voicecap's tests check each. NVDA, Chromium, and Node.js link to their source.",
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
    // And every option it names on its own (`--all`, `--sitemap`) is one the command line declares.
    const options = codes.filter((code) => code.startsWith("--"));
    expect(options.length).toBeGreaterThan(4);
    expect(options.flatMap((option) => unknownIn(`voicecap ${option}`))).toEqual([]);
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
      "index.html",
      "trust.html",
      "whats-new.html",
      "technical-details.html",
      GITHUB,
      `${GITHUB}/blob/main/README.md`,
      `${GITHUB}/blob/main/CHANGELOG.md`,
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
        /^(?:#[a-z-]+|(?:index|trust|whats-new|technical-details)\.html|https:\/\/(?:github\.com|www\.npmjs\.com)\/\S+)$/,
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
    // A reader of the website could take "this computer" for their own: it's the computer running
    // the test (Ruling P8).
    expect(text).not.toMatch(/\bthis computer\b/i);
    expect(text).toContain("only on the computer running the test");
    // Every code span came out as code: no backtick is left in the words.
    expect(text).not.toContain("`");
  });

  it("says no more than the code does: what's fingerprinted, what verify checks, the demo's pages, the commands, and the limits", () => {
    const text = textOf(markupOf(html));
    // A part's words as a reader gets them, with a command in a sentence read in its place.
    const part = (id: string): string => textOf(partOf(html, id), "");

    // A run's record holds the fingerprints of the event log, of each copy of NVDA's own log
    // (RunJson.files), and of each page's transcripts, screenshot, axe results, and recording of
    // NVDA's voice (PageRecord.files, .screenshot, .axe, and .voice), and nothing else of the run's:
    // not of kept tries, its report, or its comparisons.
    const record = part("what-a-run-records");
    expect(record).toContain(
      "the fingerprints of the event log, of each copy of NVDA's own log, and of each page's transcripts, screenshot, axe results, and recording of NVDA's voice",
    );
    // A page's folder holds its screenshot, its axe results, and its recording, by the names a run
    // gives them.
    expect(record).toContain(
      `(the key, the words, and their timing), ${SCREENSHOT_FILE}, ${AXE_FILE}, what axe-core found on the page, and ${VOICE_FILE}, what NVDA said aloud on the page`,
    );
    // The run's copies of NVDA's own log, in the folder a run gives them.
    expect(record).toContain(
      `${NVDA_LOG_FOLDER}/NVDA's own log, cleaned: a copy for each time voicecap's NVDA quit`,
    );
    // The tree is the home's main parts, not all of it (a site's report.html and compare/, say,
    // aren't in it), and a manual session's sealed record is one of them.
    expect(record).toContain("what its main parts hold:");
    expect(record).toContain(
      "<date>/<time>_manual_<page>/One hands-on NVDA session on a page, from voicecap manual add",
    );
    for (const file of ["session.txt", "session.json", "raw/"]) {
      expect(record, file).toContain(file);
    }
    // What a site's share/ folder holds: the shareable page and its Word copy, the dated copies of
    // them, the voice pages, the report for AI tools as Markdown and as JSON, the walkthrough files,
    // and the record of what was shared (src/run/paths.ts).
    expect(record).toContain(
      "share/The shareable page, its Word copy, the dated copies, the voice pages, the report as Markdown and as JSON for AI tools, the walkthrough files, and shares.json",
    );
    const evidence = part("fingerprints-and-seals");
    expect(evidence).toContain(
      "A run's record holds the SHA-256 of each page's transcripts, screenshot, axe results, and recording of NVDA's voice, recorded as each is written, and of the event log and each copy of NVDA's own log, recorded at the end of each session.",
    );
    expect(evidence).toContain(
      "Earlier tries a run kept, its own report, and its comparisons have none.",
    );
    // What verify checks, and what it doesn't: a raw copy that isn't there, which a clone of the
    // home never has, and an incomplete run's files (src/verify.ts).
    expect(evidence).toContain(
      "voicecap verify checks every seal, every chain, and every file a sealed record lists in the home, but not the page list, sitemaps, or config, which voicecap doesn't keep in the home. A manual session's raw copy, which voicecap keeps out of Git, is checked when it's there. An incomplete run is listed, and its files aren't checked: they can change until it's sealed.",
    );
    for (const overstated of [
      "fingerprint of every file",
      "checks all of it",
      "every transcript and screenshot",
      "does the same",
      "every file the records list",
      "which aren't in the home",
      "what each part of it holds",
    ]) {
      expect(text, overstated).not.toContain(overstated);
    }
    // A report's own check recomputes what the report carries: its transcripts', screenshots', and
    // axe results' fingerprints, its runs' seals, and its review entries' seals and their chain,
    // and nothing else of the home's, such as a manual session or a share. It shows only that the
    // page agrees with itself (src/share/check.ts).
    expect(evidence).toContain(
      "Each report's \"Check the fingerprints\" checks, in the reader's browser and with nothing sent anywhere, the transcripts, screenshots, axe results, run seals, and review chain the report carries.",
    );
    expect(evidence).toContain(
      "It shows the page agrees with itself: whoever changed the page could have changed its fingerprints too.",
    );
    // The report carries no sound, so its check has no recordings. The voice page has a check of its
    // own, which hashes each recording it plays against its run's record, and recomputes the seal of
    // each run they are from (src/share/voice-page.ts: its data holds those runs, and no transcript).
    expect(evidence).toContain(
      'The voice page has a "Check the fingerprints" of its own, which checks the recordings it plays and the seals of the runs they come from, in the same way.',
    );
    // Of a card's fold of what axe found, the check compares some lines with the file and not the
    // rest (its version line, each rule's criteria, its links, and the file's size and SHA-256), as
    // the report's own "What the check proves" says, so this page claims nothing of the fold.
    expect(evidence).not.toMatch(/\bfolds?\b/i);

    // The demo site's pages are published too, with a style sheet beside them and a policy of
    // their own: what's one file under a policy of its own bytes is each of the website's own pages
    // and each report.
    const website = part("this-website");
    expect(website).toContain(
      "The pages of voicecap's own demo site, in demo-site/, from voicecap itself.",
    );
    expect(website).toContain(
      "Each of the website's own pages, and each report, is one file, and loads nothing from outside.",
    );
    expect(website).toContain(
      "The demo site's pages have their style sheet beside them, and a policy of their own, which allows it and no script.",
    );
    expect(website).toContain("the transcripts repository, which the README says to keep private");
    // llms.txt, at the website's top, lists each site's current report as Markdown and as JSON,
    // which the build writes (src/site/render.ts) beside the website's pages.
    expect(website).toContain(
      "llms.txt at the website's top, which lists, for AI tools, each site's current report as Markdown and as JSON, when it has them.",
    );

    // The commands say what their code does.
    const jobs = Object.fromEntries(TECHNICAL_TEXT.commands.map(({ name, job }) => [name, job]));
    expect(Object.keys(jobs)).toContain("voicecap --site <url> …");
    // What a share makes: the page and its Word copy, a voice page when a page has a recording, the
    // report for AI tools, and the walkthrough files, which `voicecap report` doesn't make (it writes
    // the page and its Word copy again).
    expect(jobs["voicecap share"]).toBe(
      "Makes a dated copy of the shareable page and its Word copy to send, a voice page when a page has a recording, the report as Markdown and as JSON for AI tools, and each run's walkthrough file, and records them.",
    );
    expect(jobs["voicecap report"]).toBe(
      "Writes a site's report, its shareable page, and its Word copy again.",
    );
    // "Aloud" goes with "Reads", not with what the pages are named.
    expect(jobs["voicecap review --replay"]).toMatch(
      /^Reads aloud the saved words of the pages "What needs attention" names \(/,
    );
    expect(jobs["voicecap review --replay"]).toContain("`--all`");
    expect(jobs["voicecap manual add"]).toContain("for a page");
    expect(jobs["voicecap manual add"]).toContain("a sealed record of its own");
    for (const name of ["voicecap preflight", "voicecap setup", "voicecap doctor"]) {
      expect(jobs[name], name).toContain("the computer it runs on");
    }

    // A run reads the sitemap only when it's given one.
    expect(part("privacy-and-security")).toContain(
      "A run with --sitemap, or voicecap list-urls, reads the site's sitemap.",
    );
    expect(part("privacy-and-security")).toContain("which the README says to keep private");
    // A window's title is the event log's, never shown, and a run's copies of NVDA's own log can
    // hold more of another window, its text as NVDA read it too (the PC session of 2026-10-10 found
    // a Notepad document's first line in one), which a page counts and never shows.
    expect(part("privacy-and-security")).toContain(
      "A window's title, which can hold private text, is kept in the event log, never on a page or in a Word copy. A run's copies of NVDA's own log can hold more: whatever NVDA read aloud from another window, its title and its text, when NVDA started or as that window came in front. A page counts what NVDA said outside voicecap's steps, and never shows it.",
    );
    expect(part("privacy-and-security")).not.toContain("only in the event log");

    // The rules say their thresholds, and nothing they don't count.
    expect(TECHNICAL_TEXT.rules["repeated-phrase"]).not.toContain("twice");

    // The limits name frames, and the browser's port on a computer others use too.
    const limits = part("the-limits");
    expect(limits).toContain(
      "While focus is inside a frame, such as an embedded video, map, or form, a switch to another window is noticed only if it lasts until the step ends.",
    );
    expect(limits).toContain(
      "While a page is open, its browser's debugging port can be reached by other people signed in to the same computer at the same time.",
    );

    // Guidepup and its setup do VoiceOver's part on a Mac, too, so what comes later is VoiceOver's
    // runs, as the limits say, and not VoiceOver on a Mac.
    const tools = Object.fromEntries(TECHNICAL_TEXT.toolchain.map(({ tool, job }) => [tool, job]));
    expect(tools.Guidepup).toContain("VoiceOver");
    expect(tools["@guidepup/setup"]).toContain("VoiceOver");
    expect(part("what-voicecap-does")).toContain("VoiceOver runs on a Mac come later.");
    expect(limits).toContain("VoiceOver runs on a Mac come later.");
    expect(text).not.toContain("VoiceOver on a Mac comes later");
  });

  it("says what the voice page is, and that only NVDA's sound is recorded, as the code says it", () => {
    const part = (id: string): string => textOf(partOf(html, id), "");
    const record = part("what-a-run-records");
    const flow = textOf(/<ol class="flow" role="list">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "");

    // Only NVDA's sound: what a run records of it, and how.
    expect(record).toContain(
      "Only NVDA's sound is recorded, never the whole computer's and never a microphone's. voicecap uses Windows' process loopback, which takes the sound of one program and of the programs it starts: here the NVDA voicecap started, whose program it checks before it records.",
    );
    // The recorder's code does exactly that (RECORDER_SCRIPT): one activation, of Windows' process
    // loopback device (a C# string, so its backslash is written twice) ...
    const devices = [...RECORDER_SCRIPT.matchAll(/ActivateAudioInterfaceAsync\("([^"]*)"/g)].map(
      ([, device]) => device,
    );
    expect(devices).toEqual([String.raw`VAD\\Process_Loopback`]);
    // ... of one process id, and the processes it starts: mode 0 is to include the target's tree ...
    expect(RECORDER_SCRIPT).toContain("loopback.Type = 1; loopback.Pid = Pid; loopback.Mode = 0;");
    // ... after checking the program that process runs ...
    expect(RECORDER_SCRIPT).toContain("QueryFullProcessImageName(process, 0, name, ref size)");
    // ... and the NVDA voicecap started is the one it's pointed at: the process id the driver found,
    // and the nvda.exe it installed, which that program must be.
    expect(
      readFileSync(path.join(packageRoot(), "src", "drivers", "guidepup-nvda.ts"), "utf8"),
    ).toContain("recorder.target(pid, this.deps.install.nvdaExe)");
    // ... and it names no call that picks a device, so no speaker's mix and no microphone is there.
    for (const call of [
      "IMMDeviceEnumerator",
      "MMDeviceEnumerator",
      "GetDefaultAudioEndpoint",
      "EnumAudioEndpoints",
      "eCapture",
      "eRender",
      "waveIn",
    ]) {
      expect(RECORDER_SCRIPT, call).not.toContain(call);
    }
    // Recording needs the Windows build the recorder checks for first, and says so in its own words.
    const build = /\$build -lt (\d+)/.exec(RECORDER_SCRIPT)?.[1] ?? "";
    expect(build).toMatch(/^\d+$/);
    // In the words of the system that has it: Windows 11 or Windows Server 2022. No desktop Windows 10
    // reaches the build (its builds end at 19045), so "Windows 10 build 20348" would be misread.
    expect(RECORDER_SCRIPT).toContain(
      `needs Windows 11 or Windows Server 2022 (Windows build ${build} or later)`,
    );
    expect(record).toContain(
      `Recording needs Windows 11 or Windows Server 2022 (Windows build ${build} or later).`,
    );
    expect(RECORDER_SCRIPT).not.toContain("Windows 10 build");
    expect(record).not.toContain("Windows 10 build");
    // A page it can't record keeps the reason in its record (PageRecord.voice's `error`), and is read.
    expect(record).toContain(
      "A page that can't be recorded keeps the reason in its record, and is read as usual.",
    );
    // The file: Opus in a small WebM file, which the run's record fingerprints.
    expect(record).toContain(
      `Each recording is kept as ${VOICE_FILE}, Opus sound in a small WebM file made with libopus-wasm: the same sound always gives the same bytes. Its SHA-256 is in the run's record, so the run's seal covers it.`,
    );

    // The voice page, which a share adds when a page has a recording: it plays each recording at the
    // speeds its own words give, with the pitch kept as its script sets it, and the recording is
    // evidence, as the page's lead says, since the transcripts are the record of what was reviewed.
    const speeds = names(VOICE_TEXT.speed.rates.map((rate) => VOICE_TEXT.speed.label(rate)));
    expect(speeds).toBe("1×, 0.75×, 0.5×, and 0.25×");
    expect(flow).toContain(
      `When a page has a recording of NVDA's voice, the share adds a voice page, which plays each recording at ${speeds}, with the pitch kept. The recording is evidence of what NVDA said aloud: the person's review is made from the transcripts.`,
    );
    expect(VOICE_SCRIPT).toContain("sound.preservesPitch = true;");
    expect(VOICE_TEXT.lead).toContain("recorded from NVDA alone and sealed with the run");
    expect(VOICE_TEXT.lead).toContain(
      "The transcripts on the shareable page are the record of what was reviewed.",
    );
  });

  it("says a share holds its voice page wherever the page says what a share holds, and that only its policy lets it play sound", () => {
    const part = (id: string): string => textOf(partOf(html, id), "");
    const jobs = Object.fromEntries(TECHNICAL_TEXT.commands.map(({ name, job }) => [name, job]));

    // The share's folder, and the command that makes the share.
    expect(part("what-a-run-records")).toContain(
      "The shareable page, its Word copy, the dated copies, the voice pages, the report as Markdown and as JSON for AI tools, the walkthrough files, and shares.json",
    );
    expect(jobs["voicecap share"]).toBe(
      "Makes a dated copy of the shareable page and its Word copy to send, a voice page when a page has a recording, the report as Markdown and as JSON for AI tools, and each run's walkthrough file, and records them.",
    );
    // The website publishes it with its report's other files, and lists it as the report's files
    // list it (SITE_TEXT.files.voice, which the front page's fold uses: see test/site-render.test.ts).
    expect(SITE_TEXT.files.voice).toBe("NVDA's voice");
    expect(part("this-website")).toContain(
      "A share's voice page is published with its report's other files, and listed with them as NVDA's voice.",
    );
    // The website's policy for it: the one addition (src/site/headers.ts), made only when asked.
    expect(part("this-website")).toContain(
      "A voice page's policy also lets it play audio from the recordings it holds, which are in the page as data: addresses (media-src data:); no other page's does.",
    );
    const none = { styles: [], scripts: [] };
    expect(contentSecurityPolicy(none, { media: true })).toContain("; media-src data:;");
    expect(contentSecurityPolicy(none)).not.toContain("media-src");
    // And what the other pages' policy is, said as it was: no connection, one style, one script.
    expect(part("this-website")).toContain(
      "Each one's Content Security Policy is made from the SHA-256 of its own style and script, and allows no connection.",
    );
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
