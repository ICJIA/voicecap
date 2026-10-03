/**
 * axe-core in real Chromium (contrast needs rendering), for the accessibility tests of the report
 * and of the demo site: the browser, and axe's findings as readable lines.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright";

import { errorMessage } from "../../src/util/errors.js";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** Playwright's Chromium, or else the installed Chrome. */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (bundled) {
    try {
      return await chromium.launch({ channel: "chrome" });
    } catch {
      throw new Error(
        `No browser for the accessibility tests. Run pnpm exec playwright install chromium (${errorMessage(bundled)})`,
      );
    }
  }
}

/**
 * axe violations as readable lines ("<rule id>: <help> — <nodes>"), so a failure says what to fix.
 * Color-contrast checks axe couldn't complete count too: every text node's contrast must actually
 * be verified.
 */
export async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const unverified = results.incomplete.filter((result) => result.id === "color-contrast");
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
