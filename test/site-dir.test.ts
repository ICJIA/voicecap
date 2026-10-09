import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runJsonPath, shareDir, sharesPath, siteDirFor } from "../src/run/paths.js";
import { chooseSiteDir, chooseSiteDirOfRun } from "../src/run/site-dir.js";
import { UsageError } from "../src/util/errors.js";
import { shareRun } from "./helpers/share-data.js";
import { recordOf, sealedEntry, writeRecord } from "./helpers/site-home.js";

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
  return refused(chooseSiteDir(options));
}

/** The usage error a lookup stops with. */
async function refused(lookup: Promise<unknown>): Promise<UsageError> {
  const error: unknown = await lookup.then(
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
const DEMO_ROOT = "https://voicecap.icjia.app/demo-site/";
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

/**
 * The record of what `folder` of `home` shared: a sealed entry for each of `sites`, numbered from 1
 * in order, each recording that site as the root its copies name (none, for `undefined`, as an
 * entry from before 0.10.0 has none).
 */
async function recordShares(home: string, folder: string, sites: unknown[]): Promise<void> {
  const page = Buffer.from("<!doctype html><title>A shared page</title>");
  await writeRecord(
    path.join(home, folder),
    sites.map((site, index) =>
      sealedEntry(
        index + 1,
        `2026-09-30T09:0${index}:00-05:00`,
        [recordOf(`${folder}_${index + 1}.html`, page)],
        site === undefined ? {} : { site },
      ),
    ),
  );
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
      "https://voicecap.icjia.app/demo-site",
      "https://VOICECAP.icjia.app/demo-site/",
      "https://voicecap.icjia.app/demo-site/?tab=1#top",
      "  https://voicecap.icjia.app/demo-site/  ",
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

    // A folder with no records isn't a site's, whatever it's called: a first attempt that stopped
    // before it recorded anything leaves one. The folder whose runs recorded the address wins.
    const empty = await makeHome();
    await mkdir(path.join(empty, "dvfr.illinois.gov"));
    await recordRun(empty, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });
    expect(await chooseSiteDir({ home: empty, site: DVFR_ROOT })).toBe(
      path.join(empty, "localhost_3000"),
    );
  });

  it("passes over a folder named after the address that holds no records, and over a file", async () => {
    // With nothing else that recorded the address, the folder the address would have is that same
    // path, as it was before.
    const home = await makeHome();
    await mkdir(path.join(home, "dvfr.illinois.gov"));
    await mkdir(path.join(home, "127.0.0.1_4848"));
    await recordRun(home, "localhost_3000", { began: "2026-09-29 14:02", site: COPY_READ });
    expect(await chooseSiteDir({ home, site: DVFR_ROOT })).toBe(
      path.join(home, "dvfr.illinois.gov"),
    );
    // An address of this computer has no canonical address to look for, so it is that path too.
    expect(await chooseSiteDir({ home, site: DEMO_READ })).toBe(path.join(home, "127.0.0.1_4848"));

    // Something that isn't a folder, left where the folder would be, is passed over too.
    const stray = await makeHome();
    await writeFile(path.join(stray, "dvfr.illinois.gov"), "not a folder\n");
    await recordRun(stray, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });
    expect(await chooseSiteDir({ home: stray, site: DVFR_ROOT })).toBe(
      path.join(stray, "localhost_3000"),
    );
  });

  it("takes a folder named after the address that holds any record of a site, runs or not", async () => {
    // manual add makes a live site's folder with a session in it, before any run.
    const manual = await makeHome();
    const session = path.join(manual, "dvfr.illinois.gov", "2026-09-25", "2357_manual_home");
    await mkdir(session, { recursive: true });
    await writeFile(path.join(session, "session.json"), "{}\n");
    await recordRun(manual, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });
    expect(await chooseSiteDir({ home: manual, site: DVFR_ROOT })).toBe(
      path.join(manual, "dvfr.illinois.gov"),
    );

    // So does a folder with only a file voicecap writes at a site's top.
    for (const file of ["reviews.json", "latest.txt", "report.html"]) {
      const home = await makeHome();
      await mkdir(path.join(home, "dvfr.illinois.gov"));
      await writeFile(path.join(home, "dvfr.illinois.gov", file), "\n");
      await recordRun(home, "localhost_3000", {
        began: "2026-09-29 14:02",
        site: COPY_READ,
        canonical: DVFR_ROOT,
      });
      expect(await chooseSiteDir({ home, site: DVFR_ROOT })).toBe(
        path.join(home, "dvfr.illinois.gov"),
      );
    }
  });

  it("finds a root with a path by what its runs recorded, before the folder named after its host", async () => {
    const home = await makeHome();
    // Folders are named after the host, so this one holds the records of a run on the website's own
    // pages, not of the demo that lives under /demo-site/ on it.
    await recordRun(home, "voicecap.icjia.app", {
      began: "2026-09-28 09:00",
      site: "https://voicecap.icjia.app",
    });
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-29 14:02",
      site: DEMO_READ,
      canonical: DEMO_ROOT,
    });

    expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(path.join(home, "127.0.0.1_4848"));
    // The host alone is the website's own site. And a root with a path that no run recorded is
    // as it was before canonical addresses: any URL on the host's site.
    for (const site of ["https://voicecap.icjia.app", "https://voicecap.icjia.app/other/"]) {
      expect(await chooseSiteDir({ home, site })).toBe(path.join(home, "voicecap.icjia.app"));
    }
  });

  it("names both folders for a root with a path, whatever folder is named after its host", async () => {
    const home = await makeHome();
    await recordRun(home, "voicecap.icjia.app", {
      began: "2026-09-28 09:00",
      site: "https://voicecap.icjia.app",
    });
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
      [DEMO_ROOT, "voicecap.icjia.app"],
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
      canonical: "https://VOICECAP.icjia.app/demo-site",
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
    for (const site of ["https://voicecap.icjia.app", `${DEMO_ROOT}the-report/`]) {
      expect(await chooseSiteDir({ home, site })).toBe(path.join(home, "voicecap.icjia.app"));
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
    expect((await refusal({ home, site: "voicecap.icjia.app/demo-site/" })).message).toMatch(
      /--site must be a full URL/,
    );
    expect((await refusal({ home, site: "ftp://voicecap.icjia.app/demo-site/" })).message).toMatch(
      /--site must be an http or https URL/,
    );
    expect((await refusal({ home, site: "C:/Program Files/Git/demo-site/" })).message).toMatch(
      /looks like a Windows path/,
    );
  });

  it("says nothing new in a home with no sites yet", async () => {
    const missing = path.join(await makeHome(), "not-made-yet");
    expect(await chooseSiteDir({ home: missing, site: DEMO_ROOT })).toBe(
      path.join(missing, "voicecap.icjia.app"),
    );
    const empty = await makeHome();
    expect(await chooseSiteDir({ home: empty, site: DEMO_ROOT })).toBe(
      path.join(empty, "voicecap.icjia.app"),
    );
  });

  // Ruling P17. report.canonical names a site when a share is made, whatever its runs recorded: the
  // demo runs voicecap 0.4.1 recorded named none. The share records the root as its site, so the
  // commands the shared page prints find their folder by it.
  describe("by what a folder's shares recorded", () => {
    it("finds the folder whose newest share recorded the canonical address", async () => {
      const home = await makeHome("i2i.illinois.gov");
      // Its runs recorded no canonical address; its share names the demo's.
      await recordRun(home, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
      await recordShares(home, "127.0.0.1_4848", [DEMO_ROOT]);
      await recordRun(home, "localhost_3000", { began: "2026-09-29 14:02", site: COPY_READ });
      await recordShares(home, "localhost_3000", [DVFR_ROOT]);

      expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(
        path.join(home, "127.0.0.1_4848"),
      );
      // A root with no path, whose own folder isn't there.
      expect(await chooseSiteDir({ home, site: "https://dvfr.illinois.gov" })).toBe(
        path.join(home, "localhost_3000"),
      );
    });

    it("goes by the newest share by seq, of those whose seal holds", async () => {
      // An older share named the demo, and the newest names another site.
      const moved = await makeHome();
      await recordRun(moved, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
      await recordShares(moved, "127.0.0.1_4848", [DEMO_ROOT, DVFR_ROOT]);
      expect(await chooseSiteDir({ home: moved, site: DVFR_ROOT })).toBe(
        path.join(moved, "127.0.0.1_4848"),
      );
      expect(await chooseSiteDir({ home: moved, site: DEMO_ROOT })).toBe(
        path.join(moved, "voicecap.icjia.app"),
      );

      // The record lists the entries out of order: seq decides which is newest, not the order.
      const unordered = await makeHome();
      await recordRun(unordered, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
      await recordShares(unordered, "127.0.0.1_4848", [DVFR_ROOT, DEMO_ROOT]);
      const siteDir = path.join(unordered, "127.0.0.1_4848");
      const { shares } = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as {
        shares: unknown[];
      };
      await writeRecord(siteDir, shares.toReversed());
      expect(await chooseSiteDir({ home: unordered, site: DEMO_ROOT })).toBe(siteDir);

      // The newest entry was changed after it was recorded, so its seal no longer holds: it vouches
      // for nothing, and the entry before it is the newest that counts.
      const changed = await makeHome();
      await recordRun(changed, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
      await recordShares(changed, "127.0.0.1_4848", [DEMO_ROOT, DEMO_ROOT]);
      const changedDir = path.join(changed, "127.0.0.1_4848");
      const record = JSON.parse(await readFile(sharesPath(changedDir), "utf8")) as {
        shares: Record<string, unknown>[];
      };
      await writeRecord(changedDir, [record.shares[0], { ...record.shares[1], site: DVFR_ROOT }]);
      expect(await chooseSiteDir({ home: changed, site: DEMO_ROOT })).toBe(changedDir);
      expect(await chooseSiteDir({ home: changed, site: DVFR_ROOT })).toBe(
        path.join(changed, "dvfr.illinois.gov"),
      );
    });

    it("takes a share that names no site readers know it by, and a record it can't read, for none", async () => {
      const home = await makeHome();
      // An IP address, which a share of a site with no canonical address recorded before 0.10.0
      // refused it; no site at all, as before 0.10.0; text that isn't a root; and a record that isn't
      // JSON.
      await recordRun(home, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
      await recordShares(home, "127.0.0.1_4848", ["http://127.0.0.1:4848/"]);
      await recordRun(home, "localhost_3000", { began: "2026-09-29 14:02", site: COPY_READ });
      await recordShares(home, "localhost_3000", [undefined]);
      await recordRun(home, "localhost_8080", {
        began: "2026-09-29 14:02",
        site: "http://localhost:8080",
      });
      await recordShares(home, "localhost_8080", ["voicecap.icjia.app/demo-site/"]);
      await recordRun(home, "localhost_9090", {
        began: "2026-09-29 14:02",
        site: "http://localhost:9090",
      });
      await mkdir(shareDir(path.join(home, "localhost_9090")), { recursive: true });
      await writeFile(sharesPath(path.join(home, "localhost_9090")), "{ not json");

      // As before: the folder the address would have.
      expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(
        path.join(home, "voicecap.icjia.app"),
      );
      expect(await chooseSiteDir({ home, site: DEMO_READ })).toBe(
        path.join(home, "127.0.0.1_4848"),
      );
    });

    it("counts a folder once when its runs and its shares both recorded the address", async () => {
      const home = await makeHome();
      await recordRun(home, "127.0.0.1_4848", {
        began: "2026-09-29 14:02",
        site: DEMO_READ,
        canonical: DEMO_ROOT,
      });
      await recordShares(home, "127.0.0.1_4848", [DEMO_ROOT]);

      expect(await chooseSiteDir({ home, site: DEMO_ROOT })).toBe(
        path.join(home, "127.0.0.1_4848"),
      );
    });

    it("names both folders when one's run and the other's share recorded it", async () => {
      const home = await makeHome();
      await recordRun(home, "127.0.0.1_4848", {
        began: "2026-09-29 14:02",
        site: DEMO_READ,
        canonical: DEMO_ROOT,
      });
      await recordRun(home, "localhost_3000", { began: "2026-09-28 09:00", site: COPY_READ });
      await recordShares(home, "localhost_3000", [DEMO_ROOT]);

      expect((await refusal({ home, site: DEMO_ROOT })).message).toBe(
        `${DEMO_ROOT} is the canonical address of 127.0.0.1_4848 and localhost_3000: give --site the address voicecap read, http://127.0.0.1:4848 or http://localhost:3000.`,
      );
    });
  });
});

// Ruling P17. The command the shared page and its Word copy print for a run's walkthrough file names
// the site by its canonical address and the run by its id: the folder to write it from is the one,
// of every folder that names the address, that holds the run.
describe("chooseSiteDirOfRun", () => {
  it("takes the folder that holds the run, of the live site's own and a copy's that name one root", async () => {
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

    expect(await chooseSiteDirOfRun({ home, site: DVFR_ROOT, run: "2026-09-29_1402" })).toBe(
      path.join(home, "localhost_3000"),
    );
    expect(
      await chooseSiteDirOfRun({ home, site: "https://dvfr.illinois.gov", run: "2026-09-28_0900" }),
    ).toBe(path.join(home, "dvfr.illinois.gov"));
  });

  it("finds a run in the folder whose share named the address, as report.canonical names the demo", async () => {
    const home = await makeHome();
    // The demo runs recorded no canonical address: only the share names the demo's.
    await recordRun(home, "127.0.0.1_4848", { began: "2026-09-29 13:15", site: DEMO_READ });
    await recordRun(home, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
    await recordShares(home, "127.0.0.1_4848", [DEMO_ROOT]);
    // The website's own pages were read once, in the folder named after its host.
    await recordRun(home, "voicecap.icjia.app", {
      began: "2026-09-28 09:00",
      site: "https://voicecap.icjia.app",
    });

    for (const run of ["2026-09-29_1315", "2026-09-29_1402"]) {
      expect(await chooseSiteDirOfRun({ home, site: DEMO_ROOT, run })).toBe(
        path.join(home, "127.0.0.1_4848"),
      );
    }
  });

  it("names the run and the folders it looked in when none holds it", async () => {
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
    await recordRun(home, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
    await recordShares(home, "127.0.0.1_4848", [DVFR_ROOT]);

    expect(
      (await refused(chooseSiteDirOfRun({ home, site: DVFR_ROOT, run: "2026-09-30_0900" })))
        .message,
    ).toBe(
      `There's no run 2026-09-30_0900 in ${path.join(home, "dvfr.illinois.gov")}, ${path.join(home, "127.0.0.1_4848")}, or ${path.join(home, "localhost_3000")}.`,
    );
  });

  it("names the folders that hold it, and asks for the address voicecap read, when several do", async () => {
    const home = await makeHome();
    // Two copies, each with a run that began the same minute.
    await recordRun(home, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });
    await recordRun(home, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });
    await recordShares(home, "127.0.0.1_4848", [DVFR_ROOT]);

    expect(
      (await refused(chooseSiteDirOfRun({ home, site: DVFR_ROOT, run: "2026-09-29_1402" })))
        .message,
    ).toBe(
      `Run 2026-09-29_1402 is in 127.0.0.1_4848 and localhost_3000: give --site the address voicecap read, http://127.0.0.1:4848 or http://localhost:3000.`,
    );
    // Each address it names finds its own folder.
    expect(await chooseSiteDirOfRun({ home, site: DEMO_READ, run: "2026-09-29_1402" })).toBe(
      path.join(home, "127.0.0.1_4848"),
    );
    expect(await chooseSiteDirOfRun({ home, site: COPY_READ, run: "2026-09-29_1402" })).toBe(
      path.join(home, "localhost_3000"),
    );
  });

  it("takes the folder named after an address with no path, which its runs read, when a copy has a run of that minute too", async () => {
    // The address is the one voicecap read for the live site's folder, so asking for that address
    // would ask for the one given: --site always named that folder.
    const home = await makeHome();
    await recordRun(home, "dvfr.illinois.gov", {
      began: "2026-09-29 14:02",
      site: "https://dvfr.illinois.gov",
    });
    await recordRun(home, "localhost_3000", {
      began: "2026-09-29 14:02",
      site: COPY_READ,
      canonical: DVFR_ROOT,
    });

    expect(await chooseSiteDirOfRun({ home, site: DVFR_ROOT, run: "2026-09-29_1402" })).toBe(
      path.join(home, "dvfr.illinois.gov"),
    );
    expect(await chooseSiteDirOfRun({ home, site: COPY_READ, run: "2026-09-29_1402" })).toBe(
      path.join(home, "localhost_3000"),
    );
  });

  it("names both for a root with a path, whose folder named after its host is another site's", async () => {
    const home = await makeHome();
    await recordRun(home, "voicecap.icjia.app", {
      began: "2026-09-29 14:02",
      site: "https://voicecap.icjia.app",
    });
    await recordRun(home, "127.0.0.1_4848", {
      began: "2026-09-29 14:02",
      site: DEMO_READ,
      canonical: DEMO_ROOT,
    });

    expect(
      (await refused(chooseSiteDirOfRun({ home, site: DEMO_ROOT, run: "2026-09-29_1402" })))
        .message,
    ).toBe(
      `Run 2026-09-29_1402 is in 127.0.0.1_4848 and voicecap.icjia.app: give --site the address voicecap read, http://127.0.0.1:4848 or https://voicecap.icjia.app.`,
    );
    expect(
      await chooseSiteDirOfRun({
        home,
        site: "https://voicecap.icjia.app",
        run: "2026-09-29_1402",
      }),
    ).toBe(path.join(home, "voicecap.icjia.app"));
  });

  it("goes as chooseSiteDir goes for the address voicecap read, an address no folder names, and no address", async () => {
    const home = await makeHome();
    await recordRun(home, "127.0.0.1_4848", { began: "2026-09-29 14:02", site: DEMO_READ });

    expect(await chooseSiteDirOfRun({ home, site: DEMO_READ, run: "2026-09-30_0900" })).toBe(
      path.join(home, "127.0.0.1_4848"),
    );
    expect(await chooseSiteDirOfRun({ home, site: DVFR_ROOT, run: "2026-09-30_0900" })).toBe(
      path.join(home, "dvfr.illinois.gov"),
    );
    expect(await chooseSiteDirOfRun({ home, run: "2026-09-30_0900" })).toBe(
      path.join(home, "127.0.0.1_4848"),
    );
    expect(
      (await refused(chooseSiteDirOfRun({ home, site: "dvfr.illinois.gov", run: "x" }))).message,
    ).toMatch(/--site must be a full URL/);
  });
});
