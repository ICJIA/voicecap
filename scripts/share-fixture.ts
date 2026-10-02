/**
 * Writes the shareable page of the demo fixture (the demo runs of 29 September 2026, as the tests
 * build them) into a folder, so a change to how the page is made can be checked against the page
 * from before it: when no reader would see a difference, `cmp` of the two files prints nothing.
 *
 *   pnpm share:fixture <folder>     # writes <folder>/demo.html, and prints its path
 *
 * The page has no fonts, which are the same in every copy of it. The folder is made when it isn't
 * there. Keep it outside the repository.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { renderSharePage } from "../src/share/html/document.js";
import { writeFileAtomic } from "../src/util/atomic-write.js";
import { demoModel } from "../test/helpers/share-model.js";

/** Write the demo's page to `folder`/demo.html, and return its path. */
export async function writeDemoPage(folder: string): Promise<string> {
  const file = path.join(path.resolve(folder), "demo.html");
  await writeFileAtomic(file, renderSharePage(await demoModel(), { fontCss: "" }));
  return file;
}

async function main(): Promise<void> {
  const folder = process.argv[2];
  if (folder === undefined) {
    console.error("Usage: pnpm share:fixture <folder>");
    process.exit(2);
  }
  console.log(await writeDemoPage(folder));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
