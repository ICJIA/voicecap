import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runJsonPath, siteDirFor } from "../src/run/paths.js";
import { chooseSiteDir } from "../src/run/site-dir.js";
import { UsageError } from "../src/util/errors.js";
import { shareRun } from "./helpers/share-data.js";

/** A home named like the owner's, holding these folders, each with a dated folder in it. */
async function makeHome(...folders: string[]): Promise<string> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "voicecap-home-"));
  const home = path.join(tmp, "voicecap-transcripts");
  await mkdir(home);
  for (const folder of folders) {
    await mkdir(path.join(home, folder, "2026-09-27"), { recursive: true });
  }
  return home;
}

/** The usage error chooseSiteDir stops with. */
async function refusal(options: Parameters<typeof chooseSiteDir>[0]): Promise<UsageError> {
  const error: unknown = await chooseSiteDir(options).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UsageError);
  return error as UsageError;
}

describe("chooseSiteDir", () => {
  it("uses --site first", async () => {
    const home = await makeHome("dvfr.illinois.gov", "i2i.illinois.gov");
    expect(
      await chooseSiteDir({
        home,
        site: "https://i2i.illinois.gov",
        page: "https://dvfr.illinois.gov/faq/",
      }),
    ).toBe(path.join(home, "i2i.illinois.gov"));
    expect((await refusal({ home, site: "i2i.illinois.gov" })).message).toMatch(
      /--site must be a full URL/,
    );
  });

  it("takes the site from a full page URL", async () => {
    const home = await makeHome("i2i.illinois.gov");
    expect(await chooseSiteDir({ home, page: "https://dvfr.illinois.gov/faq/" })).toBe(
      path.join(home, "dvfr.illinois.gov"),
    );
    expect((await refusal({ home, page: "https://" })).message).toBe(
      `--page "https://" isn't a page URL or a path like /about.`,
    );
    // Anything with a scheme is a full URL, as a page resolves: "https:/" a slash short is one,
    // and one that isn't http or https is no page at all, rather than a path on the only site.
    expect(await chooseSiteDir({ home, page: "https:/dvfr.illinois.gov/faq/" })).toBe(
      path.join(home, "dvfr.illinois.gov"),
    );
    expect((await refusal({ home, page: "mailto:webmaster@dvfr.illinois.gov" })).message).toBe(
      `--page "mailto:webmaster@dvfr.illinois.gov" isn't a page URL or a path like /about.`,
    );
  });

  it("uses the only site folder when a path is given", async () => {
    const home = await makeHome("dvfr.illinois.gov", ".git", "runs", "manual", "compare");
    await writeFile(path.join(home, ".gitattributes"), "* -text\n");
    await writeFile(path.join(home, "report.html"), "<!doctype html>\n");
    expect(await chooseSiteDir({ home, page: "/faq/" })).toBe(path.join(home, "dvfr.illinois.gov"));
    expect(await chooseSiteDir({ home })).toBe(path.join(home, "dvfr.illinois.gov"));
  });

  it("names the sites when it can't tell which one", async () => {
    const home = await makeHome("i2i.illinois.gov", "dvfr.illinois.gov");
    expect((await refusal({ home, page: "/faq/" })).message).toBe(
      "voicecap-transcripts has dvfr.illinois.gov and i2i.illinois.gov: add --site, or give --page as a full URL.",
    );
    // `report` has no --page.
    await mkdir(path.join(home, "www.illinois.gov", "2026-09-27"), { recursive: true });
    expect((await refusal({ home })).message).toBe(
      "voicecap-transcripts has dvfr.illinois.gov, i2i.illinois.gov, and www.illinois.gov: add --site.",
    );
  });

  it("ignores empty folders, like one a failed run leaves", async () => {
    const one = await makeHome("dvfr.illinois.gov");
    await mkdir(path.join(one, "dvfr.ilinois.gov"));
    expect(await chooseSiteDir({ home: one, page: "/faq/" })).toBe(
      path.join(one, "dvfr.illinois.gov"),
    );

    const two = await makeHome("dvfr.illinois.gov", "i2i.illinois.gov");
    await mkdir(path.join(two, "dvfr.ilinois.gov"));
    expect((await refusal({ home: two })).message).toBe(
      "voicecap-transcripts has dvfr.illinois.gov and i2i.illinois.gov: add --site.",
    );

    const none = await makeHome();
    await mkdir(path.join(none, "dvfr.ilinois.gov"));
    expect((await refusal({ home: none })).message).toBe(
      `${none} has no site folders yet: run voicecap on the site first, or add --site.`,
    );
  });

  it("leaves the owner's own folders at the home's top alone", async () => {
    const home = await makeHome("dvfr.illinois.gov");
    await mkdir(path.join(home, "notes"));
    await writeFile(path.join(home, "notes", "README.md"), "# Notes on the audit\n");
    expect(await chooseSiteDir({ home, page: "/faq/" })).toBe(path.join(home, "dvfr.illinois.gov"));
    expect(await chooseSiteDir({ home })).toBe(path.join(home, "dvfr.illinois.gov"));

    // A folder is a site's when it holds any of what voicecap writes there, not just a date folder.
    for (const file of ["reviews.json", "latest.txt", "report.html"]) {
      const other = await makeHome("dvfr.illinois.gov");
      await mkdir(path.join(other, "i2i.illinois.gov"));
      await writeFile(path.join(other, "i2i.illinois.gov", file), "\n");
      expect((await refusal({ home: other })).message).toBe(
        "voicecap-transcripts has dvfr.illinois.gov and i2i.illinois.gov: add --site.",
      );
    }
  });

  it("says there's nothing yet in an empty home", async () => {
    const home = await makeHome();
    expect((await refusal({ home, page: "/faq/" })).message).toBe(
      `${home} has no site folders yet: run voicecap on the site first, or add --site.`,
    );
    const missing = path.join(home, "not-made-yet");
    expect((await refusal({ home: missing })).message).toBe(
      `${missing} has no site folders yet: run voicecap on the site first, or add --site.`,
    );
  });
});

/** The demo's pages as the owner's computer serves them, and where the website publishes them. */
const DEMO_READ = "http://127.0.0.1:4848";
const DEMO_ROOT = "https://voicecap.netlify.app/demo-site/";
/** A site read on a copy at localhost, and the address people visit. */
const COPY_READ = "http://localhost:3000";
const DVFR_ROOT = "https://dvfr.illinois.gov/";

/** A run, as much of it as these tests read. */
interface RecordedRun {
  /** When it began, as "2026-09-27 11:02": its id, and its start time. */
  began: string;
  /** The address it read. */
  site: string;
  /** The root it recorded as its site's canonical address. Default: none, as before 0.10.0. */
  canonical?: string;
  /** Default: completed. */
  status?: "completed" | "incomplete";
}

/** A run's record, written into `folder` of `home` where voicecap files it: <date>/<time>/run.json. */
async function recordRun(home: string, folder: string, run: RecordedRun): Promise<string> {
  const [day = "", time = ""] = run.began.split(" ");
  const record = shareRun({
    id: `${day}_${time.replace(":", "")}`,
    createdAt: `${day}T${time}:00-05:00`,
    site: run.site,
    ...(run.canonical === undefined ? {} : { canonical: run.canonical }),
    ...(run.status === undefined ? {} : { status: run.status }),
    pages: [],
  });
  const file = runJsonPath(path.join(home, folder), record.id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

describe("chooseSiteDir, given a site's canonical address", () => {
  it("finds the folder whose runs recorded the canonical address", async () => {
    const home = await makeHome("dvfr.illinois.gov");
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-29 14:02",
      site: DEMO_READ,
      canonical: DEMO_ROOT,
    });
    const folder = path.join(home, "127.0.0.1_4848");

    expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(folder);
    // However the address is written: without its closing slash, with capitals in its host, and
    // with a query or a hash, which a canonical address doesn't have.
    for (const written of [
      "https://voicecap.netlify.app/demo-site",
      "https://VOICECAP.netlify.app/demo-site/",
      "https://voicecap.netlify.app/demo-site/?tab=1#top",
      "  https://voicecap.netlify.app/demo-site/  ",
    ]) {
      expect(await chooseSiteDir({ home, site: written })).toBe(folder);
    }
    // --site is the one that decides, whatever --page says.
    expect(
      await chooseSiteDir({ home, site: DEMO_ROOT, page: "https://dvfr.illinois.gov/x/" }),
    ).toBe(folder);
  });

  it("finds a site that has no path, as it finds one that has", async () => {
    const home = await makeHome("i2i.illinois.gov");
    await recordRun(home, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });

    expect(await chooseSiteDir({ home, site: "https://dvfr.illinois.gov" })).toBe(
      path.join(home, "localhost_3000"),
    );
    expect(await chooseSiteDir({ home, site: DVFR_ROOT })).toBe(path.join(home, "localhost_3000"));
    // The scheme is part of the address: http isn't the root the run recorded.
    expect(await chooseSiteDir({ home, site: "http://dvfr.illinois.gov" })).toBe(
      path.join(home, "dvfr.illinois.gov"),
    );
  });

  it("prefers a folder named after the address", async () => {
    const home = await makeHome();
    await recordRun(home, "dvfr.illinois.gov", {
      began: "2026-09-28 09:00",
      site: "https://dvfr.illinois.gov",
    });
    await recordRun(home, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });

    expect(await chooseSiteDir({ home, site: DVFR_ROOT })).toBe(
      path.join(home, "dvfr.illinois.gov"),
    );

    // A folder is there when it's on disk, whether or not anything has been recorded in it yet.
    const empty = await makeHome();
    await mkdir(path.join(empty, "dvfr.illinois.gov"));
    await recordRun(empty, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });
    expect(await chooseSiteDir({ home: empty, site: DVFR_ROOT })).toBe(
      path.join(empty, "dvfr.illinois.gov"),
    );
  });

  it("names both folders when two recorded it", async () => {
    const home = await makeHome();
    await recordRun(home, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DEMO_ROOT,
    });
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-28 09:00",
      site: DEMO_READ,
      canonical: DEMO_ROOT,
    });

    expect((await refusal({ home, site: DEMO_ROOT })).message).toBe(
      `${DEMO_ROOT} is the canonical address of 127.0.0.1_4848 and localhost_3000: give --site the address voicecap read, http://127.0.0.1:4848 or http://localhost:3000.`,
    );

    // More than two are named the same way, each with the address its runs read.
    await recordRun(home, "staging.illinois.gov", {
      began: "2026-09-27 10:00",
      site: "https://staging.illinois.gov",
      canonical: DEMO_ROOT,
    });
    expect((await refusal({ home, site: DEMO_ROOT })).message).toBe(
      `${DEMO_ROOT} is the canonical address of 127.0.0.1_4848, localhost_3000, and staging.illinois.gov: give --site the address voicecap read, http://127.0.0.1:4848, http://localhost:3000, or https://staging.illinois.gov.`,
    );
    // The address either folder read still finds its own folder.
    expect(await chooseSiteDir({ home, site: DEMO_READ })).toBe(path.join(home, "127.0.0.1_4848"));
    expect(await chooseSiteDir({ home, site: COPY_READ })).toBe(path.join(home, "localhost_3000"));
  });

  it("finds nothing new for an address no run recorded", async () => {
    const home = await makeHome("i2i.illinois.gov");
    // Runs from before 0.10.0 recorded no canonical address, so nothing names their folder.
    await recordRun(home, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
    await recordRun(home, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });

    // As before: the folder the address would have, which a command that may make it makes.
    for (const [site, folder] of [
      [DEMO_ROOT, "voicecap.netlify.app"],
      ["https://dev.illinois.gov/", "dev.illinois.gov"],
      ["https://dev.illinois.gov:8443/", "dev.illinois.gov_8443"],
    ] as const) {
      expect(await chooseSiteDir({ home, site })).toBe(path.join(home, folder));
      expect(existsSync(path.join(home, folder))).toBe(false);
    }
  });

  it("goes by each folder's newest completed run", async () => {
    const home = await makeHome();
    // Its newest completed run recorded the demo's root; a later run never finished.
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-27 10:00",
      site: DEMO_READ,
      canonical: DEMO_ROOT,
    });
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-28 10:00",
      site: DEMO_READ,
      status: "incomplete",
    });
    // It recorded the demo's root once, but its newest completed run recorded another.
    await recordRun(home, "localhost_3000", {
      began: "2026-09-26 10:00",
      site: COPY_READ,
      canonical: DEMO_ROOT,
    });
    await recordRun(home, "localhost_3000", {
      began: "2026-09-27 10:00",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });

    expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(path.join(home, "127.0.0.1_4848"));
    expect(await chooseSiteDir({ home, site: DVFR_ROOT })).toBe(path.join(home, "localhost_3000"));

    // A run that didn't complete doesn't name its site, even when it's the newest.
    await recordRun(home, "localhost_3000", {
      began: "2026-09-28 10:00",
      site: COPY_READ,
      canonical: "https://i2i.illinois.gov/",
      status: "incomplete",
    });
    expect(await chooseSiteDir({ home, site: "https://i2i.illinois.gov/" })).toBe(
      path.join(home, "i2i.illinois.gov"),
    );
  });

  it("counts a folder once, however many of its runs recorded the address", async () => {
    const home = await makeHome();
    for (const began of ["2026-09-27 10:00", "2026-09-28 10:00", "2026-09-29 14:02"]) {
      await recordRun(home, "127.0.0.1_4848", { began, site: DEMO_READ, canonical: DEMO_ROOT });
    }

    expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(path.join(home, "127.0.0.1_4848"));
  });

  it("compares the address and a recorded one as normalizeCanonical writes them", async () => {
    const home = await makeHome();
    // Written by something other than voicecap: no closing slash, capitals in the host.
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-29 14:02",
      site: DEMO_READ,
      canonical: "https://VOICECAP.netlify.app/demo-site",
    });

    expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(path.join(home, "127.0.0.1_4848"));
  });

  it("names a site by its whole root, path and all", async () => {
    const home = await makeHome();
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-29 14:02",
      site: DEMO_READ,
      canonical: DEMO_ROOT,
    });

    // The website's own root isn't the demo's, and a page of the demo isn't its root.
    for (const site of ["https://voicecap.netlify.app", `${DEMO_ROOT}the-report/`]) {
      expect(await chooseSiteDir({ home, site })).toBe(path.join(home, "voicecap.netlify.app"));
    }
  });

  it("leaves an IP address or a local address as it was: the folder named after it", async () => {
    const home = await makeHome();
    // A record can say anything. None that names a computer's address is a site's name.
    await recordRun(home, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: "http://127.0.0.1:4848/",
    });

    expect(await chooseSiteDir({ home, site: DEMO_READ })).toBe(path.join(home, "127.0.0.1_4848"));
    expect(await chooseSiteDir({ home, site: "http://[::1]:4848" })).toBe(
      siteDirFor(home, "http://[::1]:4848/"),
    );
  });

  it("reads records as data: one that isn't text, and one that can't be read, name nothing", async () => {
    const home = await makeHome();
    await recordRun(home, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: 42 as unknown as string,
    });
    const damaged = await recordRun(home, "i2i.illinois.gov", {
      began: "2026-09-29 14:02",
      site: "https://i2i.illinois.gov",
      canonical: DVFR_ROOT,
    });
    await writeFile(damaged, "{ this is not json");
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-29 14:02",
      site: DEMO_READ,
      canonical: DEMO_ROOT,
    });

    expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(path.join(home, "127.0.0.1_4848"));
    expect(await chooseSiteDir({ home, site: DVFR_ROOT })).toBe(
      path.join(home, "dvfr.illinois.gov"),
    );
  });

  it("still takes only a full URL, and checks a path that Git Bash rewrote", async () => {
    const home = await makeHome();
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-29 14:02",
      site: DEMO_READ,
      canonical: DEMO_ROOT,
    });

    // The short way is a canonical address elsewhere, but --site has always wanted a full URL.
    expect((await refusal({ home, site: "voicecap.netlify.app/demo-site/" })).message).toMatch(
      /--site must be a full URL/,
    );
    expect(
      (await refusal({ home, site: "ftp://voicecap.netlify.app/demo-site/" })).message,
    ).toMatch(/--site must be an http or https URL/);
    expect((await refusal({ home, site: "C:/Program Files/Git/demo-site/" })).message).toMatch(
      /looks like a Windows path/,
    );
  });

  it("says nothing new in a home with no sites yet", async () => {
    const missing = path.join(await makeHome(), "not-made-yet");
    expect(await chooseSiteDir({ home: missing, site: DEMO_ROOT })).toBe(
      path.join(missing, "voicecap.netlify.app"),
    );
    const empty = await makeHome();
    expect(await chooseSiteDir({ home: empty, site: DEMO_ROOT })).toBe(
      path.join(empty, "voicecap.netlify.app"),
    );
  });
});
