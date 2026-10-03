/**
 * The shareable page as one file: its head, the skip link and the landmarks, the sections in the
 * spec's order, one style block with the fonts embedded in it, one script, and nothing loaded from
 * outside the file. The demo runs of 29 September 2026 are the real case; runs built in memory add
 * what the demo has none of (a page that sounds different, flags, an error voicecap didn't expect),
 * and a site where no run counts yet.
 *
 * The page's own script is tried in Chromium too, on the demo's page opened from a file: the theme,
 * the two buttons it shows, and that each part of the page's one script starts on its own.
 */
import type * as FsPromises from "node:fs/promises";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { FlagResult } from "../src/model.js";
import { CHECK_LIBRARY, CHECK_SCRIPT, type CheckData } from "../src/share/check.js";
import { fontFaceCss } from "../src/share/fonts.js";
import { SHARE_SCRIPT } from "../src/share/html/client.js";
import { renderSharePage } from "../src/share/html/document.js";
import { SHARE_CSS } from "../src/share/html/style.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { STORY } from "../src/share/text.js";
import { launchBrowser } from "./helpers/axe.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { attributes, decode } from "./helpers/share-html.js";
import {
  demoModel,
  downloadOf,
  inputOf,
  LINES,
  storeOf,
  TRANSCRIPTS,
} from "./helpers/share-model.js";

/** The only places the page links to outside itself. */
const LINKS_OUT = [
  "https://github.com/ICJIA/voicecap",
  "https://github.com/ICJIA/voicecap/issues",
  "https://www.nvaccess.org/",
  STORY.deque.url,
];

/** The sections' headings, in the spec's order. */
const SECTIONS = [
  "glance-h",
  "how-h",
  "pages-h",
  "find-h",
  "chg-h",
  "prob-h",
  "lim-h",
  "ev-h",
  "story-h",
  "app-h",
];

/** The fonts' folder, beside src/share/fonts.ts, which reads it. */
const FONTS = fileURLToPath(new URL("../src/share/fonts/", import.meta.url));

/** The nine faces, in the order the page declares them: each family, style, weight, and file. */
const FACES = [
  ["IBM Plex Sans", "normal", "400", "ibm-plex-sans-latin-400-normal.woff2"],
  ["IBM Plex Sans", "italic", "400", "ibm-plex-sans-latin-400-italic.woff2"],
  ["IBM Plex Sans", "normal", "500", "ibm-plex-sans-latin-500-normal.woff2"],
  ["IBM Plex Sans", "normal", "600", "ibm-plex-sans-latin-600-normal.woff2"],
  ["IBM Plex Sans Condensed", "normal", "500", "ibm-plex-sans-condensed-latin-500-normal.woff2"],
  ["IBM Plex Sans Condensed", "normal", "600", "ibm-plex-sans-condensed-latin-600-normal.woff2"],
  ["IBM Plex Sans Condensed", "normal", "700", "ibm-plex-sans-condensed-latin-700-normal.woff2"],
  ["IBM Plex Mono", "normal", "400", "ibm-plex-mono-latin-400-normal.woff2"],
  ["IBM Plex Mono", "normal", "500", "ibm-plex-mono-latin-500-normal.woff2"],
] as const;

const LINK_FLAG: FlagResult = {
  rule: "generic-link-text",
  pass: "read",
  count: 1,
  found: [{ text: "click here", count: 1 }],
  message: 'Generic link text announced 1 time in the read pass: "click here" ×1.',
};

/** The grants page's read pass once someone fixed its link. */
const FIXED = LINES.read.map((line) => line.replace("click here", "Read the FY27 plan"));

const BEFORE = { id: "2026-09-26_1405", createdAt: "2026-09-26T14:05:00-05:00" };
const LATEST = { id: "2026-09-27_0930", createdAt: "2026-09-27T09:30:00-05:00" };

/**
 * Two runs of three pages, with what the demo has none of: the home page has flags, the grants
 * page sounds different in the latest run (its link was fixed), and the latest run met an error
 * voicecap didn't expect on the third page, whose transcripts come from the run before.
 */
function richModel(): ShareModel {
  const pages = (latest: boolean): SharePageSpec[] => [
    { path: "/", files: TRANSCRIPTS, passes: LINES, flags: [LINK_FLAG] },
    {
      path: "/grants/",
      label: "Grants",
      files: TRANSCRIPTS,
      passes: { ...LINES, read: latest ? FIXED : LINES.read },
    },
    latest
      ? {
          path: "/apply/",
          status: "failed",
          failedAttempts: [
            failedAttempt({
              n: 1,
              cause: "unexpected",
              message: "Cannot read properties of undefined (reading 'spoken')",
              stack: "TypeError: Cannot read properties of undefined (reading 'spoken')\n    at x",
            }),
          ],
        }
      : { path: "/apply/", files: TRANSCRIPTS, passes: LINES },
  ];
  const runs = [
    shareRun({ ...BEFORE, pages: pages(false) }),
    shareRun({ ...LATEST, pages: pages(true) }),
  ];
  const grants = runs[1]?.pages[1]?.slug;
  const transcripts = storeOf((slug, run) =>
    run === LATEST.id && slug === grants ? { ...LINES, read: FIXED } : LINES,
  );
  return buildShareModel(inputOf(runs, { transcripts }));
}

/**
 * A large site: three runs of 400 pages with their transcripts. The first run reads every page; in
 * the two after it the first page fails, so the page draws on all three runs. Each run's walkthrough
 * file lists all 400 pages, so this is where the downloads weigh most.
 */
function largeModel(): ShareModel {
  const pages = (failing: boolean): SharePageSpec[] =>
    Array.from({ length: 400 }, (_, index): SharePageSpec => ({
      path: `/section-${Math.floor(index / 20)}/page-${index}/`,
      label: `Page ${index}`,
      ...(failing && index === 0
        ? { status: "failed" as const }
        : { files: TRANSCRIPTS, passes: LINES }),
    }));
  const runs = [1, 2, 3].map((day) =>
    shareRun({
      id: `2026-09-2${day}_0900`,
      createdAt: `2026-09-2${day}T09:00:00-05:00`,
      pages: pages(day > 1),
    }),
  );
  return buildShareModel(inputOf(runs, { transcripts: storeOf() }));
}

/** A site whose only run was a replay, so no run counts yet. */
function noRunModel(): ShareModel {
  return buildShareModel(
    inputOf([shareRun({ id: "2026-09-26_1405", replayed: true, pages: [{ path: "/" }] })]),
  );
}

/** The page's markup, with what its style and script elements hold left out. */
function markupOf(html: string): string {
  return html
    .replace(/(<style>)[\s\S]*?(<\/style>)/g, "$1$2")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, "$1$2");
}

/**
 * The page with its fonts' data and its walkthrough files' left out: base64 is letters, and could
 * spell anything.
 */
function withoutBase64Data(html: string): string {
  return html
    .replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g, "data:font/woff2;base64,")
    .replace(/data:application\/json;base64,[A-Za-z0-9+/=]+/g, "data:application/json;base64,");
}

/** A walkthrough file's download, as its link's address gives it: JSON, in base64, and nothing else. */
const DOWNLOAD_ADDRESS = /^data:application\/json;base64,[A-Za-z0-9+/]*={0,2}$/;

/**
 * The addresses a page links to that it shouldn't: every link's address, as a reader gets it, but
 * for the page's own parts (`#…`), the four places it names (LINKS_OUT), and a walkthrough file's
 * download. That is one kind of link only: a link with a `download` attribute that ends
 * `_walkthrough.json`, to a data address that holds JSON in base64. A data address without that
 * name, or of another type, is one the page shouldn't link to.
 */
function unlistedLinks(markup: string): string[] {
  return (markup.match(/<a\b[^>]*>/g) ?? []).flatMap((tag) => {
    const [href = ""] = attributes(tag, "href").map(decode);
    if (href.startsWith("#") || LINKS_OUT.includes(href)) return [];
    const [name = ""] = attributes(tag, "download").map(decode);
    const download = DOWNLOAD_ADDRESS.test(href) && name.endsWith("_walkthrough.json");
    return download ? [] : [href.slice(0, 80)];
  });
}

/** How many folds are around each section heading, in page order. */
function foldsAroundHeadings(markup: string): number[] {
  const around: number[] = [];
  let depth = 0;
  for (const [tag] of markup.matchAll(/<\/?details\b|<h2\b/g)) {
    if (tag === "<details") depth += 1;
    else if (tag === "</details") depth -= 1;
    else around.push(depth);
  }
  return around;
}

/** The values that appear more than once. */
function repeated(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

/** What a selector styles: its last compound selector ("summary" in "details.fold > summary"). */
function subjectOf(selector: string): string {
  const compounds = selector.trim().split(/\s*[\s>+~]\s*/);
  return compounds[compounds.length - 1] ?? "";
}

/**
 * Each rule of a style sheet that holds declarations, those inside an @media block included: what
 * each of its selectors styles, and its declarations.
 */
function rulesOf(css: string): { subjects: string[]; declarations: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selectors = "", declarations = ""]) => ({
      subjects: selectors.split(",").map(subjectOf),
      declarations,
    }),
  );
}

interface Checked {
  files: { label: string; ok: boolean }[];
  runs: { id: string; ok: boolean }[];
  reviewProblems: string[];
  line: string;
}

// The check's library as a browser gets it, with nothing but TextEncoder from outside.
const library = vm.runInNewContext(CHECK_LIBRARY + ";({ sha256Hex, checkAll })", {
  TextEncoder,
}) as {
  sha256Hex: (bytes: Uint8Array) => string;
  checkAll: (data: CheckData, digest: (bytes: Uint8Array) => string) => Promise<Checked>;
};

describe("renderSharePage", () => {
  let fontCss: string;
  /**
   * The page of each model: the demo's, one built in memory, and one where no run counts, with how
   * many runs each draws on.
   */
  let pages: { name: string; html: string; runs: number }[];
  let demoPage: string;

  beforeAll(async () => {
    fontCss = await fontFaceCss();
    const models: [string, ShareModel][] = [
      ["the demo", await demoModel()],
      ["runs built in memory", richModel()],
      ["no run that counts", noRunModel()],
    ];
    pages = models.map(([name, model]) => ({
      name,
      html: renderSharePage(model, { fontCss }),
      runs: model.evidence.length,
    }));
    demoPage = pages[0]?.html ?? "";
  });

  it("is one self-contained file", () => {
    const linked = new Set<string>();
    for (const { name, html, runs } of pages) {
      const markup = markupOf(html);
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];

      expect(html.match(/<style\b/g), name).toHaveLength(1);
      expect(withoutBase64Data(html), name).not.toMatch(/style\s*=/i);
      // One script that runs, and the check's data: a block of JSON, which never runs.
      expect(
        scripts.filter((tag) => tag === "<script>"),
        name,
      ).toHaveLength(1);
      expect(
        scripts.filter((tag) => tag !== "<script>"),
        name,
      ).toEqual(
        name === "no run that counts" ? [] : ['<script type="application/json" id="fp-data">'],
      );
      // Nothing loaded: no source, no linked file, no import, and every url() the page's own data.
      expect(withoutBase64Data(html), name).not.toMatch(/\ssrc\s*=/i);
      expect(markup, name).not.toMatch(/<link\b/i);
      expect(html, name).not.toMatch(/@import/i);
      for (const [, address = ""] of html.matchAll(/url\(\s*["']?([^"')]*)/g)) {
        expect(address, name).toMatch(/^data:/);
      }
      // Links go to the page's own parts, to the four places it names, or (one for each run that
      // counts) to a walkthrough file the page carries, which the reader downloads.
      expect(unlistedLinks(markup), name).toEqual([]);
      expect(attributes(markup, "download"), name).toHaveLength(runs);
      for (const href of attributes(markup, "href").map(decode)) {
        if (LINKS_OUT.includes(href)) linked.add(href);
      }
      const faces = html.match(/@font-face\s*\{[^}]*\}/g) ?? [];
      expect(html.match(/@font-face/g), name).toHaveLength(9);
      expect(faces, name).toHaveLength(9);
      for (const face of faces) expect(face, name).toContain("url(data:font/woff2;base64,");
    }
    // Each of the four is linked from some page, so the list above is the page's own.
    expect([...linked].sort()).toEqual([...LINKS_OUT].sort());
  });

  it("allows a link to a data address for a walkthrough file's download, and no other", () => {
    const address = "data:application/json;base64,e30K";
    const download = `<a download="127.0.0.1_4848_r1_walkthrough.json" href="${address}">Download</a>`;

    expect(unlistedLinks(download)).toEqual([]);
    // The page's own parts and the four places it names stay allowed.
    expect(
      unlistedLinks(
        `<a href="#prob-h">x</a><a href="${LINKS_OUT[0] ?? ""}">y</a><a href="${LINKS_OUT[3] ?? ""}">z</a>`,
      ),
    ).toEqual([]);

    const refused: [why: string, link: string][] = [
      ["a data address with no download name", `<a href="${address}">x</a>`],
      ["a download that has no value", `<a download href="${address}">x</a>`],
      [
        "a download that isn't a walkthrough file's name",
        `<a download="notes.json" href="${address}">x</a>`,
      ],
      [
        "a data address of another type",
        '<a download="r1_walkthrough.json" href="data:text/html;base64,e30K">x</a>',
      ],
      [
        "a data address that isn't base64",
        '<a download="r1_walkthrough.json" href="data:application/json,%7B%7D">x</a>',
      ],
      [
        "a data address with more than base64 in it",
        `<a download="r1_walkthrough.json" href="${address}#more">x</a>`,
      ],
      ["a script", '<a download="r1_walkthrough.json" href="javascript:alert(1)">x</a>'],
      [
        "another site",
        '<a download="r1_walkthrough.json" href="https://example.com/r1_walkthrough.json">x</a>',
      ],
      ["another page of a site it does name", `<a href="${LINKS_OUT[0] ?? ""}/other">x</a>`],
      ["a link with no address", '<a download="r1_walkthrough.json">x</a>'],
    ];
    for (const [why, link] of refused) expect(unlistedLinks(link), why).toHaveLength(1);
  });

  it("adds a measured amount for a large site: three runs of 400 pages add exactly the downloads' own size", () => {
    const model = largeModel();
    const withoutDownloads: ShareModel = {
      ...model,
      evidence: model.evidence.map((each) => ({
        ...each,
        walkthrough: { ...downloadOf(each), base64: "" },
      })),
    };
    const added = model.evidence.reduce((total, each) => total + downloadOf(each).base64.length, 0);
    const page = renderSharePage(model, { fontCss: "" });
    const bare = renderSharePage(withoutDownloads, { fontCss: "" });

    // The page draws on all three runs, each with a file that lists all 400 pages.
    expect(model.evidence.map((each) => each.run.id)).toHaveLength(3);
    expect(model.pages).toHaveLength(400);
    expect(model.evidence.every((each) => downloadOf(each).bytes > 100_000)).toBe(true);
    // Nothing but the files themselves: the page is as long as it was without them, plus them.
    expect(page.length - bare.length).toBe(added);
    expect(Buffer.byteLength(page) - Buffer.byteLength(bare)).toBe(added);
  });

  it("puts the sections in the spec's order, each h2 outside every fold", () => {
    for (const { name, html } of pages) {
      const markup = markupOf(html);
      const main = markup.indexOf('<main id="main">');
      const mainEnd = markup.indexOf("</main>");
      const headings = [...markup.matchAll(/<h2 id="([^"]+)"/g)];

      expect(
        headings.map(([, id]) => id),
        name,
      ).toEqual(SECTIONS);
      for (const heading of headings) {
        expect(heading.index, name).toBeGreaterThan(main);
        expect(heading.index, name).toBeLessThan(mainEnd);
      }
      expect(foldsAroundHeadings(markup), name).toEqual(SECTIONS.map(() => 0));
      for (const [, line = ""] of markup.matchAll(/<summary>([\s\S]*?)<\/summary>/g)) {
        expect(line, name).not.toMatch(/<h[1-6]\b/);
      }
      // The header, with the site's name, comes before main, and the footer after it.
      expect(markup.indexOf('<header class="mast">'), name).toBeGreaterThan(-1);
      expect(markup.indexOf('<header class="mast">'), name).toBeLessThan(main);
      expect(markup.indexOf("<h1>"), name).toBeLessThan(main);
      expect(markup.indexOf("<footer>"), name).toBeGreaterThan(mainEnd);
      // Headings go down one level at a time: the site's name, then sections, then their parts.
      const levels = [...markup.matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level));
      expect(levels[0], name).toBe(1);
      levels.forEach((level, index) => {
        const step = level - (levels[index - 1] ?? 0);
        expect(step, `${name}: heading ${index + 1}`).toBeLessThanOrEqual(1);
      });
    }
  });

  it("stays within its size budget", () => {
    expect(fontCss).toContain("@font-face");
    expect(fontCss.length).toBeLessThan(260_000);
    expect(SHARE_CSS.length).toBeLessThan(40_000);
    expect((SHARE_SCRIPT + CHECK_SCRIPT).length).toBeLessThan(30_000);
  });

  it("has a head with its language, its character set, the viewport, and the site's name", async () => {
    expect(demoPage).toMatch(
      /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>127\.0\.0\.1:4848: how its pages read aloud with NVDA<\/title>\n<style>/,
    );
    // The one style element holds the fonts, then the page's styles, and nothing else.
    const style = /<style>([\s\S]*?)<\/style>/.exec(demoPage)?.[1] ?? "";
    expect(style.indexOf(fontCss)).toBeGreaterThan(-1);
    expect(style.indexOf(fontCss)).toBeLessThan(style.indexOf(SHARE_CSS));
    expect(style.replace(fontCss, "").replace(SHARE_CSS, "").trim()).toBe("");

    const model = await demoModel();
    const named = renderSharePage(
      { ...model, header: { ...model.header, siteName: '<Agency> & "Co"' } },
      { fontCss: "" },
    );
    expect(named).toContain(
      "<title>&lt;Agency&gt; &amp; &quot;Co&quot;: how its pages read aloud with NVDA</title>",
    );
  });

  it("opens with the skip link to the main content, and ends with the one script", () => {
    for (const { name, html } of pages) {
      const body = html.slice(html.indexOf("<body>") + "<body>".length).trimStart();

      expect(body.startsWith('<a class="skip" href="#main">Skip to main content</a>'), name).toBe(
        true,
      );
      expect(html.match(/<main id="main">/g), name).toHaveLength(1);
      expect(
        html.endsWith(`<script>${SHARE_SCRIPT}${CHECK_SCRIPT}</script>\n</body>\n</html>\n`),
        name,
      ).toBe(true);
    }
  });

  it("links only to parts of itself that are there, and names each part once", () => {
    for (const { name, html } of pages) {
      const markup = markupOf(html);
      const ids = attributes(markup, "id").map(decode);
      const targets = attributes(markup, "href")
        .filter((href) => href.startsWith("#"))
        .map((href) => decode(href.slice(1)));

      expect(repeated(ids), name).toEqual([]);
      // At least the skip link, and the summary's way into each later section.
      expect(targets.length, name).toBeGreaterThanOrEqual(10);
      expect(
        targets.filter((target) => !ids.includes(target)),
        name,
      ).toEqual([]);
    }
  });

  it("carries the check's data exactly, so the check finds every file matching", async () => {
    const json = /<script type="application\/json" id="fp-data">([\s\S]*?)<\/script>/.exec(
      demoPage,
    )?.[1];
    if (json === undefined) throw new Error("The demo's page has no data for its check.");

    const checked = await library.checkAll(JSON.parse(json) as CheckData, library.sha256Hex);
    const result = JSON.parse(JSON.stringify(checked)) as Checked;

    // The demo's 21 transcripts: how-a-run-works's three from run 1315, the rest from run 1402.
    expect(result.files).toHaveLength(21);
    expect(result.files.filter(({ ok }) => !ok)).toEqual([]);
    expect(result.runs).toHaveLength(2);
    expect(result.runs.filter(({ ok }) => !ok)).toEqual([]);
    expect(result.reviewProblems).toEqual([]);
    expect(result.line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
  });
});

describe("fontFaceCss", () => {
  it("embeds the nine faces the page's styles name, each file byte for byte", async () => {
    const css = await fontFaceCss();
    const faces = [
      ...css.matchAll(
        /@font-face \{ font-family: "([^"]+)"; font-style: (\w+); font-weight: (\d+); font-display: swap; src: url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\("woff2"\); \}/g,
      ),
    ];

    expect(faces.map(([, family, style, weight]) => [family, style, weight])).toEqual(
      FACES.map(([family, style, weight]) => [family, style, weight]),
    );
    expect(css.match(/@font-face/g)).toHaveLength(FACES.length);
    for (const [index, [, , , name]] of FACES.entries()) {
      const embedded = Buffer.from(faces[index]?.[4] ?? "", "base64");
      const file = await readFile(path.join(FONTS, name));

      expect(embedded.subarray(0, 4).toString("latin1"), name).toBe("wOF2");
      expect(embedded.equals(file), name).toBe(true);
    }
    // The families are the ones the page's styles ask for.
    for (const family of new Set(FACES.map(([family]) => family))) {
      expect(SHARE_CSS).toContain(`"${family}"`);
    }
  });

  it("reads the files once", () => {
    expect(fontFaceCss()).toBe(fontFaceCss());
  });

  it("reads the files again after a read that failed, rather than keep the failure", async () => {
    // A fresh copy of the module, whose reads fail until told otherwise, as when another program
    // holds a file for a moment.
    vi.resetModules();
    let failing = true;
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const real = await importOriginal<typeof FsPromises>();
      const readFile = (file: URL) =>
        failing
          ? Promise.reject(new Error("The file is held by another program."))
          : real.readFile(file);
      return { ...real, readFile };
    });
    try {
      const fonts = await import("../src/share/fonts.js");

      await expect(fonts.fontFaceCss()).rejects.toThrow("held by another program");
      failing = false;
      await expect(fonts.fontFaceCss()).resolves.toContain("@font-face");
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });

  it("ships the fonts with their licence, and nothing else", async () => {
    const files = await readdir(FONTS);

    expect(files.sort()).toEqual([...FACES.map(([, , , name]) => name), "OFL.txt"].sort());
  });

  it("names each family's copyright notice, then gives the SIL Open Font License once", async () => {
    const licence = await readFile(path.join(FONTS, "OFL.txt"), "utf8");
    // How each package's own LICENSE gives its notice: each begins so.
    const notices = [
      "IBM Plex Sans (@fontsource/ibm-plex-sans 5.3.0):\nCopyright 2019 IBM Corp. All rights reserved. IBMPlexSans-Italic[wdth,wght].ttf: Copyright 2019 IBM Corp. All rights reserved.\n",
      "IBM Plex Sans Condensed (@fontsource/ibm-plex-sans-condensed 5.3.0):\nCopyright 2019 IBM Corp. All rights reserved. IBMPlexSansCondensed-ThinItalic.ttf: ",
      "IBM Plex Mono (@fontsource/ibm-plex-mono 5.3.0):\nCopyright 2017 IBM Corp. All rights reserved. IBMPlexMono-ThinItalic.ttf: ",
    ];
    const places = notices.map((notice) => licence.indexOf(notice));
    const terms = licence.indexOf(
      "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
    );

    expect(licence.startsWith(notices[0] ?? "")).toBe(true);
    expect(places.every((place) => place >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(licence.match(/^Copyright \d{4} IBM Corp\./gm)).toHaveLength(3);
    // The notices, then the licence, once.
    expect(terms).toBeGreaterThan(places[2] ?? Infinity);
    expect(licence.match(/This Font Software is licensed under/g)).toHaveLength(1);
    expect(licence.match(/SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/g)).toHaveLength(1);
    expect(licence.endsWith("OTHER DEALINGS IN THE FONT SOFTWARE.\n")).toBe(true);
  });
});

describe("SHARE_CSS", () => {
  it("lets nothing but the hidden attribute show or hide what the scripts show", () => {
    // What a script shows or hides, by the hidden attribute alone: the no-script line, the
    // fingerprint check's buttons, its result, and its list, and any fold.
    const shown = [
      /\.fp-noscript(?![\w-])/,
      /\.fp-result(?![\w-])/,
      /\.fp-button(?![\w-])/,
      /\.fp-demo(?![\w-])/,
      /\.fold(?![\w-])/,
      /^details(?![\w-])/,
      /#(?:fp-run|fp-demo|fp-list|open-all|theme-toggle)(?![\w-])/,
    ];
    const rules = rulesOf(SHARE_CSS);
    const displayed = rules.filter(
      ({ subjects, declarations }) =>
        /(?:^|;)\s*display\s*:/.test(declarations) &&
        subjects.some((subject) => shown.some((pattern) => pattern.test(subject))),
    );

    expect(rules.length).toBeGreaterThan(200);
    expect(displayed).toEqual([]);
    expect(SHARE_CSS).toContain("[hidden] { display: none !important; }");
    // An empty live region stays in the page, so what the check finds is announced.
    expect(SHARE_CSS).not.toMatch(/:empty/);
  });

  it("lets no grid of cards, tiles, or steps ask for a column wider than its own box", () => {
    // repeat(auto-fit, minmax(300px, 1fr)) keeps a 300 px column in a window of 272 px (a phone's
    // 320 less the page's margins), and the page scrolls sideways. minmax(min(300px, 100%), 1fr)
    // lets the column shrink to its box.
    const grids = [
      ...SHARE_CSS.matchAll(/repeat\(auto-(?:fit|fill), minmax\((min\([^)]*\)|[^,]*), 1fr\)\)/g),
    ];

    expect(grids.length).toBeGreaterThan(10);
    for (const [grid, column = ""] of grids) {
      expect(column, grid).toMatch(/^min\(\d+px, 100%\)$/);
    }
  });

  it("keeps the mockup's print rules, and holds nothing from outside or of its samples", () => {
    // Light in print, without the buttons, which do nothing on paper.
    expect(SHARE_CSS).toMatch(
      /@media print \{ :root \{ --bg: #fff;[^}]*color-scheme: light; \} \.theme \{ display: none; \} \}/,
    );
    expect(SHARE_CSS).not.toMatch(/<\/style|<!--/i);
    expect(SHARE_CSS).not.toMatch(/@import|url\(/);
    expect(SHARE_CSS).not.toMatch(/\.mock\b/);
  });
});

describe("SHARE_SCRIPT", () => {
  it("can sit inside the page's one script, before the check's", () => {
    // Its code is all inside one function.
    expect(SHARE_SCRIPT.trim()).toMatch(/^\(function \(\) \{\n[\s\S]*\n\}\)\(\);$/);
    expect(SHARE_SCRIPT).not.toMatch(/<!--|<\/?script/i);
    expect(SHARE_SCRIPT).not.toMatch(/\b(style|src|href)\s*=/i);
    // The check's library declares its names at the top level of the one script: a declaration of
    // the same name here would stop the whole script from parsing, which no guard can catch.
    expect(() => new vm.Script(SHARE_SCRIPT + CHECK_SCRIPT)).not.toThrow();
  });

  it("adds no name to the page, and leaves a page without its markup alone", () => {
    const errors: unknown[] = [];
    const looked: string[] = [];
    const context = vm.createContext({
      window: {
        addEventListener: () => undefined,
        location: { hash: "" },
        console: { error: (error: unknown) => errors.push(error) },
      },
      document: {
        documentElement: { setAttribute: () => undefined, getAttribute: () => null },
        getElementById: (id: string) => {
          looked.push(id);
          return null;
        },
        querySelectorAll: () => [],
        addEventListener: () => undefined,
      },
    });
    const before = Object.keys(context).sort();

    vm.runInContext(SHARE_SCRIPT, context);

    // It looked for its two buttons, found neither, and did nothing more.
    expect(looked.sort()).toEqual(["open-all", "theme-toggle"]);
    expect(Object.keys(context).sort()).toEqual(before);
    expect(errors).toEqual([]);
  });
});

describe("the page's script, in Chromium", () => {
  let browser: Browser;
  let folder: string;
  let url: string;
  const contexts: BrowserContext[] = [];
  /** What each open page reported going wrong: errors thrown, and errors written to its console. */
  const problems = new WeakMap<Page, string[]>();

  /** The page's background in each theme. */
  const DARK = "rgb(11, 16, 21)";
  const LIGHT = "rgb(255, 255, 255)";

  beforeAll(async () => {
    browser = await launchBrowser();
    folder = await mkdtemp(path.join(tmpdir(), "voicecap-page-"));
    const file = path.join(folder, "current.html");
    await writeFile(file, renderSharePage(await demoModel(), { fontCss: await fontFaceCss() }));
    url = pathToFileURL(file).href;
  });

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.close()));
  });

  afterAll(async () => {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
  });

  /** The page, open; `before` runs in it first, ahead of the page's own script. */
  async function open(options: { scripts?: boolean; before?: string } = {}): Promise<Page> {
    const context = await browser.newContext({ javaScriptEnabled: options.scripts ?? true });
    contexts.push(context);
    if (options.before !== undefined) await context.addInitScript(options.before);
    const page = await context.newPage();
    const found: string[] = [];
    page.on("pageerror", (error) => found.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") found.push(message.text());
    });
    problems.set(page, found);
    await page.goto(url);
    return page;
  }

  const background = (page: Page): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  /** How many of the page's folds are closed. */
  const closedFolds = (page: Page): Promise<number> =>
    page.evaluate(
      () => [...document.querySelectorAll("details")].filter((fold) => !fold.open).length,
    );

  it("shows its two buttons only when its script runs", async () => {
    const without = await open({ scripts: false });
    const page = await open();

    expect(await without.locator("#open-all").isVisible()).toBe(false);
    expect(await without.locator("#theme-toggle").isVisible()).toBe(false);
    expect(await page.locator("#open-all").isVisible()).toBe(true);
    expect(await page.locator("#theme-toggle").isVisible()).toBe(true);
  });

  it("is dark until the reader picks light, which this browser keeps, and light in print", async () => {
    const page = await open();
    const toggle = page.locator("#theme-toggle");

    expect(await background(page)).toBe(DARK);
    expect(await toggle.textContent()).toBe("Light version");
    await page.emulateMedia({ media: "print" });
    expect(await background(page)).toBe(LIGHT);
    await page.emulateMedia({ media: "screen" });

    await toggle.click();
    expect(await background(page)).toBe(LIGHT);
    expect(await toggle.textContent()).toBe("Dark version");
    await page.reload();
    expect(await background(page)).toBe(LIGHT);
    expect(await page.locator("#theme-toggle").textContent()).toBe("Dark version");

    await page.locator("#theme-toggle").click();
    await page.reload();
    expect(await background(page)).toBe(DARK);
    expect(problems.get(page)).toEqual([]);
  });

  it("prints every transcript and table whole, with nothing left in a box to scroll", async () => {
    const page = await open();
    // The boxes a keyboard scrolls on screen that hold more than they show, by their names.
    const cutShort = (): Promise<(string | null)[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll(".scroll")]
          .filter((box) => box.scrollHeight > box.clientHeight || box.scrollWidth > box.clientWidth)
          .map((box) => box.getAttribute("aria-label")),
      );
    // About the width a printed A4 page gives, inside Chromium's margins.
    await page.setViewportSize({ width: 718, height: 1000 });

    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    expect(await closedFolds(page)).toBe(0);
    expect(await cutShort()).toEqual([]);
    // On screen the same boxes scroll: the longest transcripts are taller than their boxes.
    await page.emulateMedia({ media: "screen" });
    expect((await cutShort()).length).toBeGreaterThan(0);
  });

  it("still switches when the browser won't store anything", async () => {
    const page = await open({
      before: `Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() { throw new DOMException("Storage is turned off.", "SecurityError"); },
      });`,
    });

    expect(await background(page)).toBe(DARK);
    await page.locator("#theme-toggle").click();
    expect(await background(page)).toBe(LIGHT);
    expect(problems.get(page)).toEqual([]);
  });

  it.each([
    ["the theme button", "theme-toggle"],
    ["Open every section", "open-all"],
    ["the fingerprint check", "fp-run"],
  ])("starts each part on its own: when %s can't start, the rest still do", async (_, broken) => {
    // The broken part's button refuses its click handler, so its start-up throws there.
    const page = await open({
      before: `const add = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
          if (this instanceof Element && this.id === ${JSON.stringify(broken)}) {
            throw new Error("Broken on purpose, for the test.");
          }
          return add.call(this, type, listener, options);
        };`,
    });

    // The failure is reported, never silent.
    expect(problems.get(page)?.join("\n")).toContain("Broken on purpose, for the test.");
    if (broken !== "fp-run") {
      // A part of the page's own that couldn't start shows no button that would do nothing.
      expect(await page.locator(`#${broken}`).isVisible()).toBe(false);
    }
    if (broken !== "theme-toggle") {
      await page.locator("#theme-toggle").click();
      expect(await background(page)).toBe(LIGHT);
    }
    if (broken !== "open-all") {
      expect(await closedFolds(page)).toBeGreaterThan(0);
      await page.locator("#open-all").click();
      expect(await closedFolds(page)).toBe(0);
    }
    if (broken !== "fp-run") {
      await page.locator("#fp-run").click();
      await expect
        .poll(() => page.locator("#fp-result").textContent(), { timeout: 10_000 })
        .toContain("21 of 21 transcripts match their fingerprints");
    }
  });
});
