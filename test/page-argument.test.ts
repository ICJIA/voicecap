import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
      const error = await resolvePageArgument(page, OUT_DIR, site).then(
        () => null,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).message).toBe(REFUSAL);
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
});
