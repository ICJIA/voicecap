/**
 * The demo's own pages, which `voicecap site` publishes under demo-site/ (src/site/build.ts), read
 * from a copy of the demo site that comes with voicecap that has the files an operating system adds
 * to a folder someone opens in it, as a checkout opened in Finder or Explorer has (OS_LITTER): none
 * is published, none has a rule in _headers, and a build into the folder an earlier build made is
 * never refused for them. The build reads the copy in place of the package's own folder, and no
 * file of the package is touched. Nothing here starts a screen reader, a browser, or Word.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it, vi } from "vitest";

import { DEMO_SITE_DIR } from "../src/demo/server.js";
import type * as ServerModule from "../src/demo/server.js";
import { buildSite } from "../src/site/build.js";
import { createMemoryLogger } from "../src/util/log.js";
import { OS_LITTER } from "../src/util/os-litter.js";

/** The demo site that comes with voicecap: the folder the copy is made from, which is never changed. */
const PACKAGE_DEMO_SITE = fileURLToPath(new URL("../demo/site/", import.meta.url));
/** The name of the temporary folder the copy is made in. */
const COPY_PREFIX = "voicecap-demo-litter-";
/** Where in the copy each file an operating system adds is: at its top, and in a page's folder. */
const LITTER = [
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "the-report/.DS_Store",
  "ask-a-question/Thumbs.db",
];

// The build's DEMO_SITE_DIR is a copy of the package's own, made for this file, with LITTER in it.
// The factory runs before this file's imports are made, so it imports what it uses itself, and
// names the files again.
vi.mock("../src/demo/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerModule>();
  const fs = await import("node:fs/promises");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const made = await fs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "voicecap-demo-litter-"));
  const copy = nodePath.join(made, "site");
  await fs.cp(actual.DEMO_SITE_DIR, copy, { recursive: true });
  for (const file of [
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    "the-report/.DS_Store",
    "ask-a-question/Thumbs.db",
  ]) {
    await fs.writeFile(nodePath.join(copy, ...file.split("/")), "how the system shows the folder");
  }
  return { ...actual, DEMO_SITE_DIR: copy };
});

/** The folders this file made, which are taken away at the end. */
const made: string[] = [];

afterAll(async () => {
  // The copy's folder too, and only when it is the temporary one made above.
  const copyRoot = path.dirname(path.resolve(DEMO_SITE_DIR));
  const inTemp = path.relative(os.tmpdir(), copyRoot);
  if (path.basename(copyRoot).startsWith(COPY_PREFIX) && !inTemp.startsWith("..")) {
    made.push(copyRoot);
  }
  await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Every file under `dir`, by its path from `dir` with forward slashes, sorted. */
async function filesUnder(dir: string): Promise<string[]> {
  const found = await readdir(dir, { recursive: true, withFileTypes: true });
  return found
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

describe("the demo's own pages, from a folder with an operating system's files in it", () => {
  it("are published without those files, and a build into the folder an earlier one made isn't refused", async () => {
    // The build reads the copy, which has every file of LITTER, each named as an operating system
    // names one.
    expect(path.resolve(DEMO_SITE_DIR)).not.toBe(path.resolve(PACKAGE_DEMO_SITE));
    for (const file of LITTER) {
      expect(existsSync(path.join(DEMO_SITE_DIR, ...file.split("/"))), file).toBe(true);
      expect(OS_LITTER.has(path.posix.basename(file)), file).toBe(true);
    }
    const root = await mkdtemp(path.join(os.tmpdir(), "voicecap-site-litter-"));
    made.push(root);
    const home = path.join(root, "transcripts");
    await mkdir(home);
    const build = () => buildSite({ home, cwd: root, env: {}, logger: createMemoryLogger() });

    const first = await build();

    // Every other file of the copy is published, byte for byte, with the sitemap; none of LITTER is.
    const published = await filesUnder(path.join(first.out, "demo-site"));
    const shipped = (await filesUnder(DEMO_SITE_DIR)).filter(
      (file) => file !== "404.html" && !LITTER.includes(file),
    );
    expect(published).toEqual([...shipped, "sitemap.xml"].sort());
    for (const file of shipped) {
      expect(await readFile(path.join(first.out, "demo-site", file)), file).toEqual(
        await readFile(path.join(DEMO_SITE_DIR, file)),
      );
    }
    // No rule of _headers is for one of them.
    const headers = await readFile(path.join(first.out, "_headers"), "utf8");
    for (const name of OS_LITTER) expect(headers, name).not.toContain(name);

    // The next build empties the folder the first made, and builds the same again.
    const second = await build();

    expect(second.out).toBe(first.out);
    expect(await filesUnder(path.join(second.out, "demo-site"))).toEqual(published);
  });
});
