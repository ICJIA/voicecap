/**
 * Builds the website from a home with reports shared in it (the one the site's tests make: the demo
 * runs of 29 September 2026 shared twice, a second site, and the demo's own folder), so a change to
 * the site can be looked at in a browser, with no screen reader, no run, and no Word.
 *
 *   pnpm site:fixture <folder>     # makes the home in <folder>/home, builds the site from it in
 *                                  # <folder>/_site, and prints the path of its index.html
 *
 * The folder is made when it isn't there, and has no home in it. Keep it outside the repository.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildSite } from "../src/site/build.js";
import { silentLogger } from "../src/util/log.js";
import { homeWithShares } from "../test/helpers/site-home.js";

async function main(): Promise<void> {
  const folder = process.argv[2];
  if (folder === undefined) {
    console.error("Usage: pnpm site:fixture <folder>");
    process.exit(2);
  }
  const root = path.resolve(folder);
  const home = path.join(root, "home");
  if (existsSync(home)) {
    throw new Error(`${home} is already there. Give a folder with no home in it, or take it away.`);
  }
  await homeWithShares(home);
  const { out } = await buildSite({
    home,
    out: path.join(root, "_site"),
    cwd: root,
    env: {},
    logger: silentLogger,
  });
  console.log(path.join(out, "index.html"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
