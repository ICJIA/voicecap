import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { chooseSiteDir } from "../src/run/site-dir.js";
import { UsageError } from "../src/util/errors.js";

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
