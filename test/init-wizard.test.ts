import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPrompter, InputEndedError } from "../src/init/prompt.js";
import { runWizard, type WizardDeps, type WizardResult } from "../src/init/wizard.js";
import { InterruptedError } from "../src/passes/steps.js";
import { realSitesFetch } from "./helpers/real-sites.js";

const NOT_WINDOWS =
  "voicecap runs NVDA, which only runs on Windows. Run this command on a Windows computer.";
const NOT_INSTALLED =
  "NVDA for voicecap isn't installed yet. Install it with: npx @icjia/voicecap setup, then run the command above.";
const TIP =
  'Tip: set VOICECAP_TRANSCRIPTS to keep every run in one place. See "The audit record" in the README.';

const DVFR_SITEMAP_COMMAND =
  "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml";
/** What every command ends with when the reviewer's question gets Enter. */
const R = " --reviewer icjia";
const REVIEWER_QUESTION = "Reviewer, recorded with the run";
const REVIEWER_TIP = "Tip: set VOICECAP_REVIEWER to make your own name the default.";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "voicecap-wizard-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/**
 * Run the wizard, typing the next scripted answer ("" is Enter) each time a question is shown, and
 * return its result and the screen: everything it printed, with each answer after its question as
 * a terminal echoes it. A question with no answer left ends the input (so the session rejects with
 * InputEndedError), and an answer never asked for fails the session. The reviewer's question gets
 * `reviewer` (Enter, by default) instead, so the other tests' answers leave it out.
 */
async function session(
  answers: readonly string[],
  deps: Partial<Omit<WizardDeps, "prompter">> = {},
  reviewer = "",
): Promise<{ result: WizardResult; screen: string }> {
  const input = new PassThrough();
  const left = [...answers];
  let screen = "";
  const output = {
    write(chunk: string) {
      screen += chunk;
      // A question is one write that leaves its line open; say() always ends the line.
      if (!chunk.endsWith("\n")) {
        const answer = chunk.startsWith(REVIEWER_QUESTION) ? reviewer : left.shift();
        if (answer === undefined) {
          input.end();
        } else {
          screen += `${answer}\n`;
          input.write(`${answer}\n`);
        }
      }
      return true;
    },
  };
  const prompter = createPrompter({ input, output });
  try {
    const result = await runWizard({
      prompter,
      fetch: realSitesFetch(),
      cwd: tmp,
      env: {},
      // Late in the day, local time: west of Greenwich, the UTC date is already the 28th.
      now: () => new Date(2026, 8, 27, 23, 30),
      readiness: () => ({ canRun: true, screenReader: "NVDA" }),
      ...deps,
    });
    if (left.length > 0) throw new Error(`Never asked for: ${JSON.stringify(left)}`);
    return { result, screen };
  } finally {
    prompter.close();
    if (!input.writableEnded) input.end();
  }
}

describe("runWizard", () => {
  it("composes the i2i example from mostly Enter", async () => {
    const home = path.join(tmp, "voicecap-transcripts");
    const { result, screen } = await session(["i2i.illinois.gov", "", "5", "", ""], {
      env: { VOICECAP_TRANSCRIPTS: home },
    });

    const command =
      "npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-index.xml --limit 5 --reviewer icjia";
    expect(result).toEqual({
      args: [
        "--site",
        "https://i2i.illinois.gov",
        "--sitemap",
        "https://i2i.illinois.gov/sitemap-index.xml",
        "--limit",
        "5",
        "--reviewer",
        "icjia",
      ],
      command,
      run: false,
    });
    const runFolder = `${path.join(home, "i2i.illinois.gov", "2026-09-27")}${path.sep}`;
    // What someone sees, line for line: the spec's example, with both of i2i's sitemaps offered
    // (its robots.txt names sitemap-index.xml, and it serves /sitemap.xml too).
    expect(screen).toBe(
      [
        "",
        "Website: i2i.illinois.gov",
        "Checking https://i2i.illinois.gov…",
        "  → https://i2i.illinois.gov (it answers)",
        "Looking for the site's sitemap…",
        "Where are the pages?",
        "  1. The site's sitemap, listed in robots.txt: https://i2i.illinois.gov/sitemap-index.xml",
        "  2. The site's sitemap at /sitemap.xml: https://i2i.illinois.gov/sitemap.xml",
        "  3. A sitemap at another address",
        "  4. A page list file (.csv or .json)",
        "  5. One page",
        "Choose [1]: ",
        "How many pages? A number, or Enter for all [all]: 5",
        `Transcripts home [${home}]: `,
        `  → this run goes into ${runFolder}`,
        "Reviewer, recorded with the run [icjia]: ",
        REVIEWER_TIP,
        "",
        "Your command:",
        `  ${command}`,
        "Run the same command again later to resume where it stopped.",
        "",
        "NVDA will speak and take over the keyboard until the run ends.",
        "Run it now? [y/N]: ",
        "",
      ].join("\n"),
    );
  });

  it("uses the origin a site redirects to, and says so", async () => {
    const { result, screen } = await session(["http://dvfr.illinois.gov", "", "", "", ""]);

    expect(screen).toContain(
      "Website: http://dvfr.illinois.gov\n" +
        "Checking http://dvfr.illinois.gov…\n" +
        "  → https://dvfr.illinois.gov (http://dvfr.illinois.gov redirects there)\n",
    );
    expect(result.command).toBe(DVFR_SITEMAP_COMMAND + R);
  });

  it("asks again for a website that isn't an address", async () => {
    const hint =
      "Enter the site's address, such as dvfr.illinois.gov or https://dvfr.illinois.gov.";
    const { result, screen } = await session([
      "",
      "ftp://dvfr.illinois.gov",
      "dvfr.illinois.gov",
      "",
      "",
      "",
      "",
    ]);

    expect(screen).toContain(
      `Website: \n${hint}\n` +
        `Website: ftp://dvfr.illinois.gov\n${hint}\n` +
        "Website: dvfr.illinois.gov\n",
    );
    expect(result.command).toBe(DVFR_SITEMAP_COMMAND + R);
  });

  it("asks about a site that doesn't answer", async () => {
    const fetch = realSitesFetch({
      "https://i2i.illinois.gov/": () => new Response("Forbidden", { status: 403 }),
    });

    const no = await session(["i2i.illinois.gov", "n", "dvfr.illinois.gov", "", "", "", ""], {
      fetch,
    });
    // Each check is announced, including the one after the website is asked again.
    expect(no.screen).toContain(
      "Website: i2i.illinois.gov\n" +
        "Checking https://i2i.illinois.gov…\n" +
        "  → https://i2i.illinois.gov doesn't answer (HTTP 403).\n" +
        "Use it anyway? [y/N]: n\n" +
        "Website: dvfr.illinois.gov\n" +
        "Checking https://dvfr.illinois.gov…\n" +
        "  → https://dvfr.illinois.gov (it answers)\n",
    );
    expect(no.result.command).toBe(DVFR_SITEMAP_COMMAND + R);

    const yes = await session(["i2i.illinois.gov", "y", "", "", "", ""], { fetch });
    expect(yes.screen).toContain(
      "Use it anyway? [y/N]: y\nLooking for the site's sitemap…\nWhere are the pages?\n",
    );
    expect(yes.result.command).toBe(
      "npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-index.xml" +
        R,
    );
  });

  it("offers one page, with the home page as the default, when no sitemap is found", async () => {
    const notFound = () => new Response("Not found", { status: 404 });
    const fetch = realSitesFetch({
      "https://i2i.illinois.gov/robots.txt": notFound,
      "https://i2i.illinois.gov/sitemap-index.xml": notFound,
      "https://i2i.illinois.gov/sitemap.xml": notFound,
    });
    const { result, screen } = await session(["i2i.illinois.gov", "", "", "", ""], { fetch });

    expect(screen).toContain(
      "Where are the pages?\n" +
        "  1. A sitemap at another address\n" +
        "  2. A page list file (.csv or .json)\n" +
        "  3. One page\n" +
        "Choose [3]: \n" +
        "Page (a full URL, or a path like /faq/) [https://i2i.illinois.gov/]: \n" +
        "Transcripts home [transcripts]: \n",
    );
    expect(result.command).toBe(
      "npx @icjia/voicecap --site https://i2i.illinois.gov --page https://i2i.illinois.gov/" + R,
    );
  });

  it("takes the site's other sitemap, with the rest of the choices one further down", async () => {
    const second = await session(["i2i.illinois.gov", "2", "", "", ""]);
    expect(second.result.command).toBe(
      "npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap.xml" +
        R,
    );

    const another = await session(["i2i.illinois.gov", "3", "sitemap-0.xml", "y", "", "", ""]);
    expect(another.screen).toContain(
      "Choose [1]: 3\n" +
        "Sitemap (a full URL, or a name like sitemap.xml): sitemap-0.xml\n" +
        "  → https://i2i.illinois.gov/sitemap-0.xml: HTTP 404.\n",
    );
    expect(another.result.command).toBe(
      "npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-0.xml" +
        R,
    );
  });

  it("keeps today's menu for a site with one sitemap", async () => {
    // dvfr.illinois.gov's robots.txt names /sitemap.xml itself, so it's one sitemap, not two.
    const listed = await session(["dvfr.illinois.gov", "", "", "", ""]);
    // Without a robots.txt, /sitemap.xml is found on its own.
    const alone = await session(["dvfr.illinois.gov", "", "", "", ""], {
      fetch: realSitesFetch({
        "https://dvfr.illinois.gov/robots.txt": () => new Response("Not found", { status: 404 }),
      }),
    });

    for (const { result, screen } of [listed, alone]) {
      expect(screen).toContain(
        "Looking for the site's sitemap…\n" +
          "Where are the pages?\n" +
          "  1. The site's sitemap: https://dvfr.illinois.gov/sitemap.xml\n" +
          "  2. A sitemap at another address\n" +
          "  3. A page list file (.csv or .json)\n" +
          "  4. One page\n" +
          "Choose [1]: \n",
      );
      expect(result.command).toBe(DVFR_SITEMAP_COMMAND + R);
    }
  });

  it("reads a sitemap's name or path, at another address, against the site", async () => {
    for (const answer of ["sitemap.xml", "/sitemap.xml"]) {
      const { result, screen } = await session(["dvfr.illinois.gov", "2", answer, "", "", ""]);
      expect(screen).toContain(
        `Sitemap (a full URL, or a name like sitemap.xml): ${answer}\nHow many pages? A number, or Enter for all [all]: \n`,
      );
      // The command has the full URL, which is unambiguous and safe to copy.
      expect(result.command).toBe(DVFR_SITEMAP_COMMAND + R);
    }

    const fetch = realSitesFetch({
      "https://dvfr.illinois.gov/sitemaps/pages.xml": () =>
        new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 }),
    });
    const nested = await session(["dvfr.illinois.gov", "2", "sitemaps/pages.xml", "", "", ""], {
      fetch,
    });
    expect(nested.result.command).toBe(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemaps/pages.xml" +
        R,
    );

    // A name that isn't there is checked as its full URL, which the explanation shows.
    const missing = await session([
      "dvfr.illinois.gov",
      "2",
      "sitemap-index.xml",
      "n",
      "sitemap.xml",
      "",
      "",
      "",
    ]);
    expect(missing.screen).toContain(
      "Sitemap (a full URL, or a name like sitemap.xml): sitemap-index.xml\n" +
        "  → https://dvfr.illinois.gov/sitemap-index.xml: HTTP 404.\n" +
        "Use it anyway? [y/N]: n\n" +
        "Sitemap (a full URL, or a name like sitemap.xml): sitemap.xml\n",
    );
    expect(missing.result.command).toBe(DVFR_SITEMAP_COMMAND + R);
  });

  it("writes a page given as a path as a full URL, and asks again for one off the site", async () => {
    const { result, screen } = await session([
      "dvfr.illinois.gov",
      "4",
      "https://i2i.illinois.gov/",
      "/faq/",
      "",
      "",
    ]);

    expect(screen).toContain(
      "Page (a full URL, or a path like /faq/) [https://dvfr.illinois.gov/]: https://i2i.illinois.gov/\n" +
        "Enter a page on https://dvfr.illinois.gov: a full URL, or a path like /faq/.\n" +
        "Page (a full URL, or a path like /faq/) [https://dvfr.illinois.gov/]: /faq/\n" +
        "Transcripts home [transcripts]: \n",
    );
    expect(result.command).toBe(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --page https://dvfr.illinois.gov/faq/" +
        R,
    );
  });

  it("says what to change for cmd when the command has a value in single quotes", async () => {
    const { result, screen } = await session(["dvfr.illinois.gov", "4", "/faq/?a=1&b=2", "", ""], {
      env: { VOICECAP_TRANSCRIPTS: path.join(tmp, "vt") },
    });

    const command =
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --page 'https://dvfr.illinois.gov/faq/?a=1&b=2' --reviewer icjia";
    expect(result.command).toBe(command);
    // cmd doesn't take single quotes as quotes: pasted as is, the command would end at the &.
    expect(screen).toContain(
      "Your command:\n" +
        `  ${command}\n` +
        "In cmd, use double quotes instead of single quotes.\n" +
        "Run the same command again later to resume where it stopped.\n" +
        "\n",
    );
  });

  it("takes a page list, and says how many pages it has", async () => {
    await mkdir(path.join(tmp, "lists"));
    await writeFile(
      path.join(tmp, "lists", "dvfr pages.csv"),
      "url\nhttps://dvfr.illinois.gov/about/\n/faq/\n",
    );
    const { result, screen } = await session([
      "dvfr.illinois.gov",
      "3",
      "missing.csv",
      "lists/dvfr pages.csv",
      "",
      "",
      "",
    ]);

    expect(screen).toContain(
      "Page list file (.csv or .json): missing.csv\n" +
        "There's no file at missing.csv.\n" +
        "Page list file (.csv or .json): lists/dvfr pages.csv\n" +
        "  → 2 pages listed\n" +
        "How many pages? A number, or Enter for all [all]: \n",
    );
    expect(result.command).toBe(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --pages 'lists/dvfr pages.csv'" + R,
    );
  });

  it("takes a page list path in quotes, as Windows' Copy as path gives it", async () => {
    await mkdir(path.join(tmp, "lists"));
    await writeFile(
      path.join(tmp, "lists", "dvfr pages.csv"),
      "url\nhttps://dvfr.illinois.gov/about/\n/faq/\n",
    );
    const { result, screen } = await session([
      "dvfr.illinois.gov",
      "3",
      '"lists/dvfr pages.csv"',
      "",
      "",
      "",
    ]);

    expect(screen).toContain(
      'Page list file (.csv or .json): "lists/dvfr pages.csv"\n  → 2 pages listed\n',
    );
    expect(result.command).toBe(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --pages 'lists/dvfr pages.csv'" + R,
    );
  });

  it("explains a page list it can't use", async () => {
    await writeFile(path.join(tmp, "notes.txt"), "https://dvfr.illinois.gov/faq/\n");
    await writeFile(path.join(tmp, "no-url.csv"), "page\nhttps://dvfr.illinois.gov/faq/\n");
    await writeFile(path.join(tmp, "faq.json"), '["/faq/"]\n');
    const { result, screen } = await session([
      "dvfr.illinois.gov",
      "3",
      "notes.txt",
      "no-url.csv",
      "faq.json",
      "",
      "",
      "",
    ]);

    // The last list has one page, said in the singular.
    expect(screen).toContain(
      "Page list file (.csv or .json): notes.txt\n" +
        "A page list is a .csv or .json file.\n" +
        "Page list file (.csv or .json): no-url.csv\n" +
        'no-url.csv has no "url" column. The first row must be a header such as: url,label,template,notes\n' +
        "Page list file (.csv or .json): faq.json\n" +
        "  → 1 page listed\n",
    );
    expect(result.command).toBe(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --pages faq.json" + R,
    );
  });

  it("checks a sitemap at another address", async () => {
    const no = await session([
      "dvfr.illinois.gov",
      "2",
      "https://dvfr.illinois.gov/",
      "n",
      "https://dvfr.illinois.gov/sitemap.xml",
      "",
      "",
      "",
    ]);
    expect(no.screen).toContain(
      "Sitemap (a full URL, or a name like sitemap.xml): https://dvfr.illinois.gov/\n" +
        "  → https://dvfr.illinois.gov/: not a sitemap (no <urlset> or <sitemapindex>).\n" +
        "Use it anyway? [y/N]: n\n" +
        "Sitemap (a full URL, or a name like sitemap.xml): https://dvfr.illinois.gov/sitemap.xml\n" +
        "How many pages? A number, or Enter for all [all]: \n",
    );
    expect(no.result.command).toBe(DVFR_SITEMAP_COMMAND + R);

    const yes = await session([
      "dvfr.illinois.gov",
      "2",
      "https://dvfr.illinois.gov/sitemap-0.xml",
      "y",
      "",
      "",
      "",
    ]);
    expect(yes.screen).toContain(
      "  → https://dvfr.illinois.gov/sitemap-0.xml: HTTP 404.\nUse it anyway? [y/N]: y\n",
    );
    expect(yes.result.command).toBe(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap-0.xml" +
        R,
    );
  });

  it("asks again for a sitemap address that isn't an http(s) URL", async () => {
    const hint =
      "Enter a full URL, such as https://dvfr.illinois.gov/sitemap.xml, or a name or path on the site, such as sitemap.xml.";
    const { result, screen } = await session([
      "dvfr.illinois.gov",
      "2",
      "not a url",
      "ftp://dvfr.illinois.gov/sitemap.xml",
      "https://dvfr.illinois.gov/sitemap.xml",
      "",
      "",
      "",
    ]);

    expect(screen).toContain(
      `Sitemap (a full URL, or a name like sitemap.xml): not a url\n${hint}\n` +
        `Sitemap (a full URL, or a name like sitemap.xml): ftp://dvfr.illinois.gov/sitemap.xml\n${hint}\n` +
        "Sitemap (a full URL, or a name like sitemap.xml): https://dvfr.illinois.gov/sitemap.xml\n",
    );
    expect(result.command).toBe(DVFR_SITEMAP_COMMAND + R);
  });

  it("adds https:// to a sitemap address without a scheme, as for the website", async () => {
    // --sitemap refuses this form, which it would read as a path on the site; typed here, it's
    // taken as the address it looks like, as the website's answer is.
    const plain = await session([
      "dvfr.illinois.gov",
      "2",
      "dvfr.illinois.gov/sitemap.xml",
      "",
      "",
      "",
    ]);
    expect(plain.screen).toContain(
      "Sitemap (a full URL, or a name like sitemap.xml): dvfr.illinois.gov/sitemap.xml\n" +
        "How many pages? A number, or Enter for all [all]: \n",
    );
    expect(plain.result.command).toBe(DVFR_SITEMAP_COMMAND + R);

    // A host:port address has no scheme either.
    const fetch = realSitesFetch({
      "https://localhost:3000/sitemap.xml": () =>
        new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 }),
    });
    const withPort = await session(
      ["dvfr.illinois.gov", "2", "localhost:3000/sitemap.xml", "", "", ""],
      { fetch },
    );
    expect(withPort.result.command).toBe(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://localhost:3000/sitemap.xml" +
        R,
    );
  });

  it("asks again for a page count that isn't a whole number", async () => {
    const hint = "Enter a whole number of at least 1, or press Enter for all.";
    const { result, screen } = await session(["dvfr.illinois.gov", "", "0", "2.5", "5", "", ""]);

    expect(screen).toContain(
      `How many pages? A number, or Enter for all [all]: 0\n${hint}\n` +
        `How many pages? A number, or Enter for all [all]: 2.5\n${hint}\n` +
        "How many pages? A number, or Enter for all [all]: 5\n",
    );
    expect(result.command).toBe(`${DVFR_SITEMAP_COMMAND} --limit 5${R}`);
  });

  it("takes all, as Enter does, for every page", async () => {
    const { result } = await session(["dvfr.illinois.gov", "", "All", "", ""]);

    expect(result.command).toBe(DVFR_SITEMAP_COMMAND + R);
  });

  it("writes --out only for a home other than the one in effect", async () => {
    const dvfr = ["dvfr.illinois.gov", "", ""];

    const inEffect = await session([...dvfr, "", ""]);
    expect(inEffect.result.command).toBe(DVFR_SITEMAP_COMMAND + R);
    expect(inEffect.screen).toContain(
      "Transcripts home [transcripts]: \n" +
        `  → this run goes into ${path.join(tmp, "transcripts", "dvfr.illinois.gov", "2026-09-27")}${path.sep}\n` +
        `${TIP}\n`,
    );

    const typed = await session([...dvfr, "C:\\vt", ""]);
    expect(typed.result.command).toBe(`${DVFR_SITEMAP_COMMAND} --out 'C:\\vt'${R}`);

    const sameHome = await session([...dvfr, "./transcripts/", ""]);
    expect(sameHome.result.command).toBe(DVFR_SITEMAP_COMMAND + R);
  });

  it("takes a home in one pair of matching quotes without them", async () => {
    const dvfr = ["dvfr.illinois.gov", "", ""];

    for (const answer of ['"C:\\vt"', "'C:\\vt'"]) {
      const { result, screen } = await session([...dvfr, answer, ""]);
      expect(result.command).toBe(`${DVFR_SITEMAP_COMMAND} --out 'C:\\vt'${R}`);
      const runFolder = path.join(path.resolve(tmp, "C:\\vt"), "dvfr.illinois.gov", "2026-09-27");
      expect(screen).toContain(`  → this run goes into ${runFolder}${path.sep}\n`);
    }

    // Without its quotes, this is the home in effect.
    const inEffect = await session([...dvfr, '"transcripts"', ""]);
    expect(inEffect.result.command).toBe(DVFR_SITEMAP_COMMAND + R);

    // Quotes that don't match stay.
    const unmatched = await session([...dvfr, "\"C:\\vt'", ""]);
    expect(unmatched.result.args.slice(-4, -2)).toEqual(["--out", "\"C:\\vt'"]);
  });

  it("says which folder to run it from when the command has a relative path", async () => {
    const resumeLine = "Run the same command again later to resume where it stopped.\n";
    const folderLine = `Run it from this folder: ${tmp}\n`;
    const absoluteHome = path.join(tmp, "home");
    await writeFile(path.join(tmp, "faq.json"), '["/faq/"]\n');

    // The default home, transcripts, when VOICECAP_TRANSCRIPTS isn't set.
    const byDefault = await session(["dvfr.illinois.gov", "", "", "", ""]);
    expect(byDefault.screen).toContain(
      `  ${DVFR_SITEMAP_COMMAND}${R}\n${resumeLine}${folderLine}\n`,
    );

    // A relative VOICECAP_TRANSCRIPTS.
    const relativeEnv = await session(["dvfr.illinois.gov", "", "", "", ""], {
      env: { VOICECAP_TRANSCRIPTS: "records" },
    });
    expect(relativeEnv.screen).toContain(
      `  ${DVFR_SITEMAP_COMMAND}${R}\n${resumeLine}${folderLine}\n`,
    );

    // A relative --out, though the home in effect is absolute.
    const relativeOut = await session(["dvfr.illinois.gov", "", "", "vt", ""], {
      env: { VOICECAP_TRANSCRIPTS: absoluteHome },
    });
    expect(relativeOut.screen).toContain(
      `  ${DVFR_SITEMAP_COMMAND} --out vt${R}\n${resumeLine}${folderLine}\n`,
    );

    // A page list given as a relative path, though the home is absolute.
    const relativeList = await session(["dvfr.illinois.gov", "3", "faq.json", "", "", ""], {
      env: { VOICECAP_TRANSCRIPTS: absoluteHome },
    });
    expect(relativeList.screen).toContain(
      "  npx @icjia/voicecap --site https://dvfr.illinois.gov --pages faq.json --reviewer icjia\n" +
        `${resumeLine}${folderLine}\n`,
    );
  });

  it("doesn't say which folder to run it from when every path in the command is absolute", async () => {
    const absoluteHome = path.join(tmp, "home");
    await writeFile(path.join(tmp, "faq.json"), '["/faq/"]\n');

    // An absolute VOICECAP_TRANSCRIPTS as the home in effect.
    const absoluteEnv = await session(["dvfr.illinois.gov", "", "", "", ""], {
      env: { VOICECAP_TRANSCRIPTS: absoluteHome },
    });
    // An absolute --out, though the home in effect is the relative transcripts.
    const absoluteOut = await session(["dvfr.illinois.gov", "", "", absoluteHome, ""]);
    // A page list given as an absolute path.
    const absoluteList = await session(
      ["dvfr.illinois.gov", "3", path.join(tmp, "faq.json"), "", "", ""],
      { env: { VOICECAP_TRANSCRIPTS: absoluteHome } },
    );

    for (const { screen } of [absoluteEnv, absoluteOut, absoluteList]) {
      expect(screen).toContain(
        "Run the same command again later to resume where it stopped.\n\nNVDA will speak",
      );
      expect(screen).not.toContain("Run it from this folder:");
    }
  });

  it("puts the cmd line right under the command, and the folder line after the resume line", async () => {
    await mkdir(path.join(tmp, "lists"));
    await writeFile(path.join(tmp, "lists", "dvfr pages.csv"), "url\n/faq/\n");
    const { screen } = await session([
      "dvfr.illinois.gov",
      "3",
      "lists/dvfr pages.csv",
      "",
      "",
      "",
    ]);

    expect(screen.slice(screen.indexOf("Your command:"))).toBe(
      "Your command:\n" +
        "  npx @icjia/voicecap --site https://dvfr.illinois.gov --pages 'lists/dvfr pages.csv' --reviewer icjia\n" +
        "In cmd, use double quotes instead of single quotes.\n" +
        "Run the same command again later to resume where it stopped.\n" +
        `Run it from this folder: ${tmp}\n` +
        "\n" +
        "NVDA will speak and take over the keyboard until the run ends.\n" +
        "Run it now? [y/N]: \n",
    );
  });

  it.runIf(process.platform === "win32")("reads a Git Bash home as a Windows path", async () => {
    const { result } = await session(["dvfr.illinois.gov", "", "", "/c/vt", ""], {
      platform: "win32",
    });
    expect(result.command).toBe(`${DVFR_SITEMAP_COMMAND} --out C:/vt${R}`);
  });

  it.runIf(process.platform === "win32")("compares homes without regard to case", async () => {
    const { result } = await session(["dvfr.illinois.gov", "", "", "c:\\VT", ""], {
      platform: "win32",
      env: { VOICECAP_TRANSCRIPTS: "C:\\vt" },
    });
    expect(result.command).toBe(DVFR_SITEMAP_COMMAND + R);
  });

  it("leaves /c/vt alone off Windows", async () => {
    const { result } = await session(["dvfr.illinois.gov", "", "", "/c/vt", ""], {
      platform: "linux",
    });
    expect(result.command).toBe(`${DVFR_SITEMAP_COMMAND} --out /c/vt${R}`);
  });

  it("doesn't offer to run where it can't", async () => {
    for (const reason of [NOT_WINDOWS, NOT_INSTALLED]) {
      const { result, screen } = await session(["dvfr.illinois.gov", "", "", ""], {
        readiness: () => ({ canRun: false, reason }),
      });

      // The home is the default transcripts, relative to this folder.
      expect(screen.slice(screen.indexOf("Your command:"))).toBe(
        "Your command:\n" +
          `  ${DVFR_SITEMAP_COMMAND}${R}\n` +
          "Run the same command again later to resume where it stopped.\n" +
          `Run it from this folder: ${tmp}\n` +
          "\n" +
          `${reason}\n`,
      );
      expect(result.run).toBe(false);
    }
  });

  it("asks for the reviewer after the home, with icjia as the quick default, and puts it last", async () => {
    const { result, screen } = await session(["dvfr.illinois.gov", "", "", "", ""]);

    expect(screen).toContain(
      `Transcripts home [transcripts]: \n  → this run goes into ${path.join(tmp, "transcripts", "dvfr.illinois.gov", "2026-09-27")}${path.sep}\n${TIP}\n` +
        `Reviewer, recorded with the run [icjia]: \n${REVIEWER_TIP}\n\nYour command:\n`,
    );
    expect(result.args.slice(-2)).toEqual(["--reviewer", "icjia"]);
  });

  it("takes a person's name instead of the quick default", async () => {
    const { result, screen } = await session(["dvfr.illinois.gov", "", "", "", ""], {}, "Jane Doe");

    expect(screen).toContain("Reviewer, recorded with the run [icjia]: Jane Doe\n");
    expect(result.command).toBe(`${DVFR_SITEMAP_COMMAND} --reviewer 'Jane Doe'`);
  });

  it("offers VOICECAP_REVIEWER as the default, with no tip", async () => {
    const { result, screen } = await session(["dvfr.illinois.gov", "", "", "", ""], {
      env: { VOICECAP_REVIEWER: " cschweda " },
    });

    expect(screen).toContain("Reviewer, recorded with the run [cschweda]: \n\nYour command:");
    expect(screen).not.toContain(REVIEWER_TIP);
    expect(result.command).toBe(`${DVFR_SITEMAP_COMMAND} --reviewer cschweda`);
  });

  it("runs only after a yes", async () => {
    const yes = await session(["dvfr.illinois.gov", "", "", "", "y"]);
    expect(yes.screen).toContain(
      "\nNVDA will speak and take over the keyboard until the run ends.\nRun it now? [y/N]: y\n",
    );
    expect(yes.result.run).toBe(true);

    const enter = await session(["dvfr.illinois.gov", "", "", "", ""]);
    expect(enter.result.run).toBe(false);
  });

  it("stops when the answers stop coming", async () => {
    await expect(session(["dvfr.illinois.gov", "", "5"])).rejects.toThrow(InputEndedError);
  });

  it("stops at once on Ctrl+C during the site check", async () => {
    const controller = new AbortController();
    // Waits for its own request signal to abort, then aborts it the moment it's asked to wait.
    const waitsForAbort: typeof fetch = (_input, init) => {
      const pending = new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason as Error));
      });
      controller.abort();
      return pending;
    };

    await expect(
      session(["i2i.illinois.gov"], { fetch: waitsForAbort, signal: controller.signal }),
    ).rejects.toThrow(InterruptedError);
  });
});
