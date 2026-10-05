/**
 * The script that makes the README's screenshots (scripts/readme-screenshots.ts): it writes its six
 * files and no others, no shot may show an IP address or `localhost`, and a shot that would show one
 * stops the script before anything is written. Chromium draws the pages from a temporary home that
 * the script makes from the demo runs of 29 September 2026: no screen reader starts, and no
 * person's own transcripts home is read.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeScreenshots,
  refuseLocalAddress,
  SCREENSHOTS,
  shooter,
} from "../scripts/readme-screenshots.js";
import { launchBrowser } from "./helpers/axe.js";

/** Each folder made here, to remove at the end. */
const folders: string[] = [];

async function newFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "voicecap-screenshots-test-"));
  folders.push(folder);
  return folder;
}

afterAll(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
});

/** A PNG's size in pixels, read from its header, after its signature is checked. */
function sizeOf(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("refuseLocalAddress", () => {
  it.each([
    ["an IPv4 address", "Read at http://127.0.0.1:4848/about/.", "127.0.0.1"],
    ["an address on a network", "A copy on 192.168.1.20", "192.168.1.20"],
    ["localhost, in any case", "Heard on LOCALHOST:3000", "LOCALHOST"],
    ["an IPv6 address", "Read at http://[::1]:4848/", "[::1]"],
    ["a longer IPv6 address", "Read at [2001:db8::1]", "[2001:db8::1]"],
  ])("refuses %s, and names the shot and the address", (_kind, text, shown) => {
    expect(() => refuseLocalAddress("report-top.png", text)).toThrow(
      `report-top.png would show "${shown}"`,
    );
  });

  it("lets through a site's name, a browser's version, and a time in brackets", () => {
    for (const text of [
      "voicecap.netlify.app",
      "Site address https://voicecap.netlify.app/demo-site/",
      "Chrome 154.0.8037.58",
      "NVDA 2026.2 on Windows 11 Pro 25H2 (10.0.26200)",
      "[12:30]",
    ]) {
      expect(() => refuseLocalAddress("report-top.png", text)).not.toThrow();
    }
  });
});

describe("a shot of a page", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchBrowser();
  });
  afterAll(async () => {
    await browser.close();
  });

  /** A page of `html` in a window the size of the regions shot here. */
  async function pageOf(html: string) {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(html);
    return page;
  }
  const WHOLE = { x: 0, y: 0, width: 400, height: 300 };

  it("is refused, and written nowhere, when the page draws an address", async () => {
    const into = await newFolder();
    const taken: string[] = [];
    const page = await pageOf("<p>Read at http://127.0.0.1:4848/about/.</p>");

    await expect(shooter(into, taken)(page, "report-top.png", WHOLE)).rejects.toThrow(
      /^report-top\.png would show "127\.0\.0\.1"/,
    );

    expect(await readdir(into)).toEqual([]);
    expect(taken).toEqual([]);
  });

  it("reads what its region draws, and nothing a reader wouldn't see in it", async () => {
    const into = await newFolder();
    const taken: string[] = [];
    // Under the region, in a script, and in a part that is folded: none is drawn in the region.
    const page = await pageOf(
      `<p>Fine.</p>
       <details><summary>More</summary><p>Read at 127.0.0.1</p></details>
       <script>var read = "localhost";</script>
       <div style="height: 2000px"></div><p>Read at localhost</p>`,
    );

    await shooter(into, taken)(page, "report-top.png", WHOLE);

    expect(taken).toEqual(["report-top.png"]);
    expect(await readdir(into)).toEqual(["report-top.png"]);
    // The part under the region is drawn when the region reaches it.
    await expect(
      shooter(into, taken)(page, "report-heard.png", { ...WHOLE, y: 1900, height: 300 }),
    ).rejects.toThrow(/^report-heard\.png would show "localhost"/);
  });
});

describe("makeScreenshots", () => {
  it("writes its six files and no others, each a PNG, at twice the window's size", async () => {
    const out = path.join(await newFolder(), "screenshots");

    const written = await makeScreenshots(out);

    expect(written.map((file) => path.basename(file))).toEqual([...SCREENSHOTS]);
    expect((await readdir(out)).sort()).toEqual([...SCREENSHOTS].sort());
    for (const name of SCREENSHOTS) {
      const { width, height } = sizeOf(await readFile(path.join(out, name)));
      // The page and the site are shot the window's width, 1200 pixels, at twice its size; a panel
      // is a little narrower than that, by as much as the page's margins.
      const wide = name === "report-top.png" || name.startsWith("website-");
      if (wide) expect(width).toBe(2400);
      else expect(width).toBeGreaterThan(1600);
      expect(width).toBeLessThanOrEqual(2400);
      expect(height).toBeGreaterThan(300);
    }
  }, 120_000);

  it("writes nothing when the demo is named by the address its runs read", async () => {
    const out = path.join(await newFolder(), "screenshots");

    // With no canonical address, the page leads with the address voicecap read, which is where the
    // first shot is stopped.
    await expect(makeScreenshots(out, null)).rejects.toThrow(
      /^report-top\.png would show "127\.0\.0\.1"/,
    );

    expect(existsSync(out)).toBe(false);
  }, 120_000);
});
