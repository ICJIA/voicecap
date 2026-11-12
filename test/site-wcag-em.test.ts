// The website's WCAG-EM page: how a large site's pages are chosen, for a manager or an auditor who
// has never heard of WCAG-EM. Its account of WCAG-EM must be the W3C's (WCAG-EM 2, Group Note, 23 July
// 2026), its pictures must be real HTML whose meaning a screen reader hears, and what it says of the
// reports here must come from the records.
import { describe, expect, it } from "vitest";

import { renderWcagEm, type SampledReport } from "../src/site/wcag-em.js";
import { WCAG_EM_LINKS, WCAG_EM_TEXT } from "../src/site/wcag-em-text.js";
import { textOf } from "./helpers/share-html.js";
import { FACTS } from "./helpers/trust-facts.js";

const ICJIA: SampledReport = {
  name: "icjia.illinois.gov",
  pages: 171,
  sitePages: 2466,
  href: "icjia.illinois.gov/icjia.illinois.gov_2026-11-12.html",
};
const page = (sampled: readonly SampledReport[] = [ICJIA]): string =>
  renderWcagEm({ voicecap: FACTS, sampled });
const mainOf = (html: string): string => /<main id="main">([\s\S]*)<\/main>/.exec(html)?.[1] ?? "";

describe("renderWcagEm", () => {
  it("is a page of the website: its title, the way back to the test results first, and its own link in both bars", () => {
    const html = page();
    expect(html).toContain("<title>How pages are chosen · Screen reader test results</title>");
    expect(mainOf(html).trimStart()).toMatch(/^<a class="back" href="index\.html">/);
    expect(html.match(/<a href="wcag-em\.html" aria-current="page">/g)).toHaveLength(2);
    expect(html).toContain("<h1>How the pages are chosen: WCAG-EM</h1>");
  });

  it("gives WCAG-EM's five steps in order, each with its parts as WCAG-EM 2 numbers and names them", () => {
    const html = page();
    const steps = /<ol class="em-steps"[^>]*>([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";
    const names = [...steps.matchAll(/<h3><span class="sr">(Step \d): <\/span>([^<]*)<\/h3>/g)].map(
      ([, n, name]) => `${n}: ${name}`,
    );
    expect(names).toEqual([
      "Step 1: Define the evaluation scope",
      "Step 2: Explore the target digital product",
      "Step 3: Select a representative sample set",
      "Step 4: Evaluate the selected sample set",
      "Step 5: Report the evaluation findings",
    ]);
    const parts = [...steps.matchAll(/<li>(\d\.\d) /g)].map(([, n]) => n);
    expect(parts).toEqual([
      "1.1",
      "1.2",
      "1.3",
      "1.4",
      "2.1",
      "2.2",
      "2.3",
      "2.4",
      "2.5",
      "3.1",
      "3.2",
      "3.3",
      "4.1",
      "4.2",
      "4.3",
      "5.1",
      "5.2",
      "5.3",
      "5.4",
      "5.5",
    ]);
    expect(steps).toContain("<li>3.2 Include a randomly selected sample set</li>");
    expect(steps).toContain("<li>4.3 Compare structured and random sample sets</li>");
  });

  it("states the random sample's size as WCAG-EM's own example, in words a screen reader hears, with the bar for the eye", () => {
    const html = page();
    expect(html).toContain(
      "<figcaption>WCAG-EM 2&#39;s own example: a structured sample of 80 pages takes 8 more at random, 10% of 80, for 88 pages in all.</figcaption>",
    );
    expect(html).toContain('<div class="em-bar" aria-hidden="true">');
    expect(html).toContain('<p class="em-legend" aria-hidden="true">');
  });

  it("draws its pictures from HTML: only what's for the eye is hidden, and each picture's meaning is in words", () => {
    const html = page();
    // The template's picture: the grid of pages, three of them read, for the eye; its caption says it.
    const grid = /<div class="em-grid">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(grid.match(/<span/g)).toHaveLength(48);
    expect(grid.match(/class="read"/g)).toHaveLength(3);
    expect(html).toContain('<div class="em-pages" aria-hidden="true">');
    expect(html).toMatch(/<figcaption>A problem in the template, such as a missing heading/);
    // The comparison is a list a screen reader goes through, with the question's two answers in it.
    expect(html).toMatch(
      /<ol class="em-decide"[^>]*>[\s\S]*?Do the random pages show problems[\s\S]*?<p class="em-answer">No<\/p>[\s\S]*?<p class="em-answer">Yes<\/p>/,
    );
    // Marks and arrows are hidden; the words beside them aren't.
    for (const mark of html.match(/<span class="em-mark"[^>]*>/g) ?? []) {
      expect(mark).toContain('aria-hidden="true"');
    }
  });

  it("lists each report that's a sample, with its share of its site as a meter and a link to how its pages were chosen", () => {
    const html = page();
    expect(html).toContain(
      '<meter min="0" max="2466" value="171" aria-label="171 of 2466">171 read, of the 2,466 its sitemap lists</meter>',
    );
    expect(html).toContain(
      '<a href="icjia.illinois.gov/icjia.illinois.gov_2026-11-12.html#sample-h">See how its pages were chosen<span class="sr"> of icjia.illinois.gov</span></a>',
    );
    const none = page([]);
    expect(none).not.toContain("<meter");
    expect(none).toContain(WCAG_EM_TEXT.parts.voicecap.none);
  });

  it("links out only to the W3C and the Department of Justice, and to nothing it loads", () => {
    const html = page();
    const outside = [...mainOf(html).matchAll(/href="(https?:[^"]*)"/g)].map(([, href]) => href);
    expect(outside.length).toBeGreaterThan(0);
    for (const href of outside) expect(href).toMatch(/^https:\/\/www\.(w3\.org|ada\.gov)\//);
    expect(new Set(outside)).toEqual(new Set(Object.values(WCAG_EM_LINKS)));
    expect(html).not.toMatch(/<script\b[^>]*\ssrc=/);
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("keeps its headings in order: one h1, then h2 for each part and h3 under them", () => {
    const levels = [...mainOf(page()).matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level));
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let at = 1; at < levels.length; at++) {
      expect(levels[at]! - levels[at - 1]!, `heading ${at}`).toBeLessThanOrEqual(1);
    }
    // "On this page" links to each part's h2.
    for (const [, id] of mainOf(page()).matchAll(/<li><a href="#([a-z]+)">/g)) {
      expect(page()).toContain(`<h2 id="${id}">`);
    }
  });

  it("never calls voicecap automated, or says a person listened", () => {
    const text = textOf(mainOf(page()));
    expect(text).not.toMatch(/automat/i);
    expect(text).not.toMatch(/listen/i);
  });
});
