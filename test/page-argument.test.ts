import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { resolvePageArgument } from "../src/pages/page-argument.js";
import { UsageError } from "../src/util/errors.js";

/**
 * A site's folder that isn't there: a page given as a full URL, with or without a --site that its
 * folder is named for, reads nothing from it.
 */
const OUT_DIR = path.join(os.tmpdir(), "voicecap-page-argument", "example.org");

/** What a page whose address has a user name or password in it is refused with. */
const REFUSAL =
  "--page has a user name or password in its address: voicecap doesn't read pages that way, and the address would be kept in its records.";

/** The folders these tests made, which are taken away after them. */
const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
});

/** The error `resolvePageArgument` refuses with. */
async function refusal(...args: Parameters<typeof resolvePageArgument>): Promise<UsageError> {
  const error = await resolvePageArgument(...args).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UsageError);
  return error as UsageError;
}

describe("resolvePageArgument", () => {
  // A page given to review, or to add a manual session to, is kept in that record, and shown on the
  // page. One with a user name or password in its address is refused before anything repeats it.
  it.each([
    "https://u:p@example.org/a",
    "  https://u:p@example.org/a  ",
    "https://jane@example.org/a",
    "https://:p@example.org/a",
    "http:u:p@example.org/a",
    "//u:p@example.org/a",
  ])("refuses %s, in words that hold no user name and no password", async (page) => {
    for (const site of [undefined, null, "https://example.org"]) {
      expect((await refusal(page, OUT_DIR, site)).message).toBe(REFUSAL);
    }
  });

  it("takes a page whose @ is in its path, query, or fragment, which is no user name", async () => {
    const page = await resolvePageArgument("https://example.org/@jane?mail=a@b.c#x@y", OUT_DIR);

    // The fragment is dropped, as it is for any page.
    expect(page.url).toBe("https://example.org/@jane?mail=a@b.c");
  });

  it("still takes a full URL, and a path against --site", async () => {
    expect((await resolvePageArgument("https://example.org/faq/", OUT_DIR)).url).toBe(
      "https://example.org/faq/",
    );
    expect((await resolvePageArgument("/faq/", OUT_DIR, "https://example.org")).url).toBe(
      "https://example.org/faq/",
    );
  });

  // A name and a password with no scheme read as the scheme `staging:`: no user name to the URL
  // standard, and not repeated when the page is refused.
  it("doesn't repeat the name and password of a page that reads as another scheme", async () => {
    const message = (await refusal("staging:secret@example.org/a", OUT_DIR)).message;

    expect(message).toBe(`--page "example.org/a" isn't a page URL or a path like /about.`);
    expect(message).not.toContain("secret");
  });
});

// --site can be a canonical address, which finds the site's folder by what its runs recorded, and the
// page is then placed on the address those runs read (siteOfPages). A record that holds an address
// voicecap no longer reads as a site's (a host that ends with a dot, which was taken before 0.18.0)
// is said to be unreadable, in words of the record's, not as a mistake in what the person gave.
describe("resolvePageArgument: a site folder whose newest run records an address no site has", () => {
  /** A site's folder, not named for the site given, whose one run records `site`. */
  async function folderRecording(site: unknown): Promise<string> {
    const out = await mkdtemp(path.join(os.tmpdir(), "voicecap-page-argument-"));
    made.push(out);
    const folder = path.join(out, "recorded-folder");
    await mkdir(path.join(folder, "2026-09-29", "1402"), { recursive: true });
    const run = { id: "2026-09-29_1402", createdAt: "2026-09-29T14:02:00-05:00", site };
    await writeFile(path.join(folder, "2026-09-29", "1402", "run.json"), JSON.stringify(run));
    return folder;
  }

  it.each([
    ["a host that ends with a dot", "https://example.org."],
    ["a host with two dots in a row", "https://a..example.org"],
    ["an address with a user name in it", "https://jane:secret@example.org"],
    ["text that is no address", "not an address"],
    ["something that is not text", 4747],
  ])("says so, rather than blame --site, when it records %s", async (_name, recorded) => {
    const folder = await folderRecording(recorded);

    const error = await refusal("/faq/", folder, "https://dvfr.illinois.gov");

    expect(error.message).toBe(
      `The newest run in ${folder} records its site as an address voicecap can't read, so --page can't be matched to it.`,
    );
    expect(error.message).not.toContain("secret");
  });

  it("goes on when the record's address is one a site has", async () => {
    const folder = await folderRecording("https://example.org");

    const page = await resolvePageArgument("/faq/", folder, "https://dvfr.illinois.gov");

    expect(page.url).toBe("https://example.org/faq/");
  });
});
