/**
 * axe-core in real Chromium (contrast needs rendering), for the accessibility tests of the report
 * and of the demo site: the browser, and axe's findings as readable lines.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright";

import { errorMessage } from "../../src/util/errors.js";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Playwright's Chromium, or else the installed Chrome. `args` are command-line switches for the
 * browser, such as `--blink-settings=defaultFontSize=32`, which sets the text size a page starts from.
 */
export async function launchBrowser(args: string[] = []): Promise<Browser> {
  try {
    return await chromium.launch({ args });
  } catch (bundled) {
    try {
      return await chromium.launch({ channel: "chrome", args });
    } catch {
      throw new Error(
        `No browser for the accessibility tests. Run pnpm exec playwright install chromium (${errorMessage(bundled)})`,
      );
    }
  }
}

/**
 * The words of a chart of a run's event log on the shareable page (src/share/html/timeline.ts): text
 * drawn in an SVG. axe finds no background for text in an SVG (the SVG is an image to it), so it
 * leaves their contrast for a person to check, every time. The page's tests measure it themselves
 * instead (chartContrasts in test/share-browser.test.ts), in both themes.
 */
const CHART_TEXT = /^<text\b[^>]*\bclass="t-(?:axis|lane|in|note|fail)"/;

/**
 * axe violations as readable lines ("<rule id>: <help> — <nodes>"), so a failure says what to fix.
 * Color-contrast checks axe couldn't complete count too: every text node's contrast must actually
 * be verified. The words of an event log's chart are verified by measuring them (CHART_TEXT).
 */
export async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const unverified = results.incomplete
    .filter((result) => result.id === "color-contrast")
    .map((result) => ({
      ...result,
      nodes: result.nodes.filter((node) => !CHART_TEXT.test(node.html)),
    }))
    .filter((result) => result.nodes.length > 0);
  return [...results.violations, ...unverified].map(
    (violation) =>
      `${violation.id}: ${violation.help} — ${violation.nodes
        .slice(0, 3)
        .map((node) => `${node.target.join(" ")} ${node.failureSummary ?? ""}`)
        .join(" | ")}`,
  );
}

/**
 * What axe says of links that read alike: links with one name that go to different places, which a
 * person going by the links alone (Tab, or a list of links) can't tell apart (WCAG 2.4.9). axe can't
 * say whether such links serve one purpose, so it leaves them for a person to review: here they
 * count, as a page with none has nothing to review. One line for each rule.
 */
export async function identicalLinks(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withRules(["identical-links-same-purpose"])
    .analyze();
  return [...results.violations, ...results.incomplete].map(
    (result) =>
      `${result.id}: ${result.help} — ${result.nodes
        .slice(0, 3)
        .map((node) => node.html.slice(0, 120))
        .join(" | ")}`,
  );
}
