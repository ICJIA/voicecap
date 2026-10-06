/**
 * Where a page's footer sits in its window, for the tests that a footer stays at the window's
 * bottom when the page is shorter than the window, and after the content when it isn't.
 */
import type { Page } from "playwright";

export interface FooterPlacement {
  /** Whether the document is taller than the window. */
  scrolls: boolean;
  /**
   * The distance, in CSS pixels, from the footer's bottom edge to the document's bottom edge. A
   * document shorter than the window ends at the window's bottom.
   */
  gapBelow: number;
}

/** Where the footer is now. `footer` is a selector: the run report's is ".page-footer". */
export function footerPlacement(page: Page, footer = "footer"): Promise<FooterPlacement> {
  return page.evaluate((selector) => {
    const root = document.documentElement;
    const box = document.querySelector(selector)?.getBoundingClientRect();
    if (box === undefined) throw new Error(`The page has no ${selector}.`);
    return {
      scrolls: root.scrollHeight > root.clientHeight,
      gapBelow: root.scrollHeight - (box.bottom + window.scrollY),
    };
  }, footer);
}

/**
 * The footer's placement in a window 1280 x 800 (`long`), and then in one 400 pixels taller than
 * the document was in that window (`short`): a window the page doesn't fill. A footer that sits at
 * the window's bottom when the page is short is as far from the document's bottom edge in both. The
 * page's fonts are loaded first, so the layout is the final one.
 */
export async function footerInTwoWindows(
  page: Page,
  footer = "footer",
): Promise<{ long: FooterPlacement; short: FooterPlacement }> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((face) => face.load()));
  });
  const long = await footerPlacement(page, footer);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height: height + 400 });
  return { long, short: await footerPlacement(page, footer) };
}
