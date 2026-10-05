/**
 * Writes the shareable page of the demo fixture (the demo runs of 29 September 2026, as the tests
 * build them), and its Word copy, into a folder, so a change to how either is made can be checked
 * against the one from before it: when no reader would see a difference, `cmp` of the two page files
 * prints nothing. The Word copy's bytes differ from one build to the next (it records when it was
 * made, and its links have random ids), so it is read, not compared.
 *
 *   pnpm share:fixture <folder>     # writes <folder>/demo.html and <folder>/demo.docx, and prints
 *                                   # their paths
 *
 * The demo is named by its canonical address, as report.canonical names it when it's shared: its
 * runs read it at an IP address and recorded no canonical address, and voicecap shares no site by
 * an IP address. The page has no fonts, which are the same in every copy of it. The folder is made
 * when it isn't there. Keep it outside the repository.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { renderWordCopy } from "../src/share/docx.js";
import { renderSharePage } from "../src/share/html/document.js";
import { writeFileAtomic } from "../src/util/atomic-write.js";
import { DEMO_ROOT, demoModel } from "../test/helpers/share-model.js";

/** Write the demo's page to `folder`/demo.html, and return its path. */
export async function writeDemoPage(folder: string): Promise<string> {
  const file = path.join(path.resolve(folder), "demo.html");
  await writeFileAtomic(file, renderSharePage(await demoModel(DEMO_ROOT), { fontCss: "" }));
  return file;
}

/** Write the demo's Word copy to `folder`/demo.docx, and return its path. */
export async function writeDemoWordCopy(folder: string): Promise<string> {
  const file = path.join(path.resolve(folder), "demo.docx");
  await writeFileAtomic(file, await renderWordCopy(await demoModel(DEMO_ROOT)));
  return file;
}

async function main(): Promise<void> {
  const folder = process.argv[2];
  if (folder === undefined) {
    console.error("Usage: pnpm share:fixture <folder>");
    process.exit(2);
  }
  console.log(await writeDemoPage(folder));
  console.log(await writeDemoWordCopy(folder));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
