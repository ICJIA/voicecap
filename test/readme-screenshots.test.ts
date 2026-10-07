/**
 * The script that makes the README's screenshots (scripts/readme-screenshots.ts): it writes its eight
 * files and no others, no shot may show an IP address or `localhost`, and a shot that would show one
 * stops the script before anything is written. Chromium draws the pages from a temporary home that
 * the script makes from the i2i v3 run of 6 October 2026 (fixture/i2i-v3-run): no screen reader
 * starts, and no person's own transcripts home is read.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  firstRowWithout,
  makeScreenshots,
  refuseLocalAddress,
  SCREENSHOTS,
  shooter,
} from "../scripts/readme-screenshots.js";
import { launchBrowser } from "./helpers/axe.js";

/** The eight files the README names, in the order the script takes them. */
const EIGHT = [
  "report-top.png",
  "report-heard.png",
  "report-attention.png",
  "report-pages.png",
  "report-timeline.png",
  "report-fingerprints.png",
  "website-dark.png",
  "website-light.png",
];

/** The i2i v3 run the shots are made from: a transcripts home with the one site's folder in it. */
const FIXTURE_HOME = fileURLToPath(new URL("../fixture/i2i-v3-run", import.meta.url));
const FIXTURE_SITE = path.join(FIXTURE_HOME, "v3--i2i.netlify.app");
/** The demo runs of 29 September 2026, which read the demo at an IP address and have no canonical one. */
const DEMO_HOME = fileURLToPath(new URL("./fixtures/share/demo-2026-09-29", import.meta.url));

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

/** Every file under `folder` that holds text (the pictures are left out), by its path from there. */
async function textFilesUnder(folder: string, from = folder): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      for (const [name, text] of await textFilesUnder(file, from)) found.set(name, text);
    } else if (!entry.name.endsWith(".jpg")) {
      found.set(path.relative(from, file), await readFile(file, "utf8"));
    }
  }
  return found;
}

describe("the fixture the shots are made from", () => {
  it("is the i2i v3 run of 6 October 2026: 32 pages, each with its screenshot, and its event log", async () => {
    const latest = (await readFile(path.join(FIXTURE_SITE, "latest.txt"), "utf8")).trim();
    expect(latest).toBe("2026-10-06_1134");
    const folder = path.join(FIXTURE_SITE, "2026-10-06", "1134");

    const run = JSON.parse(await readFile(path.join(folder, "run.json"), "utf8")) as {
      id: string;
      status: string;
      site: string;
      canonical: string;
      sessions: { environment: { voicecap: { version: string } } }[];
      pages: { slug: string; status: string; screenshot?: { sha256?: string } }[];
    };
    expect(run).toMatchObject({
      id: latest,
      status: "completed",
      site: "https://v3--i2i.netlify.app",
      canonical: "https://v3--i2i.netlify.app/",
    });
    expect(run.sessions.map((session) => session.environment.voicecap.version)).toEqual(["0.11.0"]);
    expect(run.pages).toHaveLength(32);
    for (const page of run.pages) {
      expect(page.status).toBe("done");
      expect(page.screenshot?.sha256, `${page.slug}'s screenshot`).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(path.join(folder, "pages", page.slug, "screenshot.jpg"))).toBe(true);
    }
    expect(existsSync(path.join(folder, "events.jsonl"))).toBe(true);
  });

  it("holds no path from the computer that ran it, where an account name would show", async () => {
    const files = await textFilesUnder(FIXTURE_HOME);
    // Each page's six transcripts (a TXT and a JSON for each pass), then run.json, events.jsonl,
    // and latest.txt: every file is read, so none is missed.
    expect(files.size).toBe(32 * 6 + 3);
    // A drive letter and a slash ("C:\" or "C:/", but not the "s:/" of "https://"), or a folder a
    // computer keeps accounts in.
    const LOCAL_PATH = /(?<![A-Za-z])[A-Za-z]:[\\/]|\bUsers[\\/]|AppData|\/home\/[a-z]/i;
    const holding = [...files].filter(([, text]) => LOCAL_PATH.test(text)).map(([name]) => name);
    expect(holding).toEqual([]);
  });
});

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
      "Site address https://v3--i2i.netlify.app/",
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

  describe("the row of a grid of cards that has none of a kind", () => {
    /**
     * Six cards, two to a row, 100 px wide and 50 px tall with 10 px between them, from the page's
     * top left corner: the rows are at 0, 60, and 120, and the second ends at 110.
     */
    async function gridOf(cards: string[]) {
      return pageOf(
        `<style>
           body { margin: 0 }
           .grid { display: grid; grid-template-columns: repeat(2, 100px); gap: 10px }
           .card { height: 50px }
         </style>
         <div class="grid">${cards.map((text) => `<article class="card">${text}</article>`).join("")}</div>`,
      );
    }

    it("is the first row without one, with the margin around it, whichever of its cards has one", async () => {
      // The first row's second card is a person's page, so the whole row is passed over.
      const page = await gridOf([
        "/",
        "/biographies/jane-doe/",
        "/contact/",
        "/privacy/",
        "/search/",
        "/biographies/john-roe/",
      ]);

      expect(await firstRowWithout(page, ".card", "/biographies/", 4)).toEqual({
        x: 0,
        y: 56,
        width: 214,
        height: 58,
      });
    });

    it("is the first row when it has none, and stops when every row has one", async () => {
      const first = await gridOf(["/", "/contact/", "/privacy/", "/search/"]);
      expect(await firstRowWithout(first, ".card", "/biographies/", 0)).toEqual({
        x: 0,
        y: 0,
        width: 210,
        height: 50,
      });

      const every = await gridOf(["/biographies/a/", "/b/", "/biographies/c/", "/biographies/d/"]);
      await expect(firstRowWithout(every, ".card", "/biographies/", 4)).rejects.toThrow(
        'Every row of .card has "/biographies/" in it.',
      );
    });
  });
});

describe("makeScreenshots", () => {
  it("names the eight files the README shows, and no screenshot of the flags", () => {
    expect([...SCREENSHOTS]).toEqual(EIGHT);
    expect(SCREENSHOTS).not.toContain("report-flags.png");
  });

  it("writes its eight files and no others, each a PNG, at twice the window's size", async () => {
    const out = path.join(await newFolder(), "screenshots");

    const written = await makeScreenshots(out);

    expect(written.map((file) => path.basename(file))).toEqual(EIGHT);
    expect((await readdir(out)).sort()).toEqual([...EIGHT].sort());
    for (const name of EIGHT) {
      const { width, height } = sizeOf(await readFile(path.join(out, name)));
      // The page and the site are shot the window's width, 1200 pixels, at twice its size; a panel
      // or a section is a little narrower than that, by as much as the page's margins.
      const wide = name === "report-top.png" || name.startsWith("website-");
      if (wide) expect(width).toBe(2400);
      else expect(width).toBeGreaterThan(1600);
      expect(width).toBeLessThanOrEqual(2400);
      expect(height).toBeGreaterThan(300);
    }
  }, 120_000);

  it("writes nothing when its runs have no canonical address to be named by", async () => {
    const out = path.join(await newFolder(), "screenshots");

    // The demo runs read the demo at an IP address and recorded no canonical address, so the only
    // name they have is an IP address: voicecap won't share it (Ruling P13a), so no page is drawn,
    // and no shot is taken. A shot that would show such an address is refused all the same (see
    // "a shot of a page").
    await expect(makeScreenshots(out, DEMO_HOME)).rejects.toThrow(
      /^voicecap won't share a site by an IP address or a local address \(127\.0\.0\.1:4848\)\./,
    );

    expect(existsSync(out)).toBe(false);
  }, 120_000);
});
