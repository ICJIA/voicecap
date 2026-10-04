/**
 * buildSite, which `voicecap site` runs: the website of every report voicecap has shared, built from
 * the transcripts home's records of what was shared. Each test builds from its own home, made by
 * homeWithShares (test/helpers/site-home.ts) or small and made here, in a folder of its own that is
 * taken away after: no test deletes anything outside a folder it made. Nothing here starts a screen
 * reader, a browser, or Word.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import type { Stats } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { resolveConfig, type LoadedConfig } from "../src/config/load.js";
import { DEMO_OUT } from "../src/demo/words.js";
import type * as Api from "../src/index.js";
import type { SharedFile } from "../src/model.js";
import { esc } from "../src/report/html.js";
import { ensureGitFiles, GITATTRIBUTES, GITIGNORE } from "../src/run/git-files.js";
import { fontFaceCss } from "../src/share/fonts.js";
import { shareReport } from "../src/share/share.js";
import { readShares } from "../src/share/shares.js";
import { SITE_SCRIPT } from "../src/site/client.js";
import { buildSite, type BuildSiteOptions } from "../src/site/build.js";
import {
  contentSecurityPolicy,
  HEADERS_FIRST_LINE,
  inlineHashes,
  ROBOTS_TXT,
} from "../src/site/headers.js";
import { netlifyToml, NVMRC } from "../src/site/netlify.js";
import { DEMO_SITE, readSiteRecords } from "../src/site/records.js";
import type * as RecordsModule from "../src/site/records.js";
import { renderSiteIndex } from "../src/site/render.js";
import type * as RenderModule from "../src/site/render.js";
import { SITE_CSS } from "../src/site/style.js";
import { UsageError } from "../src/util/errors.js";
import { sha256 } from "../src/util/hash.js";
import { createMemoryLogger, silentLogger, type MemoryLogger } from "../src/util/log.js";
import { OS_LITTER } from "../src/util/os-litter.js";
import { isoLocal } from "../src/util/time.js";
import { voicecapVersion } from "../src/util/version.js";
import { linkToFolder } from "./helpers/links.js";
import {
  DEMO_SHARED_ON,
  EXAMPLE_AT,
  EXAMPLE_FOLDER,
  EXAMPLE_PAGE,
  EXAMPLE_SCRIPT,
  EXAMPLE_STEM,
  EXAMPLE_STYLE,
  EXAMPLE_WORD,
  FIXTURE_FOLDER,
  FIXTURE_SITE,
  homeWithShares,
  recordOf,
  sealedEntry,
  SHARED_ON,
  writeRecord,
} from "./helpers/site-home.js";
import { filesOf } from "./helpers/site-content.js";

// Every call goes through as it did, and is kept, so that a test can see what was read and what was
// removed, and can make the page's render or the records' read fail or say something else once.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    readFile: vi.fn(actual.readFile),
    rm: vi.fn(actual.rm),
  };
});
vi.mock("../src/site/records.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RecordsModule>();
  return { ...actual, readSiteRecords: vi.fn(actual.readSiteRecords) };
});
vi.mock("../src/site/render.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RenderModule>();
  return { ...actual, renderSiteIndex: vi.fn(actual.renderSiteIndex) };
});

/** The folders these tests made, which are taken away after each test. */
const roots: string[] = [];

/** A home from homeWithShares, made once for the file: each test builds from a copy of it. */
let template: string;

beforeAll(async () => {
  template = await homeWithShares();
});

afterAll(async () => {
  // The folder homeWithShares made: the home is in a folder of its own.
  await rm(path.dirname(template), { recursive: true, force: true });
});

afterEach(async () => {
  // Back to going through, with nothing waiting to fail or to answer, and no call kept.
  vi.mocked(lstat).mockReset();
  vi.mocked(readFile).mockReset();
  vi.mocked(rm).mockReset();
  vi.mocked(readSiteRecords).mockReset();
  vi.mocked(renderSiteIndex).mockReset();
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
  );
});

const CSP = "Content-Security-Policy";
/** The first of the fixture site's two shares: its Word copy, and the line that names it. */
const FIRST_WORD = `${FIXTURE_FOLDER}_2027-01-15.docx`;
const FIRST_WORD_PATH = `${FIXTURE_FOLDER}/share/${FIRST_WORD}`;

/** A new, empty folder, taken away after the test. */
async function newFolder(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-site-build-"));
  roots.push(dir);
  return dir;
}

/** A path from a home that is below a site's date folder: a run's records, which the site never reads. */
const A_RUNS_RECORD = /(^|[\\/])\d{4}-\d{2}-\d{2}[\\/]/;

/**
 * A new home, a copy of the one homeWithShares made, in a folder of its own that is taken away after
 * the test: `path.dirname(home)`. The copy leaves out each run's records (a site's date folders are
 * kept, empty, since a folder with one counts as a site's), so that it's quick to make.
 */
async function newHome(): Promise<string> {
  const home = path.join(await newFolder(), "transcripts");
  await cp(template, home, {
    recursive: true,
    filter: (source) => !A_RUNS_RECORD.test(path.relative(template, source)),
  });
  return home;
}

/**
 * What builds the site of `home`: the options, with the folder the home is in as the current folder
 * (it has no config), no environment, and a logger that keeps what is said.
 */
function building(
  home: string,
  extra: BuildSiteOptions = {},
): { logger: MemoryLogger; options: BuildSiteOptions } {
  const logger = createMemoryLogger();
  return { logger, options: { home, cwd: path.dirname(home), env: {}, logger, ...extra } };
}

/** Build the site of `home`, and keep what was said. */
async function build(home: string, extra: BuildSiteOptions = {}) {
  const { logger, options } = building(home, extra);
  return { logger, ...(await buildSite(options)) };
}

/** Every path given to readFile since its calls were last cleared, as text. Other kinds of file are left out. */
function pathsRead(): string[] {
  return vi
    .mocked(readFile)
    .mock.calls.flatMap(([file]) => (typeof file === "string" ? [file] : []));
}

/** What the logger warned, in order. */
function warned(logger: MemoryLogger): string[] {
  return logger.entries.filter(({ level }) => level === "warn").map(({ message }) => message);
}

/** What a build that was refused says. A refusal is a UsageError, which this checks it is. */
async function refusalOf(building: Promise<unknown>): Promise<string> {
  const error = await building.then(
    () => undefined,
    (rejected: unknown) => rejected,
  );
  expect(error).toBeInstanceOf(UsageError);
  return (error as UsageError).message;
}

/** The names a site folder's record gives its files, in order. */
async function namedIn(siteDir: string): Promise<string[]> {
  const { shares } = await readShares(siteDir);
  return shares.flatMap((entry) => (entry.files as SharedFile[]).map(({ name }) => name));
}

/** Every file under `dir`, by its path from `dir` with forward slashes, sorted. */
async function filesUnder(dir: string): Promise<string[]> {
  const found = await readdir(dir, { recursive: true, withFileTypes: true });
  return found
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

/**
 * Every file, folder, and link under `dir`, by its path from `dir`, with a fingerprint for each file
 * and where each link leads. A link is never followed.
 */
async function treeOf(dir: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name);
    const key = path.relative(dir, full).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      tree[key] = `a link to ${await readlink(full)}`;
    } else {
      tree[key] = entry.isDirectory() ? "a folder" : sha256(await readFile(full));
    }
  }
  return tree;
}

/** _headers as Netlify reads it: its first line, then each rule's path and headers, in order. */
function readHeaders(text: string): { first: string; rules: [string, [string, string][]][] } {
  const [first = "", ...blocks] = text.replace(/\n$/, "").split("\n\n");
  return {
    first,
    rules: blocks.map((block): [string, [string, string][]] => {
      const [rulePath = "", ...lines] = block.split("\n");
      return [
        rulePath,
        lines.map((line): [string, string] => {
          const match = /^ {2}([^:]+): (.*)$/.exec(line);
          if (match?.[1] === undefined || match[2] === undefined) {
            throw new Error(`Not a header line: ${JSON.stringify(line)}`);
          }
          return [match[1], match[2]];
        }),
      ];
    }),
  };
}

/** How a Content Security Policy names the hash of a text: 'sha256-', its base64, in quotes. */
function sourceOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** What the page says of a file that isn't here, as HTML. */
function goneLine(name: string, why: "changed" | "missing"): string {
  return esc(
    why === "changed"
      ? `${name} isn't here: it no longer matches the fingerprint recorded when it was shared.`
      : `${name} isn't here: the file is missing.`,
  );
}

/** Change one byte of a file, keeping its size: what a copy changed after it was shared is. */
async function changeAByte(file: string): Promise<void> {
  const bytes = await readFile(file);
  bytes.writeUInt8(bytes.readUInt8(10) ^ 0xff, 10);
  await writeFile(file, bytes);
}

/** Runs git, never throwing: a missing status means git isn't on PATH. */
function git(args: string[], cwd: string): number | null {
  try {
    return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).status;
  } catch {
    return null;
  }
}

const gitAvailable = git(["--version"], os.tmpdir()) === 0;

/**
 * A folder made to look as a build left it (its _headers starts with a build's first line, and it has
 * a page), with more in it: each path of `more`, from the folder, is a file with the text given, or a
 * folder where the text is null.
 */
async function builtWith(dir: string, more: Record<string, string | null>): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "_headers"), `${HEADERS_FIRST_LINE}\n`);
  await writeFile(path.join(dir, "index.html"), "a page");
  for (const [relative, contents] of Object.entries(more)) {
    const target = path.join(dir, relative);
    if (contents === null) {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
  }
  return dir;
}

/**
 * A report of a small home (see homeWithSites): the time it was made, and, as a share records them,
 * the root of its site (none, as before 0.10.0) and the name of its page (by default its folder's,
 * then its number).
 */
interface SmallShare {
  at: string;
  /** Anything a record might hold: a root, or something no share would write. */
  site?: unknown;
  page?: string;
}

/**
 * A small home of the sites given, each by its folder name and each of its reports (numbered from 1),
 * which is its time, or a SmallShare: a page for each, in the site's share/ folder, and a record
 * sealed by hand. A page holds its folder's name, so that two folders' pages of one name differ.
 */
async function homeWithSites(sites: Record<string, (string | SmallShare)[]>): Promise<string> {
  const home = path.join(await newFolder(), "transcripts");
  for (const [folder, reports] of Object.entries(sites)) {
    const siteDir = path.join(home, folder);
    await mkdir(path.join(siteDir, "2027-01-12"), { recursive: true });
    const shares: unknown[] = [];
    for (const [index, report] of reports.entries()) {
      const share: SmallShare = typeof report === "string" ? { at: report } : report;
      const { at, site, page = `${folder}_${index + 1}.html` } = share;
      const bytes = Buffer.from(`<!doctype html><title>${folder} ${index + 1}</title>`);
      await mkdir(path.join(siteDir, "share"), { recursive: true });
      await writeFile(path.join(siteDir, "share", page), bytes);
      shares.push(
        sealedEntry(index + 1, at, [recordOf(page, bytes)], site === undefined ? {} : { site }),
      );
    }
    await writeRecord(siteDir, shares);
  }
  return home;
}

describe("buildSite", () => {
  it("publishes every shared file byte for byte, under its site's folder, and the demo's under demo/", async () => {
    const home = await newHome();
    // Files in a share/ folder that no record names are never published.
    for (const name of ["current.html", "current.docx", "notes.txt"]) {
      await writeFile(
        path.join(home, FIXTURE_FOLDER, "share", name),
        `a file nothing records: ${name}`,
      );
    }
    vi.mocked(readFile).mockClear();

    const { out, content } = await build(home);
    const reads = pathsRead();

    // Each record's files: from its share/ folder to its site's folder, and the demo's to demo/.
    const published: { from: string; to: string }[] = [];
    const sources: [siteDir: string, on: string][] = [
      [path.join(home, FIXTURE_FOLDER), FIXTURE_FOLDER],
      [path.join(home, EXAMPLE_FOLDER), EXAMPLE_FOLDER],
      [path.join(home, DEMO_OUT, FIXTURE_FOLDER), "demo"],
    ];
    const counts: number[] = [];
    for (const [siteDir, on] of sources) {
      const names = await namedIn(siteDir);
      counts.push(names.length);
      for (const name of names) {
        published.push({ from: path.join(siteDir, "share", name), to: path.join(out, on, name) });
      }
    }
    // Two shares of four files, one of two, and the demo's four.
    expect(counts).toEqual([8, 2, 4]);
    for (const { from, to } of published) {
      const [copy, original] = [await readFile(to), await readFile(from)];
      expect({ bytes: copy.length, sha256: sha256(copy) }).toEqual({
        bytes: original.length,
        sha256: sha256(original),
      });
      // Each file is read once, and it's the same bytes that are checked and written.
      expect(reads.filter((read) => read === from)).toHaveLength(1);
    }
    // Only those, and the site's own three files.
    expect(await filesUnder(out)).toEqual(
      [
        "_headers",
        "index.html",
        "robots.txt",
        ...published.map(({ to }) => path.relative(out, to).split(path.sep).join("/")),
      ].sort(),
    );
    expect(content.sites.map(({ name }) => name)).toEqual([FIXTURE_FOLDER, EXAMPLE_FOLDER]);
  });

  it("gives the content the site's page is drawn from: each site's reports newest first, and the demo's", async () => {
    const home = await newHome();

    const { content } = await build(home);

    const shared = isoLocal(SHARED_ON);
    const fixture = content.sites[0];
    // Two shares at the same moment: the later one, which has the higher seq, comes first.
    expect(fixture?.reports.map(({ id, at, by }) => ({ id, at, by }))).toEqual([
      { id: `report-${FIXTURE_FOLDER}-2`, at: shared, by: "Test Reviewer" },
      { id: `report-${FIXTURE_FOLDER}-1`, at: shared, by: "Test Reviewer" },
    ]);
    expect(fixture?.reports[0]?.files).toEqual([
      expect.objectContaining({
        kind: "page",
        name: `${FIXTURE_FOLDER}_2027-01-15-2.html`,
        href: `${FIXTURE_FOLDER}/${FIXTURE_FOLDER}_2027-01-15-2.html`,
        run: null,
      }),
      expect.objectContaining({ kind: "word", name: `${FIXTURE_FOLDER}_2027-01-15-2.docx` }),
      expect.objectContaining({
        kind: "walkthrough",
        name: `${FIXTURE_FOLDER}_2027-01-15-2_2026-09-29_1315_walkthrough.json`,
        run: "2026-09-29_1315",
      }),
      expect.objectContaining({
        kind: "walkthrough",
        name: `${FIXTURE_FOLDER}_2027-01-15-2_2026-09-29_1402_walkthrough.json`,
        run: "2026-09-29_1402",
      }),
    ]);
    // A report of a site written by hand, as the record has it, with each file's own fingerprint.
    const page = Buffer.from(EXAMPLE_PAGE);
    expect(content.sites[1]).toEqual({
      name: EXAMPLE_FOLDER,
      folders: [EXAMPLE_FOLDER],
      reports: [
        {
          folder: EXAMPLE_FOLDER,
          id: `report-${EXAMPLE_FOLDER}-1`,
          at: EXAMPLE_AT,
          by: "Sam Rivera",
          files: [
            {
              kind: "page",
              name: `${EXAMPLE_STEM}.html`,
              href: `${EXAMPLE_FOLDER}/${EXAMPLE_STEM}.html`,
              bytes: page.length,
              sha256: sha256(page),
              run: null,
            },
            {
              kind: "word",
              name: `${EXAMPLE_STEM}.docx`,
              href: `${EXAMPLE_FOLDER}/${EXAMPLE_STEM}.docx`,
              bytes: EXAMPLE_WORD.length,
              sha256: sha256(EXAMPLE_WORD),
              run: null,
            },
          ],
          notPublished: [],
        },
      ],
    });
    // The demo is published under demo/, in a report of its own: in the folder records.ts keeps for it.
    expect(DEMO_SITE).toBe("demo");
    expect(content.demo).toMatchObject({
      folder: DEMO_SITE,
      id: "report-demo",
      at: isoLocal(DEMO_SHARED_ON),
      by: "Demo Reviewer",
      notPublished: [],
    });
    expect(content.demo?.files.map(({ href }) => href)).toEqual([
      `demo/${FIXTURE_FOLDER}_2027-01-16.html`,
      `demo/${FIXTURE_FOLDER}_2027-01-16.docx`,
      `demo/${FIXTURE_FOLDER}_2027-01-16_2026-09-29_1315_walkthrough.json`,
      `demo/${FIXTURE_FOLDER}_2027-01-16_2026-09-29_1402_walkthrough.json`,
    ]);
  });

  it("writes index.html, robots.txt, and _headers", async () => {
    const home = await newHome();

    const { out, content } = await build(home);

    // The page is what renderSiteIndex makes of the content the result gives, drawn once.
    expect(vi.mocked(renderSiteIndex)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderSiteIndex).mock.calls[0]?.[0]).toBe(content);
    expect(await readFile(path.join(out, "index.html"), "utf8")).toBe(
      renderSiteIndex(content, { fontCss: await fontFaceCss() }),
    );
    expect(await readFile(path.join(out, "robots.txt"), "utf8")).toBe(ROBOTS_TXT);

    const headers = await readFile(path.join(out, "_headers"), "utf8");
    expect(headers.startsWith(HEADERS_FIRST_LINE)).toBe(true);
    const { first, rules } = readHeaders(headers);
    expect(first).toBe(HEADERS_FIRST_LINE);

    // The index's policy allows its own style block and its one script, and nothing else.
    const indexPolicy = contentSecurityPolicy({
      scripts: [sourceOf(SITE_SCRIPT)],
      styles: [sourceOf(`\n${await fontFaceCss()}\n${SITE_CSS}`)],
    });
    // The index at both its addresses, then each published file in the order the site lists them: a
    // page at both its addresses, with the policy of its own bytes, and a Word copy or a walkthrough
    // file as a download.
    const expected: [string, [string, string][]][] = [
      ["/", [[CSP, indexPolicy]]],
      ["/index.html", [[CSP, indexPolicy]]],
    ];
    for (const file of filesOf(content)) {
      const bytes = await readFile(path.join(out, file.href));
      if (file.kind === "page") {
        const policy = contentSecurityPolicy(inlineHashes(bytes.toString("utf8")));
        expected.push(
          [`/${file.href}`, [[CSP, policy]]],
          [`/${file.href.replace(/\.html$/, "")}`, [[CSP, policy]]],
        );
      } else if (file.kind === "word" || file.kind === "walkthrough") {
        expected.push([`/${file.href}`, [["Content-Disposition", "attachment"]]]);
      }
    }
    expect(rules).toEqual(expected);
    // The index, four pages at two addresses each, and ten downloads.
    expect(rules).toHaveLength(2 + 4 * 2 + 4 + 6);

    // A page's policy is its own: the page written by hand has a script and a style no other has.
    const written = rules.find(
      ([rulePath]) => rulePath === `/${EXAMPLE_FOLDER}/${EXAMPLE_STEM}.html`,
    );
    expect(written?.[1]).toEqual([
      [
        CSP,
        contentSecurityPolicy({
          scripts: [sourceOf(EXAMPLE_SCRIPT)],
          styles: [sourceOf(EXAMPLE_STYLE)],
        }),
      ],
    ]);
    expect(rules.map(([rulePath]) => rulePath)).toContain(`/${EXAMPLE_FOLDER}/${EXAMPLE_STEM}`);
  });

  it("gives a page's policy and a download's headers once for each address, however many reports list the file", async () => {
    const home = await newHome();
    const siteDir = path.join(home, EXAMPLE_FOLDER);
    const page = Buffer.from(EXAMPLE_PAGE);
    // A later entry that names the same two files, whose bytes are the recorded ones.
    await writeRecord(siteDir, [
      ...(await readShares(siteDir)).shares,
      sealedEntry(2, "2027-01-14T09:30:00-06:00", [
        recordOf(`${EXAMPLE_STEM}.html`, page),
        recordOf(`${EXAMPLE_STEM}.docx`, EXAMPLE_WORD),
      ]),
    ]);

    const { out, content } = await build(home);

    expect(content.sites[1]?.reports.map(({ files }) => files.length)).toEqual([2, 2]);
    const paths = readHeaders(await readFile(path.join(out, "_headers"), "utf8")).rules.map(
      ([rulePath]) => rulePath,
    );
    expect(paths.filter((rulePath) => rulePath.startsWith(`/${EXAMPLE_FOLDER}/`))).toEqual([
      `/${EXAMPLE_FOLDER}/${EXAMPLE_STEM}.html`,
      `/${EXAMPLE_FOLDER}/${EXAMPLE_STEM}`,
      `/${EXAMPLE_FOLDER}/${EXAMPLE_STEM}.docx`,
    ]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  describe("what it leaves out", () => {
    it("leaves out a copy changed since it was shared, names it, and publishes the rest of its report", async () => {
      const home = await newHome();
      await changeAByte(path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD));

      const { out, content, leftOut, logger } = await build(home);

      const line = `${FIRST_WORD_PATH}: not published: it no longer matches its fingerprint`;
      expect(existsSync(path.join(out, FIXTURE_FOLDER, FIRST_WORD))).toBe(false);
      expect(leftOut).toEqual([line]);
      expect(warned(logger)).toEqual([line]);
      // The site's page says it isn't here, and doesn't link to it.
      const index = await readFile(path.join(out, "index.html"), "utf8");
      expect(index).toContain(goneLine(FIRST_WORD, "changed"));
      expect(index).not.toContain(`href="${FIXTURE_FOLDER}/${FIRST_WORD}"`);
      // The report's other files are published, and its record says what isn't.
      const report = content.sites[0]?.reports.find(({ id }) => id.endsWith("-1"));
      expect(report?.notPublished).toEqual([{ name: FIRST_WORD, reason: "changed" }]);
      expect(report?.files.map(({ name }) => name)).toEqual([
        `${FIXTURE_FOLDER}_2027-01-15.html`,
        `${FIXTURE_FOLDER}_2027-01-15_2026-09-29_1315_walkthrough.json`,
        `${FIXTURE_FOLDER}_2027-01-15_2026-09-29_1402_walkthrough.json`,
      ]);
      for (const { name } of report?.files ?? []) {
        expect(existsSync(path.join(out, FIXTURE_FOLDER, name))).toBe(true);
      }
      // And no rule of _headers is for a file that isn't there.
      const paths = readHeaders(await readFile(path.join(out, "_headers"), "utf8")).rules.map(
        ([rulePath]) => rulePath,
      );
      expect(paths).not.toContain(`/${FIXTURE_FOLDER}/${FIRST_WORD}`);
    });

    it("leaves out a copy that is longer or shorter than it was shared, without reading it", async () => {
      const home = await newHome();
      const copy = path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD);
      await writeFile(copy, "a copy cut short");
      vi.mocked(readFile).mockClear();

      const { out, leftOut } = await build(home);

      expect(leftOut).toEqual([
        `${FIRST_WORD_PATH}: not published: it no longer matches its fingerprint`,
      ]);
      expect(existsSync(path.join(out, FIXTURE_FOLDER, FIRST_WORD))).toBe(false);
      // lstat says how long it is, which isn't the recorded size: it's a change, and it's left unread.
      expect(pathsRead()).not.toContain(copy);
    });

    it("leaves out a copy whose recorded size isn't its size, though its SHA-256 is the recorded one, without reading it", async () => {
      const home = await newHome();
      const page = Buffer.from(EXAMPLE_PAGE);
      // A record that says the page is a byte longer than it is, and gives the fingerprint it has.
      await writeRecord(path.join(home, EXAMPLE_FOLDER), [
        sealedEntry(1, EXAMPLE_AT, [
          { ...recordOf(`${EXAMPLE_STEM}.html`, page), bytes: page.length + 1 },
          recordOf(`${EXAMPLE_STEM}.docx`, EXAMPLE_WORD),
        ]),
      ]);
      vi.mocked(readFile).mockClear();

      const { out, leftOut } = await build(home);

      expect(leftOut).toEqual([
        `${EXAMPLE_FOLDER}/share/${EXAMPLE_STEM}.html: not published: it no longer matches its fingerprint`,
      ]);
      expect(existsSync(path.join(out, EXAMPLE_FOLDER, `${EXAMPLE_STEM}.html`))).toBe(false);
      expect(existsSync(path.join(out, EXAMPLE_FOLDER, `${EXAMPLE_STEM}.docx`))).toBe(true);
      expect(pathsRead()).not.toContain(
        path.join(home, EXAMPLE_FOLDER, "share", `${EXAMPLE_STEM}.html`),
      );
    });

    it("reads a copy of the recorded size once, and leaves it out when its bytes aren't the recorded ones", async () => {
      const home = await newHome();
      const copy = path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD);
      await changeAByte(copy);
      vi.mocked(readFile).mockClear();

      const { leftOut } = await build(home);

      expect(leftOut).toEqual([
        `${FIRST_WORD_PATH}: not published: it no longer matches its fingerprint`,
      ]);
      expect(pathsRead().filter((read) => read === copy)).toHaveLength(1);
    });

    // A file another program holds (EBUSY), a name the system won't take (ENAMETOOLONG), or one this
    // account may not read (EACCES) is a file that can't be published, and no reason to stop the
    // build: every report that needs no such file is still the site's.
    it.each([["EBUSY"], ["ENAMETOOLONG"], ["EACCES"]])(
      "leaves out a copy that can't be read (%s), names it, and builds the rest",
      async (code) => {
        const home = await newHome();
        const copy = path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD);
        const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
        vi.mocked(readFile).mockImplementation((async (file: string, options?: never) =>
          file === copy
            ? Promise.reject(Object.assign(new Error(`${code}: can't be read`), { code }))
            : real.readFile(file, options)) as typeof readFile);

        const { out, content, leftOut, logger } = await build(home);

        const line = `${FIRST_WORD_PATH}: not published: it couldn't be read (${code})`;
        expect(leftOut).toEqual([line]);
        expect(warned(logger)).toEqual([line]);
        expect(existsSync(path.join(out, FIXTURE_FOLDER, FIRST_WORD))).toBe(false);
        // On the site it's missing, and the rest of its report is published, and every other.
        const report = content.sites[0]?.reports.find(({ id }) => id.endsWith("-1"));
        expect(report?.notPublished).toEqual([{ name: FIRST_WORD, reason: "missing" }]);
        expect(report?.files).toHaveLength(3);
        for (const { name } of report?.files ?? []) {
          expect(existsSync(path.join(out, FIXTURE_FOLDER, name))).toBe(true);
        }
        expect(await readFile(path.join(out, "index.html"), "utf8")).toContain(
          goneLine(FIRST_WORD, "missing"),
        );
        expect(content.demo?.files).toHaveLength(4);
      },
    );

    it("leaves out a copy that can't be read for a reason with no code, and says so without one", async () => {
      const home = await newHome();
      const copy = path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD);
      const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
      vi.mocked(readFile).mockImplementation((async (file: string, options?: never) =>
        file === copy
          ? Promise.reject(new Error("something nobody expected"))
          : real.readFile(file, options)) as typeof readFile);

      const { leftOut } = await build(home);

      expect(leftOut).toEqual([`${FIRST_WORD_PATH}: not published: it couldn't be read`]);
    });

    it("leaves out a copy that can't even be looked at, as one that can't be read", async () => {
      const home = await newHome();
      const copy = path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD);
      const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
      vi.mocked(lstat).mockImplementation(((file: string) =>
        file === copy
          ? Promise.reject(
              Object.assign(new Error("ENAMETOOLONG: name too long"), { code: "ENAMETOOLONG" }),
            )
          : real.lstat(file)) as typeof lstat);

      const { out, leftOut } = await build(home);

      expect(leftOut).toEqual([
        `${FIRST_WORD_PATH}: not published: it couldn't be read (ENAMETOOLONG)`,
      ]);
      expect(existsSync(path.join(out, "index.html"))).toBe(true);
    });

    it("takes a copy that is gone by the time it's read for a missing one", async () => {
      const home = await newHome();
      const copy = path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD);
      const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
      vi.mocked(readFile).mockImplementation((async (file: string, options?: never) =>
        file === copy
          ? Promise.reject(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }))
          : real.readFile(file, options)) as typeof readFile);

      const { leftOut } = await build(home);

      expect(leftOut).toEqual([`${FIRST_WORD_PATH}: not published: the file is missing`]);
    });

    it("leaves out a missing copy, and names it", async () => {
      const home = await newHome();
      await rm(path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD));

      const { out, content, leftOut, logger } = await build(home);

      const line = `${FIRST_WORD_PATH}: not published: the file is missing`;
      expect(leftOut).toEqual([line]);
      expect(warned(logger)).toEqual([line]);
      expect(existsSync(path.join(out, FIXTURE_FOLDER, FIRST_WORD))).toBe(false);
      expect(await readFile(path.join(out, "index.html"), "utf8")).toContain(
        goneLine(FIRST_WORD, "missing"),
      );
      expect(content.sites[0]?.reports.find(({ id }) => id.endsWith("-1"))?.notPublished).toEqual([
        { name: FIRST_WORD, reason: "missing" },
      ]);
    });

    it("leaves out an entry changed since it was recorded, and names it", async () => {
      const home = await newHome();
      // The first share's entry, with its seal as it was and its `by` changed.
      const siteDir = path.join(home, FIXTURE_FOLDER);
      const { shares } = await readShares(siteDir);
      await writeRecord(siteDir, [{ ...shares[0], by: "Someone Else" }, shares[1]]);

      const { out, content, leftOut, logger } = await build(home);

      const line = `${FIXTURE_FOLDER}/share/shares.json: share 1 (${isoLocal(SHARED_ON)}) changed since it was recorded`;
      expect(leftOut).toEqual([line]);
      expect(warned(logger)).toEqual([line]);
      // Its site's other entry is published, and what only the left-out entry names is not.
      expect(content.sites[0]?.reports.map(({ id }) => id)).toEqual([`report-${FIXTURE_FOLDER}-2`]);
      expect(
        existsSync(path.join(out, FIXTURE_FOLDER, `${FIXTURE_FOLDER}_2027-01-15-2.html`)),
      ).toBe(true);
      expect(existsSync(path.join(out, FIXTURE_FOLDER, `${FIXTURE_FOLDER}_2027-01-15.html`))).toBe(
        false,
      );
    });

    it("keeps a report whose every file is left out, with only its isn't-here lines", async () => {
      const home = await newHome();
      const share = path.join(home, EXAMPLE_FOLDER, "share");
      await changeAByte(path.join(share, `${EXAMPLE_STEM}.html`));
      await rm(path.join(share, `${EXAMPLE_STEM}.docx`));

      const { out, content, leftOut } = await build(home);

      expect(content.sites[1]?.reports).toEqual([
        {
          folder: EXAMPLE_FOLDER,
          id: `report-${EXAMPLE_FOLDER}-1`,
          at: EXAMPLE_AT,
          by: "Sam Rivera",
          files: [],
          notPublished: [
            { name: `${EXAMPLE_STEM}.html`, reason: "changed" },
            { name: `${EXAMPLE_STEM}.docx`, reason: "missing" },
          ],
        },
      ]);
      expect(leftOut).toHaveLength(2);
      const index = await readFile(path.join(out, "index.html"), "utf8");
      expect(index).toContain(goneLine(`${EXAMPLE_STEM}.html`, "changed"));
      expect(index).toContain(goneLine(`${EXAMPLE_STEM}.docx`, "missing"));
      // Nothing of the site was published, so it has no folder.
      expect(existsSync(path.join(out, EXAMPLE_FOLDER))).toBe(false);
    });

    it("leaves out a recorded file that is a folder, and says it isn't a regular file", async () => {
      const home = await newHome();
      const share = path.join(home, FIXTURE_FOLDER, "share");
      await rm(path.join(share, FIRST_WORD));
      await mkdir(path.join(share, FIRST_WORD));
      await writeFile(path.join(share, FIRST_WORD, "inside.txt"), "a file in the folder");

      const { out, content, leftOut, logger } = await build(home);

      const line = `${FIRST_WORD_PATH}: not published: it isn't a regular file`;
      expect(leftOut).toEqual([line]);
      expect(warned(logger)).toEqual([line]);
      expect(existsSync(path.join(out, FIXTURE_FOLDER, FIRST_WORD))).toBe(false);
      // On the site it's missing: that is the nearer of its two ways to be left out.
      expect(content.sites[0]?.reports.find(({ id }) => id.endsWith("-1"))?.notPublished).toEqual([
        { name: FIRST_WORD, reason: "missing" },
      ]);
      expect(await readFile(path.join(out, "index.html"), "utf8")).toContain(
        goneLine(FIRST_WORD, "missing"),
      );
    });

    // A name never says what is at it: a device has a name like CON or NUL on Windows, and a link
    // could lead anywhere. So a file is read only when lstat says it's a regular file. Here lstat says
    // it's something else of a file that is a regular one, with the recorded bytes, so that a build
    // which read it all the same would publish it.
    it.each<[string, Partial<Record<keyof Stats, true>>]>([
      ["a link", { isSymbolicLink: true }],
      ["a device that gives characters, as CON and NUL do", { isCharacterDevice: true }],
      ["a device that gives blocks", { isBlockDevice: true }],
      ["a pipe", { isFIFO: true }],
      ["a socket", { isSocket: true }],
      ["a folder", { isDirectory: true }],
    ])("reads nothing that lstat says is %s", async (_kind, says) => {
      const home = await newHome();
      const target = path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD);
      const asked = (kind: keyof Stats) => (says[kind] === true ? () => true : () => false);
      const stats = {
        isFile: asked("isFile"),
        isDirectory: asked("isDirectory"),
        isSymbolicLink: asked("isSymbolicLink"),
        isCharacterDevice: asked("isCharacterDevice"),
        isBlockDevice: asked("isBlockDevice"),
        isFIFO: asked("isFIFO"),
        isSocket: asked("isSocket"),
        size: 0,
      } as unknown as Stats;
      const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
      vi.mocked(lstat).mockImplementation(((file: string) =>
        file === target ? Promise.resolve(stats) : real.lstat(file)) as typeof lstat);
      vi.mocked(readFile).mockClear();

      const { out, content, leftOut } = await build(home);

      expect(leftOut).toEqual([`${FIRST_WORD_PATH}: not published: it isn't a regular file`]);
      expect(existsSync(path.join(out, FIXTURE_FOLDER, FIRST_WORD))).toBe(false);
      expect(pathsRead()).not.toContain(target);
      expect(content.sites[0]?.reports.find(({ id }) => id.endsWith("-1"))?.notPublished).toEqual([
        { name: FIRST_WORD, reason: "missing" },
      ]);
    });

    it("never reads a file through a link, even to bytes that are the recorded ones", async ({
      skip,
    }) => {
      const home = await newHome();
      const share = path.join(home, FIXTURE_FOLDER, "share");
      const link = path.join(share, FIRST_WORD);
      // The recorded bytes, in a file outside the record's folder, and a link where the copy was.
      const outside = path.join(path.dirname(home), "outside.docx");
      await writeFile(outside, await readFile(link));
      await rm(link);
      try {
        await symlink(outside, link, "file");
      } catch (error) {
        // Windows makes a link to a file only with a privilege that most accounts don't have.
        if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          skip("This account can't make a link to a file.");
        }
        throw error;
      }
      vi.mocked(readFile).mockClear();

      const { out, leftOut } = await build(home);

      expect(leftOut).toEqual([`${FIRST_WORD_PATH}: not published: it isn't a regular file`]);
      expect(existsSync(path.join(out, FIXTURE_FOLDER, FIRST_WORD))).toBe(false);
      expect(pathsRead()).not.toContain(link);
    });

    it("never reads a folder link, as a junction on Windows is, and builds the rest", async () => {
      const home = await newHome();
      const share = path.join(home, FIXTURE_FOLDER, "share");
      const link = path.join(share, FIRST_WORD);
      const target = path.join(path.dirname(home), "somewhere");
      await mkdir(target);
      await writeFile(path.join(target, "inside.txt"), "a file in the folder");
      await rm(link);
      await linkToFolder(target, link);
      vi.mocked(readFile).mockClear();

      const { out, leftOut } = await build(home);

      expect(leftOut).toEqual([`${FIRST_WORD_PATH}: not published: it isn't a regular file`]);
      expect(existsSync(path.join(out, FIXTURE_FOLDER, FIRST_WORD))).toBe(false);
      expect(pathsRead()).not.toContain(link);
      expect(existsSync(path.join(out, "index.html"))).toBe(true);
    });

    it("never reads or publishes a file a record names outside its folder, and publishes the rest", async () => {
      const home = await newHome();
      const siteDir = path.join(home, EXAMPLE_FOLDER);
      // A file above the record's folder, whose bytes are the ones the entry records for it.
      const secret = Buffer.from("something that was never shared");
      const outside = path.join(siteDir, "outside.html");
      await writeFile(outside, secret);
      const names = [
        "../outside.html",
        "../../transcripts/.gitignore",
        "/etc/hostname",
        "a\\b.html",
      ];
      const page = Buffer.from(EXAMPLE_PAGE);
      await writeRecord(siteDir, [
        sealedEntry(1, EXAMPLE_AT, [
          recordOf(`${EXAMPLE_STEM}.html`, page),
          ...names.map((name) => recordOf(name, secret)),
        ]),
      ]);
      vi.mocked(readFile).mockClear();

      const { out, content, leftOut } = await build(home);

      const where = `${EXAMPLE_FOLDER}/share/shares.json: share 1 (${EXAMPLE_AT})`;
      expect(leftOut).toEqual(
        names.map(
          (name) =>
            `${where} names ${JSON.stringify(name)}, which isn't a file voicecap would publish`,
        ),
      );
      // None of it is in the site, whatever its name would lead to, and none was read.
      for (const found of await filesUnder(out)) {
        expect(await readFile(path.join(out, found))).not.toEqual(secret);
      }
      const reads = pathsRead();
      expect(reads).not.toContain(outside);
      expect(reads.filter((read) => read.endsWith("hostname"))).toEqual([]);
      // The entry's other file is published.
      expect(content.sites[1]?.reports[0]?.files.map(({ name }) => name)).toEqual([
        `${EXAMPLE_STEM}.html`,
      ]);
      expect(existsSync(path.join(out, EXAMPLE_FOLDER, `${EXAMPLE_STEM}.html`))).toBe(true);
    });

    it("never publishes a file named index.html, which Netlify serves at its site's folder with no policy of its own, and publishes the rest", async () => {
      const home = await newHome();
      const siteDir = path.join(home, EXAMPLE_FOLDER);
      // The folder holds it, with the bytes the entry records for it: only its name leaves it out.
      const page = Buffer.from(EXAMPLE_PAGE);
      await writeFile(path.join(siteDir, "share", "index.html"), page);
      await writeRecord(siteDir, [
        sealedEntry(1, EXAMPLE_AT, [
          recordOf(`${EXAMPLE_STEM}.html`, page),
          recordOf("index.html", page),
          recordOf(`${EXAMPLE_STEM}.docx`, EXAMPLE_WORD),
        ]),
      ]);
      vi.mocked(readFile).mockClear();

      const { out, content, leftOut } = await build(home);

      expect(leftOut).toEqual([
        `${EXAMPLE_FOLDER}/share/shares.json: share 1 (${EXAMPLE_AT}) names "index.html", which isn't a file voicecap would publish`,
      ]);
      expect(existsSync(path.join(out, EXAMPLE_FOLDER, "index.html"))).toBe(false);
      expect(pathsRead()).not.toContain(path.join(siteDir, "share", "index.html"));
      expect(content.sites[1]?.reports[0]?.files.map(({ name }) => name)).toEqual([
        `${EXAMPLE_STEM}.html`,
        `${EXAMPLE_STEM}.docx`,
      ]);
      // _headers has the rules of the page that is published, and none for one named index.html.
      const paths = readHeaders(await readFile(path.join(out, "_headers"), "utf8")).rules.map(
        ([rulePath]) => rulePath,
      );
      expect(paths).toContain(`/${EXAMPLE_FOLDER}/${EXAMPLE_STEM}.html`);
      expect(paths).not.toContain(`/${EXAMPLE_FOLDER}/index.html`);
    });

    it("leaves out what a site's record can't give, and builds the other sites", async () => {
      const home = await newHome();
      // A record that isn't JSON, and a site folder named as voicecap never names one.
      await writeFile(path.join(home, EXAMPLE_FOLDER, "share", "shares.json"), "{ not json");
      await mkdir(path.join(home, "my site", "2027-01-12"), { recursive: true });

      const { content, leftOut, logger } = await build(home);

      expect(content.sites.map(({ name }) => name)).toEqual([FIXTURE_FOLDER]);
      expect(leftOut).toEqual([
        `${EXAMPLE_FOLDER}/share/shares.json: not a readable record of what was shared`,
        "my site: not published: its name isn't one voicecap gives a site's folder",
      ]);
      expect(warned(logger)).toEqual(leftOut);
    });

    it("says what it leaves out in the order met: the records' lines, then its own, before the summary", async () => {
      const home = await newHome();
      const share = path.join(home, FIXTURE_FOLDER, "share");
      // The build's own lines, in the order of the records: the first share's Word copy changed, the
      // second's missing, and the demo's changed. The records' line: the site written by hand has an
      // entry that changed since it was recorded.
      await changeAByte(path.join(share, FIRST_WORD));
      await rm(path.join(share, `${FIXTURE_FOLDER}_2027-01-15-2.docx`));
      const demoShare = path.join(home, DEMO_OUT, FIXTURE_FOLDER, "share");
      await changeAByte(path.join(demoShare, `${FIXTURE_FOLDER}_2027-01-16.docx`));
      const example = path.join(home, EXAMPLE_FOLDER);
      const [entry] = (await readShares(example)).shares;
      await writeRecord(example, [{ ...entry, by: "Someone Else" }]);

      const { leftOut, logger } = await build(home);

      expect(leftOut).toEqual([
        `${EXAMPLE_FOLDER}/share/shares.json: share 1 (${EXAMPLE_AT}) changed since it was recorded`,
        `${FIRST_WORD_PATH}: not published: it no longer matches its fingerprint`,
        `${FIXTURE_FOLDER}/share/${FIXTURE_FOLDER}_2027-01-15-2.docx: not published: the file is missing`,
        `${DEMO_OUT}/${FIXTURE_FOLDER}/share/${FIXTURE_FOLDER}_2027-01-16.docx: not published: it no longer matches its fingerprint`,
      ]);
      // Each is warned, in that order, and the summary is said after them all.
      expect(warned(logger)).toEqual(leftOut);
      const last = logger.entries.at(-1);
      expect(last?.level).toBe("info");
      expect(last?.message).toMatch(/^Built the site in /);
      expect(logger.entries.slice(0, -1).filter(({ level }) => level === "info")).toHaveLength(2);
      const lastWarning = logger.entries.findLastIndex(({ level }) => level === "warn");
      expect(lastWarning).toBe(logger.entries.length - 2);
    });

    it("leaves out a site folder named as one of the site's own files, and builds the rest", async () => {
      const home = await newHome();
      for (const folder of ["index.html", "robots.txt", "_headers"]) {
        const siteDir = path.join(home, folder);
        const page = Buffer.from(`<!doctype html><title>${folder}</title>`);
        await mkdir(path.join(siteDir, "2027-01-12"), { recursive: true });
        await mkdir(path.join(siteDir, "share"), { recursive: true });
        await writeFile(path.join(siteDir, "share", `${folder}_1.html`), page);
        await writeRecord(siteDir, [
          sealedEntry(1, EXAMPLE_AT, [recordOf(`${folder}_1.html`, page)]),
        ]);
      }

      const { out, content, leftOut } = await build(home);

      expect(content.sites.map(({ name }) => name)).toEqual([FIXTURE_FOLDER, EXAMPLE_FOLDER]);
      expect(leftOut).toEqual(
        ["_headers", "index.html", "robots.txt"].map(
          (folder) =>
            `${folder}: not published: a site folder named ${folder} would take the place of the site's own ${folder}`,
        ),
      );
      // The site's own files are its own.
      expect(await readFile(path.join(out, "robots.txt"), "utf8")).toBe(ROBOTS_TXT);
      expect(
        (await readFile(path.join(out, "index.html"), "utf8")).startsWith("<!doctype html>\n<html"),
      ).toBe(true);
      expect(
        (await readFile(path.join(out, "_headers"), "utf8")).startsWith(HEADERS_FIRST_LINE),
      ).toBe(true);
    });

    it("leaves out a voicecap-demo that is a file, names it, and builds the sites", async () => {
      const home = await newHome();
      // Git for Windows checks a committed link out as a plain file.
      await rm(path.join(home, DEMO_OUT), { recursive: true });
      await writeFile(path.join(home, DEMO_OUT), "a file where the demo's folder should be");

      const { out, content, leftOut, logger } = await build(home);

      const line = `${DEMO_OUT}: not published: it isn't a folder`;
      expect(leftOut).toEqual([line]);
      expect(warned(logger)).toEqual([line]);
      expect(content.demo).toBeNull();
      expect(content.sites.map(({ name }) => name)).toEqual([FIXTURE_FOLDER, EXAMPLE_FOLDER]);
      expect(existsSync(path.join(out, FIXTURE_FOLDER, `${FIXTURE_FOLDER}_2027-01-15.html`))).toBe(
        true,
      );
      expect(existsSync(path.join(out, DEMO_SITE))).toBe(false);
      expect(logger.entries.at(-1)?.message).toBe(
        `Built the site in ${out}: 3 reports from 2 sites.`,
      );
    });

    it("writes each line it adds without what a terminal would act on", async () => {
      const home = await newHome();
      const dir = path.join(home, "lines", "share");
      // A name no record of voicecap's would give, as a reader that failed to vet it would pass it
      // on: a line separator, which ends a line, and the escape that starts red text. Braced
      // escapes, so that this file holds no raw control character.
      const name = "a\u{2028}b\u{1b}[31m.html";
      const bytes = Buffer.from("x");
      vi.mocked(readSiteRecords).mockResolvedValueOnce({
        sites: [
          {
            folder: "lines",
            entries: [
              {
                folder: "lines",
                dir,
                seq: 1,
                at: EXAMPLE_AT,
                by: "Sam Rivera",
                site: null,
                files: [recordOf(name, bytes)],
              },
            ],
          },
        ],
        demo: null,
        leftOut: [],
      });

      const { leftOut, logger } = await build(home);

      const line = "lines/share/a\\u2028b\\u001b[31m.html: not published: the file is missing";
      expect(leftOut).toEqual([line]);
      expect(warned(logger)).toEqual([line]);
      expect(leftOut.join("")).not.toMatch(/[\p{Cc}\u{2028}\u{2029}]/u);
    });
  });

  describe("the folder it builds in", () => {
    it("builds in _site in the home when it's given no folder", async () => {
      const home = await newHome();

      const { out } = await build(home);

      expect(out).toBe(path.join(home, "_site"));
      expect(existsSync(path.join(out, "index.html"))).toBe(true);
    });

    it("builds in the folder it's given, made if it isn't there, relative to the current folder", async () => {
      const home = await newHome();
      const cwd = path.dirname(home);

      const { out } = await build(home, { home: "transcripts", out: "elsewhere/the-site" });

      expect(out).toBe(path.join(cwd, "elsewhere", "the-site"));
      expect(existsSync(path.join(out, "index.html"))).toBe(true);
      expect(existsSync(path.join(home, "_site"))).toBe(false);
    });

    it.skipIf(process.platform !== "win32")(
      "reads a Windows folder written the way Git Bash writes it",
      async () => {
        const home = await newHome();
        const target = path.join(await newFolder(), "site");
        const asGitBash = `/${target[0]!.toLowerCase()}${target.slice(2).split(path.sep).join("/")}`;

        const { out } = await build(home, { out: asGitBash });

        expect(out).toBe(target);
        expect(existsSync(path.join(target, "index.html"))).toBe(true);
      },
    );

    it("refuses to build into the home, a folder holding it, a site's folder, or a folder of other files, and deletes nothing", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      // A folder of other files outside the home, one inside it, and a file.
      const other = path.join(root, "other");
      await mkdir(path.join(other, "deeper"), { recursive: true });
      await writeFile(path.join(other, "notes.txt"), "the owner's notes");
      await writeFile(path.join(other, "deeper", "more.txt"), "more of them");
      const notes = path.join(home, "notes");
      await mkdir(notes);
      await writeFile(path.join(notes, "a.txt"), "a note in the home");
      // A folder that has a _headers, though not the one a build writes.
      const theirs = path.join(root, "theirs");
      await mkdir(theirs);
      await writeFile(path.join(theirs, "_headers"), "/*\n  X-Their-Header: yes\n");
      await writeFile(path.join(theirs, "page.html"), "their page");
      const aFile = path.join(root, "a-file.txt");
      await writeFile(aFile, "a file, not a folder");
      // Folders that look as a build left them, with a _headers that starts with a build's first line,
      // and hold more than a build writes: a repository's .git; a site of its own, with its date
      // folder and its record; a dot-file in a folder of files; and all of that in one.
      const withGit = await builtWith(path.join(root, "built-with-git"), {
        ".git/HEAD": "ref: refs/heads/main\n",
      });
      const withSites = await builtWith(path.join(root, "built-with-sites"), {
        "other.illinois.gov/2027-01-12": null,
        "other.illinois.gov/share/shares.json": "{ }",
      });
      const withDotFile = await builtWith(path.join(root, "built-with-a-dot-file"), {
        "dvfr.illinois.gov/page.html": "a page",
        "dvfr.illinois.gov/.env": "SECRET=1",
      });
      const withAll = await builtWith(path.join(root, "built-with-all-of-it"), {
        ".git/HEAD": "ref: refs/heads/main\n",
        "other.illinois.gov/2027-01-12": null,
        "other.illinois.gov/share/shares.json": "{ }",
      });
      // A build, then `git init` in its folder, as someone keeps a built site in Git.
      const gitBuilt = path.join(root, "built-then-git");
      if (gitAvailable) {
        await build(home, { out: gitBuilt });
        expect(git(["init"], gitBuilt)).toBe(0);
      }

      const inASite = "it's inside a site's folder, where its records are";
      const inTheDemo = "it's inside voicecap-demo, where the demo's records are";
      const notBuilt = "it isn't empty, and voicecap site didn't build it";
      const holdsGit = "it holds .git, which a build never writes";
      const cases: [out: string, why: string][] = [
        [home, "it's the transcripts home itself"],
        [root, "it holds the transcripts home"],
        [path.join(home, FIXTURE_FOLDER), inASite],
        [path.join(home, FIXTURE_FOLDER, "share"), inASite],
        // A folder that isn't there yet, in a site's folder: and one whose name starts with two dots,
        // which is in it all the same.
        [path.join(home, FIXTURE_FOLDER, "_site"), inASite],
        [path.join(home, FIXTURE_FOLDER, "..cache"), inASite],
        [path.join(home, EXAMPLE_FOLDER), inASite],
        [path.join(home, DEMO_OUT), inTheDemo],
        [path.join(home, DEMO_OUT, FIXTURE_FOLDER, "share"), inTheDemo],
        [other, notBuilt],
        [path.join(other, "deeper"), notBuilt],
        [notes, notBuilt],
        [theirs, notBuilt],
        [aFile, "it's a file, not a folder"],
        // It looks built, and holds more than a build writes.
        [withGit, holdsGit],
        [
          withSites,
          "it holds other.illinois.gov/2027-01-12, a folder inside a folder, which a build never writes",
        ],
        [withDotFile, "it holds dvfr.illinois.gov/.env, which a build never writes"],
        [withAll, holdsGit],
        ...(gitAvailable ? ([[gitBuilt, holdsGit]] as [string, string][]) : []),
      ];
      for (const [out, why] of cases) {
        const before = await treeOf(root);
        vi.mocked(rm).mockClear();

        const message = await refusalOf(build(home, { out }));

        expect(message).toBe(
          `voicecap site won't build into ${out}: ${why}. Give a folder of its own, such as "${path.join(home, "_site")}".`,
        );
        // Nothing was removed, written, or made: every file is as it was.
        expect(vi.mocked(rm)).not.toHaveBeenCalled();
        expect(await treeOf(root)).toEqual(before);
      }
    });

    it("refuses a link as the folder it leads to is, a new folder under it too, and deletes nothing", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      // The links are in a folder of their own, so that a link to the folder the home is in leads to
      // a folder that holds them neither.
      const links = await newFolder();
      const inASite = "it's inside a site's folder, where its records are";
      const inTheDemo = "it's inside voicecap-demo, where the demo's records are";
      const cases: [leadsTo: string, below: string, why: string][] = [
        [home, "", "it's the transcripts home itself"],
        [root, "", "it holds the transcripts home"],
        [path.join(home, FIXTURE_FOLDER), "", inASite],
        [path.join(home, FIXTURE_FOLDER, "share"), "", inASite],
        [path.join(home, DEMO_OUT), "", inTheDemo],
        // A folder that isn't there yet, under a link to a site's folder.
        [path.join(home, FIXTURE_FOLDER), "_site", inASite],
      ];
      for (const [index, [leadsTo, below, why]] of cases.entries()) {
        const link = path.join(links, `link-${index}`);
        await linkToFolder(leadsTo, link);
        const out = path.join(link, below);
        const before = [await treeOf(root), await treeOf(links)];
        vi.mocked(rm).mockClear();

        const message = await refusalOf(build(home, { out }));

        expect(message).toBe(
          `voicecap site won't build into ${out}: ${why}. Give a folder of its own, such as "${path.join(home, "_site")}".`,
        );
        expect(vi.mocked(rm)).not.toHaveBeenCalled();
        expect([await treeOf(root), await treeOf(links)]).toEqual(before);
      }
    });

    it("refuses a folder in the demo's records when the demo's folder is itself a link", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      // The demo's records are somewhere else, and voicecap-demo in the home leads to them.
      const elsewhere = path.join(root, "demo-records");
      await rename(path.join(home, DEMO_OUT), elsewhere);
      await linkToFolder(elsewhere, path.join(home, DEMO_OUT));
      const out = path.join(elsewhere, FIXTURE_FOLDER, "share");
      const before = await treeOf(root);
      vi.mocked(rm).mockClear();

      const message = await refusalOf(build(home, { out }));

      expect(message).toBe(
        `voicecap site won't build into ${out}: it's inside voicecap-demo, where the demo's records are. Give a folder of its own, such as "${path.join(home, "_site")}".`,
      );
      expect(vi.mocked(rm)).not.toHaveBeenCalled();
      expect(await treeOf(root)).toEqual(before);
    });

    it("refuses a link to the home as the home even when the home has a _headers of a build's", async () => {
      // The one thing that would take the home for a folder to empty: a _headers that starts with a
      // build's line. By name the link isn't the home, so only where it leads says what it is.
      const home = await newHome();
      await writeFile(path.join(home, "_headers"), `${HEADERS_FIRST_LINE}\n`);
      const link = path.join(await newFolder(), "link-to-the-home");
      await linkToFolder(home, link);
      const before = await treeOf(path.dirname(home));
      vi.mocked(rm).mockClear();

      const message = await refusalOf(build(home, { out: link }));

      expect(message).toBe(
        `voicecap site won't build into ${link}: it's the transcripts home itself. Give a folder of its own, such as "${path.join(home, "_site")}".`,
      );
      expect(vi.mocked(rm)).not.toHaveBeenCalled();
      expect(await treeOf(path.dirname(home))).toEqual(before);
    });

    it("writes the name of what it refuses a folder for without what a terminal would act on", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      // Names with a line separator in them, which ends a line: braced escapes, so that this file
      // holds no raw control character. The message writes it as a backslash, "u", and four digits.
      const written = "\\" + "u2028";
      const cases: [more: Record<string, string | null>, said: string][] = [
        // A name with a dot first, in the folder itself.
        [{ ".\u{2028}x": "a file" }, `.${written}x, which a build never writes`],
        // The same in a folder of files, whose own name has one too.
        [
          { "a\u{2028}site/.\u{2028}x": "a file" },
          `a${written}site/.${written}x, which a build never writes`,
        ],
        // A folder in a folder.
        [
          { "a\u{2028}site/in\u{2028}side": null },
          `a${written}site/in${written}side, a folder inside a folder, which a build never writes`,
        ],
      ];
      for (const [index, [more, said]] of cases.entries()) {
        const out = await builtWith(path.join(root, `built-with-odd-names-${index}`), more);

        const message = await refusalOf(build(home, { out }));

        expect(message).toBe(
          `voicecap site won't build into ${out}: it holds ${said}. Give a folder of its own, such as "${path.join(home, "_site")}".`,
        );
        expect(message).not.toMatch(/[\p{Cc}\u{2028}\u{2029}]/u);
      }
    });

    it("refuses the home by where it really is when the home is given as a link to it", async () => {
      // The home is reached through a link, and the folder to build in is the home by its own name:
      // by name they aren't one folder, and where each really is says they are.
      const home = await newHome();
      const link = path.join(await newFolder(), "link-to-the-home");
      await linkToFolder(home, link);
      const before = await treeOf(path.dirname(home));
      vi.mocked(rm).mockClear();

      const message = await refusalOf(build(link, { out: home }));

      expect(message).toBe(
        `voicecap site won't build into ${home}: it's the transcripts home itself. Give a folder of its own, such as "${path.join(link, "_site")}".`,
      );
      expect(vi.mocked(rm)).not.toHaveBeenCalled();
      expect(await treeOf(path.dirname(home))).toEqual(before);
    });

    it("builds in _site of a home that is given as a link to it, and refuses nothing for the link", async () => {
      const home = await newHome();
      const link = path.join(await newFolder(), "link-to-the-home");
      await linkToFolder(home, link);

      const { out, content } = await build(link);

      expect(out).toBe(path.join(link, "_site"));
      expect(existsSync(path.join(home, "_site", "index.html"))).toBe(true);
      expect(content.sites.map(({ name }) => name)).toEqual([FIXTURE_FOLDER, EXAMPLE_FOLDER]);
    });

    it("empties a built folder that holds a link, and leaves what the link leads to as it was", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      const first = await build(home);
      // Somebody's own folder, which a link in the built folder, and one in a folder of the site's,
      // lead to. A build never follows a link: the link is removed, and nothing it leads to.
      const precious = path.join(root, "precious");
      await mkdir(path.join(precious, "inner"), { recursive: true });
      await writeFile(path.join(precious, "mine.txt"), "my own file");
      await writeFile(path.join(precious, "inner", "also-mine.txt"), "my other file");
      const topLink = path.join(first.out, "a-link");
      const innerLink = path.join(first.out, FIXTURE_FOLDER, "another-link");
      await linkToFolder(precious, topLink);
      await linkToFolder(precious, innerLink);
      const before = await treeOf(precious);

      const second = await build(home);

      expect(second.out).toBe(first.out);
      expect(existsSync(topLink)).toBe(false);
      expect(existsSync(innerLink)).toBe(false);
      expect(await treeOf(precious)).toEqual(before);
      expect(await readFile(path.join(precious, "inner", "also-mine.txt"), "utf8")).toBe(
        "my other file",
      );
    });

    it("names the files macOS and Windows add to a folder someone opens, which verify and the build share", () => {
      expect([...OS_LITTER].sort()).toEqual([".DS_Store", "Thumbs.db", "desktop.ini"]);
    });

    // Opening _site in Finder or Explorer adds one of these to it, and to the folders in it. They hold
    // nothing anyone made, so the next build empties them with the rest, and doesn't refuse the folder.
    it.each([...OS_LITTER])(
      "empties and rebuilds a built folder that holds %s, at its top and inside a site's folder",
      async (name) => {
        const home = await newHome();
        const first = await build(home);
        const files = await filesUnder(first.out);
        const atTheTop = path.join(first.out, name);
        const inASite = path.join(first.out, FIXTURE_FOLDER, name);
        await writeFile(atTheTop, "how the system shows the folder");
        await writeFile(inASite, "how the system shows a folder of the site's");
        vi.mocked(rm).mockClear();

        const second = await build(home);

        expect(second.out).toBe(first.out);
        expect(existsSync(atTheTop)).toBe(false);
        expect(existsSync(inASite)).toBe(false);
        // Rebuilt whole: exactly what the first build made.
        expect(await filesUnder(second.out)).toEqual(files);
        expect(vi.mocked(rm)).toHaveBeenCalledWith(second.out, {
          recursive: true,
          force: true,
          maxRetries: 3,
        });
      },
    );

    it("still refuses a built folder that holds .git, beside the files an operating system adds", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      const out = await builtWith(path.join(root, "built-with-git-and-litter"), {
        ".DS_Store": "how the system shows the folder",
        "dvfr.illinois.gov/page.html": "a page",
        "dvfr.illinois.gov/Thumbs.db": "how the system shows a folder of the site's",
        ".git/HEAD": "ref: refs/heads/main\n",
      });
      const before = await treeOf(root);
      vi.mocked(rm).mockClear();

      const message = await refusalOf(build(home, { out }));

      // The litter isn't what it refuses for, and doesn't hide what it does.
      expect(message).toBe(
        `voicecap site won't build into ${out}: it holds .git, which a build never writes. Give a folder of its own, such as "${path.join(home, "_site")}".`,
      );
      expect(vi.mocked(rm)).not.toHaveBeenCalled();
      expect(await treeOf(root)).toEqual(before);
    });

    it("still refuses what comes after the files an operating system adds, inside a site's folder", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      // The litter comes first in each folder of the site's, and isn't all that's in it: a dot-file
      // of someone's, and a folder of someone's.
      const withADotFile = await builtWith(path.join(root, "built-with-litter-and-a-dot-file"), {
        "dvfr.illinois.gov/.DS_Store": "how the system shows the folder",
        "dvfr.illinois.gov/.env": "SECRET=1",
      });
      const withAFolder = await builtWith(path.join(root, "built-with-litter-and-a-folder"), {
        "dvfr.illinois.gov/.DS_Store": "how the system shows the folder",
        "dvfr.illinois.gov/nested/mine.txt": "my own file",
      });
      const before = await treeOf(root);
      vi.mocked(rm).mockClear();

      const cases: [out: string, said: string][] = [
        [withADotFile, "dvfr.illinois.gov/.env, which a build never writes"],
        [
          withAFolder,
          "dvfr.illinois.gov/nested, a folder inside a folder, which a build never writes",
        ],
      ];
      for (const [out, said] of cases) {
        expect(await refusalOf(build(home, { out }))).toBe(
          `voicecap site won't build into ${out}: it holds ${said}. Give a folder of its own, such as "${path.join(home, "_site")}".`,
        );
      }

      expect(vi.mocked(rm)).not.toHaveBeenCalled();
      expect(await treeOf(root)).toEqual(before);
    });

    it("takes a folder named as one of those files for a folder, and refuses it, at the top and inside a site's folder", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      // Somebody's own folder, named as the files the system adds are: not one of them, and its
      // contents would be lost with it.
      const atTheTop = await builtWith(path.join(root, "built-with-a-folder-named-so"), {
        ".DS_Store/mine.txt": "my own file",
      });
      const inASite = await builtWith(path.join(root, "built-with-one-in-a-site"), {
        "dvfr.illinois.gov/page.html": "a page",
        "dvfr.illinois.gov/.DS_Store/mine.txt": "my own file",
      });
      const before = await treeOf(root);
      vi.mocked(rm).mockClear();

      const cases: [out: string, said: string][] = [
        [atTheTop, ".DS_Store"],
        [inASite, "dvfr.illinois.gov/.DS_Store"],
      ];
      for (const [out, said] of cases) {
        expect(await refusalOf(build(home, { out }))).toBe(
          `voicecap site won't build into ${out}: it holds ${said}, which a build never writes. Give a folder of its own, such as "${path.join(home, "_site")}".`,
        );
      }

      expect(vi.mocked(rm)).not.toHaveBeenCalled();
      expect(await treeOf(root)).toEqual(before);
      expect(await readFile(path.join(atTheTop, ".DS_Store", "mine.txt"), "utf8")).toBe(
        "my own file",
      );
    });

    it("refuses the folder it builds in by default when a site has that folder", async () => {
      const home = await newHome();
      // A site whose host is _site: its records are in the folder a build would empty.
      const siteDir = path.join(home, "_site");
      await mkdir(path.join(siteDir, "2027-01-12"), { recursive: true });
      await writeFile(path.join(siteDir, "latest.txt"), "the site's records");
      const before = await treeOf(path.dirname(home));
      vi.mocked(rm).mockClear();

      expect(await refusalOf(build(home))).toBe(
        `voicecap site won't build into ${siteDir}: it's inside a site's folder, where its records are. Give a folder of its own, such as "${siteDir}".`,
      );

      expect(vi.mocked(rm)).not.toHaveBeenCalled();
      expect(await treeOf(path.dirname(home))).toEqual(before);
    });

    it("refuses the current folder as `.` and its parent as `..`, which are the usual mistakes", async () => {
      const home = await newHome();
      const root = path.dirname(home);
      const before = await treeOf(root);
      vi.mocked(rm).mockClear();

      // Run from the home, `.` is the home. Run from the folder it's in, `.` holds it.
      expect(await refusalOf(build(home, { cwd: home, out: "." }))).toContain(
        `won't build into ${home}: it's the transcripts home itself.`,
      );
      expect(await refusalOf(build(home, { cwd: home, out: ".." }))).toContain(
        `won't build into ${root}: it holds the transcripts home.`,
      );
      expect(await refusalOf(build(home, { cwd: root, out: "." }))).toContain(
        `won't build into ${root}: it holds the transcripts home.`,
      );

      expect(vi.mocked(rm)).not.toHaveBeenCalled();
      expect(await treeOf(root)).toEqual(before);
    });

    it.skipIf(process.platform !== "win32")(
      "sees the home when its letters are written in another case, as Windows does",
      async () => {
        const home = await newHome();
        const before = await treeOf(path.dirname(home));

        expect(await refusalOf(build(home, { out: home.toUpperCase() }))).toContain(
          "it's the transcripts home itself.",
        );

        expect(await treeOf(path.dirname(home))).toEqual(before);
      },
    );

    it.skipIf(process.platform !== "win32")(
      "sees a site's folder and the demo's when their letters are written in another case, as Windows does",
      async () => {
        const home = await newHome();
        const before = await treeOf(path.dirname(home));
        vi.mocked(rm).mockClear();

        expect(
          await refusalOf(build(home, { out: path.join(home, EXAMPLE_FOLDER.toUpperCase()) })),
        ).toContain(": it's inside a site's folder, where its records are.");
        expect(
          await refusalOf(build(home, { out: path.join(home, DEMO_OUT.toUpperCase()) })),
        ).toContain(": it's inside voicecap-demo, where the demo's records are.");

        expect(vi.mocked(rm)).not.toHaveBeenCalled();
        expect(await treeOf(path.dirname(home))).toEqual(before);
      },
    );

    // Windows drops a dot or a space at the end of a name, but Node passes the name on as it is, so
    // a build would make a folder that Windows' own tools can't open or remove.
    it.skipIf(process.platform !== "win32")(
      "refuses a folder whose name ends with a dot or a space, which Windows drops, and makes nothing",
      async () => {
        const home = await newHome();
        const root = path.dirname(home);
        const cases = [
          path.join(root, "the-site."),
          path.join(root, "the-site "),
          path.join(root, "the-site. ."),
          path.join(root, "the-site..."),
          // In the home, where a site's folder or the demo's would be, and in one not there yet.
          path.join(home, `${FIXTURE_FOLDER}.`),
          path.join(home, `${DEMO_OUT}.`),
          path.join(root, "not-there", "the-site."),
        ];
        const before = await treeOf(root);
        vi.mocked(rm).mockClear();

        for (const out of cases) {
          expect(await refusalOf(build(home, { out }))).toBe(
            `voicecap site won't build into ${out}: its name ends with a dot or a space, which Windows drops. Give a folder of its own, such as "${path.join(home, "_site")}".`,
          );
        }
        // Given as a path from the current folder, too.
        expect(await refusalOf(build(home, { out: "the-site." }))).toContain(
          `won't build into ${path.join(root, "the-site.")}: its name ends with a dot or a space, which Windows drops.`,
        );

        expect(vi.mocked(rm)).not.toHaveBeenCalled();
        expect(await treeOf(root)).toEqual(before);
      },
    );

    it("builds in a folder whose name holds a dot or a space, when it doesn't end with one", async () => {
      const home = await newHome();
      const root = path.dirname(home);

      for (const name of ["the.site", "the site", "the-site.d", ".the-site"]) {
        const out = path.join(root, name);

        const built = await build(home, { out });

        expect(built.out).toBe(out);
        expect(existsSync(path.join(out, "index.html"))).toBe(true);
      }
    });

    it("builds in a folder that's there with nothing in it", async () => {
      const home = await newHome();
      const out = path.join(path.dirname(home), "empty");
      await mkdir(out);

      const built = await build(home, { out });

      expect(built.out).toBe(out);
      expect(existsSync(path.join(out, "index.html"))).toBe(true);
    });

    it("refuses a home that isn't a folder, before anything is made", async () => {
      const root = await newFolder();
      const missing = path.join(root, "no-such-home");
      const aFile = path.join(root, "a-file");
      await writeFile(aFile, "not a home");

      for (const home of [missing, aFile]) {
        expect(await refusalOf(build(home, { cwd: root }))).toBe(
          `${home} isn't a folder, so there's no transcripts home to build the site from.`,
        );
      }

      expect(await readdir(root)).toEqual(["a-file"]);
    });

    it("empties a folder it built before", async () => {
      const home = await newHome();
      const first = await build(home);
      // What an earlier build left that this one doesn't make: a file, and a folder of files.
      await writeFile(path.join(first.out, "left-by-an-earlier-build.html"), "stale");
      await mkdir(path.join(first.out, "an-old-site"));
      await writeFile(path.join(first.out, "an-old-site", "old.html"), "stale");
      const files = await filesUnder(first.out);
      vi.mocked(rm).mockClear();

      const second = await build(home);

      expect(second.out).toBe(first.out);
      expect(existsSync(path.join(second.out, "left-by-an-earlier-build.html"))).toBe(false);
      expect(existsSync(path.join(second.out, "an-old-site"))).toBe(false);
      expect(await filesUnder(second.out)).toEqual(
        files.filter(
          (file) => !file.includes("left-by-an-earlier-build") && !file.includes("an-old-site"),
        ),
      );
      // Taken away whole, files and all, retrying a file that's busy.
      expect(vi.mocked(rm)).toHaveBeenCalledWith(second.out, {
        recursive: true,
        force: true,
        maxRetries: 3,
      });
    });

    it("empties a folder an earlier build left only part made", async () => {
      const home = await newHome();
      // A build that fails after its folder is made: the page can't be drawn.
      vi.mocked(renderSiteIndex).mockImplementationOnce(() => {
        throw new Error("The page can't be drawn.");
      });
      const out = path.join(home, "_site");

      await expect(build(home)).rejects.toThrow("The page can't be drawn.");

      // What it made is there, with the first line of _headers, which says a build made it.
      expect(await readFile(path.join(out, "_headers"), "utf8")).toBe(`${HEADERS_FIRST_LINE}\n`);
      expect(existsSync(path.join(out, FIXTURE_FOLDER))).toBe(true);
      expect(existsSync(path.join(out, "index.html"))).toBe(false);

      // So the next build can empty it, and finishes the site.
      const built = await build(home);

      expect(built.out).toBe(out);
      expect(existsSync(path.join(out, "index.html"))).toBe(true);
      expect(
        (await readFile(path.join(out, "_headers"), "utf8")).split("\n").length,
      ).toBeGreaterThan(2);
    });

    it("keeps an earlier build when the records can't be read", async () => {
      const home = await newHome();
      const first = await build(home);
      const before = await treeOf(first.out);
      vi.mocked(readSiteRecords).mockRejectedValueOnce(new Error("The records are held."));

      await expect(build(home)).rejects.toThrow("The records are held.");

      expect(await treeOf(first.out)).toEqual(before);
    });
  });

  describe("netlify.toml and .nvmrc", () => {
    it("writes netlify.toml and .nvmrc into the home once", async () => {
      const home = await newHome();

      const first = await build(home);

      expect(await readFile(path.join(home, "netlify.toml"), "utf8")).toBe(
        netlifyToml(voicecapVersion()),
      );
      expect(await readFile(path.join(home, ".nvmrc"), "utf8")).toBe(NVMRC);
      expect(first.logger.entries.filter(({ level }) => level === "info").slice(0, 2)).toEqual([
        {
          level: "info",
          message: `Wrote netlify.toml into ${home}, for Netlify: commit it with the records.`,
        },
        {
          level: "info",
          message: `Wrote .nvmrc into ${home}, for Netlify: commit it with the records.`,
        },
      ]);
      // They aren't in the site: it's the home's.
      expect(await filesUnder(first.out)).not.toContain("netlify.toml");

      // The owner's edit stays, and nothing is said of a file that wasn't written.
      await writeFile(path.join(home, "netlify.toml"), "# the owner's own build\n");
      const second = await build(home);

      expect(await readFile(path.join(home, "netlify.toml"), "utf8")).toBe(
        "# the owner's own build\n",
      );
      expect(second.logger.text("info")).not.toContain("Wrote ");
    });

    it("writes them into the home even when the site is built somewhere else", async () => {
      const home = await newHome();
      const out = path.join(await newFolder(), "site");

      await build(home, { out });

      expect(existsSync(path.join(home, "netlify.toml"))).toBe(true);
      expect(existsSync(path.join(home, ".nvmrc"))).toBe(true);
      expect(existsSync(path.join(out, "netlify.toml"))).toBe(false);
    });
  });

  describe("the .gitignore check", () => {
    const WARNING = (home: string) =>
      `${home}'s .gitignore doesn't keep _site/ out of Git, so the built site could be committed with the records. Add the line _site/ to it.`;

    it("says to add _site/ to a .gitignore that doesn't keep it out", async () => {
      const home = await newHome();
      // A home made before the site had a folder of its own: its .gitignore has no line for it.
      await writeFile(path.join(home, ".gitignore"), "# Written by voicecap.\n.voicecap.lock\n");

      const { logger } = await build(home);

      expect(warned(logger)).toEqual([WARNING(home)]);
      // The file is the owner's: it's never edited.
      expect(await readFile(path.join(home, ".gitignore"), "utf8")).toBe(
        "# Written by voicecap.\n.voicecap.lock\n",
      );
    });

    it("says nothing when the home's .gitignore is the one a new home gets", async () => {
      const home = await newHome();
      expect(await readFile(path.join(home, ".gitignore"), "utf8")).toBe(GITIGNORE);

      const { logger } = await build(home);

      expect(warned(logger)).toEqual([]);
    });

    it("warns of it before what it leaves out, and says what it built last", async () => {
      const home = await newHome();
      await writeFile(path.join(home, ".gitignore"), "nothing\n");
      await rm(path.join(home, FIXTURE_FOLDER, "share", FIRST_WORD));

      const { logger, leftOut } = await build(home);

      expect(warned(logger)).toEqual([WARNING(home), ...leftOut]);
      expect(leftOut).toHaveLength(1);
      expect(logger.entries.map(({ level }) => level)).toEqual([
        "info",
        "info",
        "warn",
        "warn",
        "info",
      ]);
    });

    /**
     * Lines that keep the site out, as Git reads them: it drops a line's trailing spaces, and the CR
     * of a CRLF line ending.
     */
    const KEEP_IT_OUT = ["_site", "_site/", "/_site", "/_site/", "_site/   "];
    /** Lines that don't: to Git, white space at a line's start, and a tab at its end, are the pattern's. */
    const WHITE_SPACE_GIT_KEEPS = ["  _site/  ", "\t/_site\t", "_site/\t", "\t_site/"];

    it.each(KEEP_IT_OUT.map((line) => [line]))(
      "counts the line %j as keeping it out, with other lines and either line ending",
      async (line) => {
        const home = await newHome();
        await writeFile(
          path.join(home, ".gitignore"),
          `.voicecap.lock\r\n${line}\r\nThumbs.db\r\n`,
        );

        const { logger } = await build(home);

        expect(warned(logger)).toEqual([]);
      },
    );

    // Git honors `_site/*`, but it isn't one of the four lines voicecap counts, so the warning (add
    // `_site/`) is a false alarm there, on the safe side. The other lines keep the site out to no one.
    it.each(
      ["_site/*", "# _site/", "site/", "/_site/x", "_sites/", "", ...WHITE_SPACE_GIT_KEEPS].map(
        (line) => [line],
      ),
    )("doesn't count the line %j as keeping it out", async (line) => {
      const home = await newHome();
      await writeFile(path.join(home, ".gitignore"), `.voicecap.lock\n${line}\n`);

      const { logger } = await build(home);

      expect(warned(logger)).toEqual([WARNING(home)]);
    });

    it("counts a _site/ first line after a UTF-8 byte order mark, which Git skips", async () => {
      const home = await newHome();
      // As Windows PowerShell 5.1's Out-File -Encoding utf8 writes a file: EF BB BF first.
      await writeFile(path.join(home, ".gitignore"), "\uFEFF_site/\r\n");

      const { logger } = await build(home);

      expect(warned(logger)).toEqual([]);
    });

    it("reads a line with a long run of spaces inside it in one pass", async () => {
      const home = await newHome();
      // A pattern such as / +$/ starts again at each of these spaces: about 18 seconds' work.
      await writeFile(path.join(home, ".gitignore"), `_site/${" ".repeat(300_000)}x\n_site/\n`);

      const started = performance.now();
      const { logger } = await build(home);

      expect(performance.now() - started).toBeLessThan(5_000);
      expect(warned(logger)).toEqual([]);
    });

    it("says to add _site/ when the .gitignore can't be read", async () => {
      const home = await newHome();
      await rm(path.join(home, ".gitignore"));
      // A folder: it's there, so it's never written over, and it can't be read as a file.
      await mkdir(path.join(home, ".gitignore"));

      const { logger } = await build(home);

      expect(warned(logger)).toEqual([WARNING(home)]);
      expect(logger.text("info")).not.toContain("for Git");
    });

    it.skipIf(!gitAvailable)(
      "takes Git's word for the lists: Git ignores the site with each line counted, and not with the white-space ones",
      async () => {
        // Git itself, so the two lists can't drift from what Git does: in a repository of its own,
        // with no global excludes file. check-ignore's status is 0 for a path it ignores.
        const repo = await newFolder();
        const noExcludes = path.join(repo, "no-excludes");
        await writeFile(noExcludes, "");
        await mkdir(path.join(repo, "_site"));
        await writeFile(path.join(repo, "_site", "index.html"), "");
        expect(git(["init", "-q"], repo)).toBe(0);
        const checkIgnore = async (gitignore: string): Promise<number | null> => {
          await writeFile(path.join(repo, ".gitignore"), gitignore);
          return git(
            ["-c", `core.excludesFile=${noExcludes}`, "check-ignore", "-q", "_site/index.html"],
            repo,
          );
        };

        const verdicts: [string, number | null][] = [];
        for (const line of [...KEEP_IT_OUT, ...WHITE_SPACE_GIT_KEEPS]) {
          verdicts.push([line, await checkIgnore(`.voicecap.lock\r\n${line}\r\n`)]);
        }
        // A byte order mark counts only at the file's start, so it gets a file of its own.
        verdicts.push(["\uFEFF_site/", await checkIgnore("\uFEFF_site/\r\n")]);

        expect(verdicts).toEqual([
          ...KEEP_IT_OUT.map((line) => [line, 0]),
          ...WHITE_SPACE_GIT_KEEPS.map((line) => [line, 1]),
          ["\uFEFF_site/", 0],
        ]);
      },
    );

    it("checks it for _site in the home however that folder is written, and for no other folder", async () => {
      const home = await newHome();
      await writeFile(path.join(home, ".gitignore"), "nothing\n");

      // As it's written with a detour in it: `<home>/./sub/../_site`.
      const detour = [home, ".", "sub", "..", "_site"].join(path.sep);
      const spelled = await build(home, { out: detour });
      expect(warned(spelled.logger)).toEqual([WARNING(home)]);

      // The site built elsewhere is another matter: the home's .gitignore says nothing of it.
      const elsewhere = await build(home, { out: path.join(await newFolder(), "site") });
      expect(warned(elsewhere.logger)).toEqual([]);
      const inTheHome = await build(home, { out: path.join(home, "public") });
      expect(warned(inTheHome.logger)).toEqual([]);
    });
  });

  describe(".gitattributes and .gitignore", () => {
    const wrote = (name: string, home: string) =>
      `Wrote ${name} into ${home}, for Git: commit it with the records.`;

    it("writes voicecap's own into a home that has neither, as a run would, and says so first", async () => {
      const home = await newHome();
      await rm(path.join(home, ".gitattributes"));
      await rm(path.join(home, ".gitignore"));
      await rm(path.join(home, "netlify.toml"), { force: true });
      await rm(path.join(home, ".nvmrc"), { force: true });

      const { logger } = await build(home);

      expect(await readFile(path.join(home, ".gitattributes"), "utf8")).toBe(GITATTRIBUTES);
      expect(await readFile(path.join(home, ".gitignore"), "utf8")).toBe(GITIGNORE);
      // Its .gitignore keeps the site out, so there's nothing to warn of.
      expect(warned(logger)).toEqual([]);
      expect(
        logger.entries.filter(({ level }) => level === "info").map(({ message }) => message),
      ).toEqual([
        wrote(".gitattributes", home),
        wrote(".gitignore", home),
        `Wrote netlify.toml into ${home}, for Netlify: commit it with the records.`,
        `Wrote .nvmrc into ${home}, for Netlify: commit it with the records.`,
        expect.stringMatching(/^Built the site in /),
      ]);
    });

    it("writes only the one that's missing, and never changes the other", async () => {
      const home = await newHome();
      await rm(path.join(home, ".gitignore"));
      await writeFile(path.join(home, ".gitattributes"), "# the owner's own\n");

      const { logger } = await build(home);

      expect(await readFile(path.join(home, ".gitattributes"), "utf8")).toBe("# the owner's own\n");
      expect(await readFile(path.join(home, ".gitignore"), "utf8")).toBe(GITIGNORE);
      expect(logger.text("info")).toContain(wrote(".gitignore", home));
      expect(logger.text("info")).not.toContain(".gitattributes");
      expect(warned(logger)).toEqual([]);
    });

    it("writes them into the home even when the site is built somewhere else", async () => {
      const home = await newHome();
      await rm(path.join(home, ".gitattributes"));
      await rm(path.join(home, ".gitignore"));
      const out = path.join(await newFolder(), "site");

      await build(home, { out });

      expect(await readFile(path.join(home, ".gitignore"), "utf8")).toBe(GITIGNORE);
      expect(await readFile(path.join(home, ".gitattributes"), "utf8")).toBe(GITATTRIBUTES);
      expect(existsSync(path.join(out, ".gitignore"))).toBe(false);
    });

    it("never writes over the home's own, and says nothing of them", async () => {
      const home = await newHome();
      await writeFile(path.join(home, ".gitignore"), "_site/\n");

      const { logger } = await build(home);

      expect(await readFile(path.join(home, ".gitignore"), "utf8")).toBe("_site/\n");
      expect(logger.text("info")).not.toContain("for Git");
    });
  });

  describe("what it builds", () => {
    it("builds the site of a home that shared nothing", async () => {
      const home = path.join(await newFolder(), "transcripts");
      await mkdir(path.join(home, "dvfr.illinois.gov", "2027-01-12"), { recursive: true });
      await ensureGitFiles(home);

      const { out, content, leftOut, logger } = await build(home);

      expect(content).toEqual({ demo: null, sites: [] });
      expect(leftOut).toEqual([]);
      expect(warned(logger)).toEqual([]);
      expect(await readFile(path.join(out, "index.html"), "utf8")).toContain(
        "No reports have been shared yet.",
      );
      // Only the site's own files, and the page's policy at its two addresses.
      expect(await filesUnder(out)).toEqual(["_headers", "index.html", "robots.txt"]);
      expect(
        readHeaders(await readFile(path.join(out, "_headers"), "utf8")).rules.map(
          ([rulePath]) => rulePath,
        ),
      ).toEqual(["/", "/index.html"]);
      expect(logger.entries.at(-1)).toEqual({
        level: "info",
        message: `Built the site in ${out}: 0 reports from 0 sites.`,
      });
    });

    it("builds the site of a home with a folder for the demo and nothing else shared", async () => {
      const home = await newHome();
      await rm(path.join(home, FIXTURE_FOLDER, "share"), { recursive: true });
      await rm(path.join(home, EXAMPLE_FOLDER, "share"), { recursive: true });

      const { content, logger } = await build(home);

      expect(content.sites).toEqual([]);
      expect(content.demo?.id).toBe("report-demo");
      expect(logger.entries.at(-1)?.message).toMatch(
        /^Built the site in .*: 0 reports from 0 sites, and the demo's\.$/,
      );
    });

    it("builds from the home in effect, with no config anywhere", async () => {
      const home = await newHome();
      // The current folder is empty: it has no config and no transcripts, and the home is VOICECAP_TRANSCRIPTS's.
      const cwd = await newFolder();
      const logger = createMemoryLogger();

      const { out } = await buildSite({ cwd, env: { VOICECAP_TRANSCRIPTS: home }, logger });

      expect(out).toBe(path.join(home, "_site"));
      expect(existsSync(path.join(out, "index.html"))).toBe(true);
      expect(await readdir(cwd)).toEqual([]);
    });

    it("builds from the transcripts folder of the current folder when nothing else says where", async () => {
      const home = await newHome();

      const { out } = await buildSite({
        cwd: path.dirname(home),
        env: {},
        logger: createMemoryLogger(),
      });

      expect(out).toBe(path.join(home, "_site"));
    });

    it("says what it built", async () => {
      const home = await newHome();

      const { out, logger } = await build(home);

      // Three reports of two sites, which the site's folder and the one written by hand give, and the demo's.
      expect(logger.entries.at(-1)).toEqual({
        level: "info",
        message: `Built the site in ${out}: 3 reports from 2 sites, and the demo's.`,
      });
    });

    it("says what it built without the demo's when there is none, and in the singular", async () => {
      const home = await homeWithSites({ "dvfr.illinois.gov": ["2027-01-15T10:00:00-06:00"] });

      const { out, logger } = await build(home);

      expect(logger.entries.at(-1)?.message).toBe(
        `Built the site in ${out}: 1 report from 1 site.`,
      );
    });

    it("orders the sites by name, and each site's reports newest first by the moment, the higher seq on a tie", async () => {
      const home = await homeWithSites({
        "zeta.illinois.gov": [
          // seq 1 and seq 3 are the same moment, written two ways; seq 2 is later, seq 4 earlier.
          "2027-01-15T10:00:00-06:00",
          "2027-01-16T09:30:00-06:00",
          "2027-01-15T16:00:00+00:00",
          "2027-01-14T16:00:00-06:00",
        ],
        "alpha.illinois.gov": [
          // The night the clocks go back: 1:30 CDT is 40 minutes before 1:10 CST, though it sorts after as text.
          "2027-11-07T01:30:00-05:00",
          "2027-11-07T01:10:00-06:00",
        ],
      });

      const { content } = await build(home);

      expect(content.sites.map(({ name }) => name)).toEqual([
        "alpha.illinois.gov",
        "zeta.illinois.gov",
      ]);
      expect(content.sites.map(({ reports }) => reports.map(({ id }) => id))).toEqual([
        ["report-alpha.illinois.gov-2", "report-alpha.illinois.gov-1"],
        [
          "report-zeta.illinois.gov-2",
          "report-zeta.illinois.gov-3",
          "report-zeta.illinois.gov-1",
          "report-zeta.illinois.gov-4",
        ],
      ]);
    });
  });

  // Added in 0.10.0. A site is headed by the canonical name its newest share records, and the site
  // folders that name one site are one site on the page. Where a report's files are published is the
  // folder's: only what the page shows changes.
  describe("how it names the sites", () => {
    /** The times of shares, a day apart. */
    const JAN_15 = "2027-01-15T10:00:00-06:00";
    const JAN_16 = "2027-01-16T10:00:00-06:00";
    const JAN_17 = "2027-01-17T10:00:00-06:00";
    /** The root a share records for a site with a canonical address, and the name that gives it. */
    const ROOT = "https://dvfr.illinois.gov/";
    const NAME = "dvfr.illinois.gov";
    /** What a share of a site with no canonical address records: the address voicecap read. */
    const READ = "http://127.0.0.1:4848/";
    /** The folder a run on a copy of the site on a tester's computer makes. */
    const COPY_FOLDER = "127.0.0.1_4848";

    /** Build the site of `home`, and read its page. */
    async function built(home: string) {
      const result = await build(home);
      return { ...result, index: await readFile(path.join(result.out, "index.html"), "utf8") };
    }

    /** The page's sites, in order: each section's id, then its heading. */
    function sitesOn(index: string): [id: string, heading: string][] {
      return [...index.matchAll(/<section class="site" id="([^"]*)">\n<h3>([^<]*)<\/h3>/g)].map(
        ([, id = "", heading = ""]): [string, string] => [id, heading],
      );
    }

    /** The ids of the page's reports, in the order the page gives them. */
    function reportsOn(index: string): string[] {
      return [...index.matchAll(/<article class="report" id="([^"]*)">/g)].map(([, id = ""]) => id);
    }

    /**
     * The page's list by date, in order: when each report was made, its site's name, who prepared it,
     * and the address of its page.
     */
    function listedByDate(index: string) {
      const items = index.matchAll(
        /<li><time datetime="([^"]*)">[^<]*<\/time>, ([^,]*), prepared by ([^:]*): <a href="([^"]*)">/g,
      );
      return [...items].map(([, at = "", site = "", by = "", href = ""]) => ({
        at,
        site,
        by,
        href,
      }));
    }

    /** Each id the page gives more than once. */
    function repeatedIds(index: string): string[] {
      const ids = [...index.matchAll(/\sid="([^"]*)"/g)].map(([, id = ""]) => id);
      return ids.filter((id, at) => ids.indexOf(id) !== at);
    }

    it("heads a site by its newest share's canonical name", async () => {
      const home = await homeWithSites({
        // Shared once before the site's address was known, and again after.
        [COPY_FOLDER]: [
          { at: JAN_15, site: READ },
          { at: JAN_16, site: ROOT },
        ],
      });

      const { content, index } = await built(home);

      expect(content.sites.map(({ name, folders }) => ({ name, folders }))).toEqual([
        { name: NAME, folders: [COPY_FOLDER] },
      ]);
      // Both reports are the site's, the newest first: the folder is named by its newest share.
      expect(content.sites[0]?.reports.map(({ id }) => id)).toEqual([
        `report-${COPY_FOLDER}-2`,
        `report-${COPY_FOLDER}-1`,
      ]);
      // The page leads with the name: no heading, section, or line by date is named for the folder.
      expect(sitesOn(index)).toEqual([[`site-${NAME}`, NAME]]);
      expect(listedByDate(index).map(({ site }) => site)).toEqual([NAME, NAME]);
      expect(index).not.toContain(`site-${COPY_FOLDER}`);
      expect(index).not.toContain(`<h3>${COPY_FOLDER}</h3>`);
      expect(index).not.toContain(`, ${COPY_FOLDER}, prepared by`);
    });

    it("heads a site by its folder when its newest share names no site readers know it by, though an older share did", async () => {
      const home = await homeWithSites({
        // Its newest share is of a copy on this computer, with no canonical address known.
        "a-local.example.gov": [
          { at: JAN_15, site: ROOT },
          { at: JAN_16, site: "http://localhost:3000/" },
        ],
        "b-ip.example.gov": [{ at: JAN_16, site: READ }],
        // What no share would record: text that isn't a root, an address of another kind, and a
        // value that isn't text.
        "c-not-a-root.example.gov": [{ at: JAN_16, site: "dvfr.illinois.gov" }],
        "d-another-kind.example.gov": [{ at: JAN_16, site: "ftp://dvfr.illinois.gov/" }],
        "e-not-text.example.gov": [{ at: JAN_16, site: 42 }],
      });

      const { content, leftOut, index } = await built(home);

      const names = [
        "a-local.example.gov",
        "b-ip.example.gov",
        "c-not-a-root.example.gov",
        "d-another-kind.example.gov",
        "e-not-text.example.gov",
      ];
      expect(leftOut).toEqual([]);
      expect(content.sites.map(({ name, folders }) => ({ name, folders }))).toEqual(
        names.map((name) => ({ name, folders: [name] })),
      );
      expect(sitesOn(index)).toEqual(names.map((name) => [`site-${name}`, name]));
      // The older share's canonical name names nothing: the folder is the site's name throughout.
      expect(index).not.toContain(NAME);
    });

    it("names an older site by its folder", async () => {
      // Shares from before 0.10.0 record no site.
      const home = await homeWithSites({
        [NAME]: [JAN_15, JAN_16],
        "example.illinois.gov": ["2027-01-15T12:00:00-06:00"],
      });

      const { content, index } = await built(home);

      expect(content.sites.map(({ name, folders }) => ({ name, folders }))).toEqual([
        { name: NAME, folders: [NAME] },
        { name: "example.illinois.gov", folders: ["example.illinois.gov"] },
      ]);
      expect(sitesOn(index)).toEqual([
        [`site-${NAME}`, NAME],
        ["site-example.illinois.gov", "example.illinois.gov"],
      ]);
      expect(listedByDate(index).map(({ site }) => site)).toEqual([
        NAME,
        "example.illinois.gov",
        NAME,
      ]);
    });

    it("puts two folders that name one site under one heading, their reports newest first", async () => {
      const home = await homeWithSites({
        // A copy of the site on a tester's computer, whose shares name the site, and the site's own
        // folder, from before shares did.
        [COPY_FOLDER]: [
          { at: JAN_15, site: ROOT },
          { at: JAN_17, site: ROOT },
        ],
        [NAME]: [JAN_16],
      });

      const { out, content, index, logger } = await built(home);

      expect(content.sites).toHaveLength(1);
      const [site] = content.sites;
      expect(site?.name).toBe(NAME);
      expect(site?.folders).toEqual([COPY_FOLDER, NAME]);
      // Each report keeps its own folder, and they are the site's together, the newest first.
      expect(site?.reports.map(({ id, folder, at }) => ({ id, folder, at }))).toEqual([
        { id: `report-${COPY_FOLDER}-2`, folder: COPY_FOLDER, at: JAN_17 },
        { id: `report-${NAME}-1`, folder: NAME, at: JAN_16 },
        { id: `report-${COPY_FOLDER}-1`, folder: COPY_FOLDER, at: JAN_15 },
      ]);
      // One heading, with the three reports under it in that order, and counted together.
      expect(sitesOn(index)).toEqual([[`site-${NAME}`, NAME]]);
      expect(reportsOn(index)).toEqual(site?.reports.map(({ id }) => id));
      expect(index).toContain('<p class="count">3 reports</p>');
      expect(listedByDate(index).map(({ at, site: named }) => [at, named])).toEqual([
        [JAN_17, NAME],
        [JAN_16, NAME],
        [JAN_15, NAME],
      ]);
      expect(repeatedIds(index)).toEqual([]);
      expect(logger.entries.at(-1)?.message).toBe(
        `Built the site in ${out}: 3 reports from 1 site.`,
      );
    });

    it("keeps the reports of one moment in the order of their folders, a folder's higher seq first", async () => {
      const home = await homeWithSites({
        [COPY_FOLDER]: [{ at: JAN_15, site: ROOT }],
        // The later folder's seq 2 and 3 are of the moment the first folder's seq 1 is: its higher
        // seq doesn't put it ahead of the earlier folder's.
        [NAME]: ["2027-01-14T10:00:00-06:00", JAN_15, JAN_15],
      });

      const { content } = await built(home);

      expect(content.sites[0]?.reports.map(({ id }) => id)).toEqual([
        `report-${COPY_FOLDER}-1`,
        `report-${NAME}-3`,
        `report-${NAME}-2`,
        `report-${NAME}-1`,
      ]);
    });

    it("publishes each folder's files where they are when two folders that name one site have files of one name, and both links resolve", async () => {
      // A share of the site from a copy on a tester's computer and one from the site's own folder,
      // on the same day, are named alike: after the site.
      const page = `${NAME}_2027-01-15.html`;
      const home = await homeWithSites({
        [COPY_FOLDER]: [{ at: JAN_15, site: ROOT, page }],
        [NAME]: [{ at: "2027-01-15T14:00:00-06:00", site: ROOT, page }],
      });

      const { out, content, index, leftOut } = await built(home);

      expect(leftOut).toEqual([]);
      expect(content.sites.map(({ name, folders }) => ({ name, folders }))).toEqual([
        { name: NAME, folders: [COPY_FOLDER, NAME] },
      ]);
      // The later one is first. Each report's file is addressed from its own folder.
      expect(
        content.sites[0]?.reports.map(({ folder, files }) => [folder, files[0]?.href]),
      ).toEqual([
        [NAME, `${NAME}/${page}`],
        [COPY_FOLDER, `${COPY_FOLDER}/${page}`],
      ]);
      // Each file is published in its own folder, as it was shared: neither took the other's place.
      const published: Buffer[] = [];
      for (const folder of [COPY_FOLDER, NAME]) {
        const copy = await readFile(path.join(out, folder, page));
        expect(copy.equals(await readFile(path.join(home, folder, "share", page))), folder).toBe(
          true,
        );
        published.push(copy);
      }
      expect(published[0]?.equals(published[1] ?? Buffer.alloc(0))).toBe(false);
      expect(await filesUnder(out)).toEqual(
        [
          "_headers",
          `${COPY_FOLDER}/${page}`,
          `${NAME}/${page}`,
          "index.html",
          "robots.txt",
        ].sort(),
      );
      // The page links to each, twice (with its report, and by date), and each link leads to the
      // file of the folder it names.
      const links = [...index.matchAll(/<a href="([^"#]+\.html)"/g)].map(([, href = ""]) => href);
      expect(links.toSorted()).toEqual(
        [COPY_FOLDER, NAME].flatMap((folder) => [`${folder}/${page}`, `${folder}/${page}`]).sort(),
      );
      for (const href of new Set(links)) {
        const [folder = "", ...rest] = href.split("/");
        const shared = await readFile(path.join(home, folder, "share", ...rest));
        expect((await readFile(path.join(out, folder, ...rest))).equals(shared), href).toBe(true);
      }
      // And each page has its own rules in _headers, at both its addresses.
      const rules = readHeaders(await readFile(path.join(out, "_headers"), "utf8")).rules.map(
        ([rulePath]) => rulePath,
      );
      expect(rules).toEqual([
        "/",
        "/index.html",
        `/${NAME}/${page}`,
        `/${NAME}/${page.replace(/\.html$/, "")}`,
        `/${COPY_FOLDER}/${page}`,
        `/${COPY_FOLDER}/${page.replace(/\.html$/, "")}`,
      ]);
      expect(repeatedIds(index)).toEqual([]);
    });

    it("orders the sites by their names, not by their folders' names", async () => {
      const home = await homeWithSites({
        [COPY_FOLDER]: [{ at: JAN_16, site: "https://zeta.illinois.gov/" }],
        "beta.illinois.gov": [JAN_15],
        localhost_3000: [{ at: JAN_16, site: "https://alpha.illinois.gov/" }],
      });

      const { content, index } = await built(home);

      expect(content.sites.map(({ name, folders }) => ({ name, folders }))).toEqual([
        { name: "alpha.illinois.gov", folders: ["localhost_3000"] },
        { name: "beta.illinois.gov", folders: ["beta.illinois.gov"] },
        { name: "zeta.illinois.gov", folders: [COPY_FOLDER] },
      ]);
      expect(sitesOn(index).map(([, heading]) => heading)).toEqual([
        "alpha.illinois.gov",
        "beta.illinois.gov",
        "zeta.illinois.gov",
      ]);
    });

    it("lists reports by date with their canonical names", async () => {
      const home = await homeWithSites({
        [COPY_FOLDER]: [{ at: JAN_17, site: ROOT }],
        // A root with a path, as the demo's is, and one with a port.
        localhost_3000: [{ at: JAN_16, site: "https://voicecap.netlify.app/demo-site/" }],
        localhost_8443: [{ at: JAN_15, site: "https://staging.illinois.gov:8443/" }],
        "example.illinois.gov": ["2027-01-14T10:00:00-06:00"],
      });

      const { index } = await built(home);

      expect(listedByDate(index)).toEqual([
        { at: JAN_17, site: NAME, by: "Sam Rivera", href: `${COPY_FOLDER}/${COPY_FOLDER}_1.html` },
        {
          at: JAN_16,
          site: "voicecap.netlify.app",
          by: "Sam Rivera",
          href: "localhost_3000/localhost_3000_1.html",
        },
        {
          at: JAN_15,
          site: "staging.illinois.gov:8443",
          by: "Sam Rivera",
          href: "localhost_8443/localhost_8443_1.html",
        },
        {
          at: "2027-01-14T10:00:00-06:00",
          site: "example.illinois.gov",
          by: "Sam Rivera",
          href: "example.illinois.gov/example.illinois.gov_1.html",
        },
      ]);
      // A name with a port is a section's id made safe as a folder's name is.
      expect(sitesOn(index).map(([id]) => id)).toContain("site-staging.illinois.gov_8443");
      expect(repeatedIds(index)).toEqual([]);
    });

    it("heads a site by the canonical address a share records, as `voicecap share` writes it", async () => {
      // The fixture site's folder, with the two shares the home has, which name no canonical address.
      const home = path.join(await newFolder(), "transcripts");
      await cp(template, home, { recursive: true });
      const config: LoadedConfig = {
        config: resolveConfig({ report: { canonical: ROOT } }),
        file: null,
        sha256: "test-config",
      };
      const { files } = await shareReport({
        out: home,
        site: FIXTURE_SITE,
        reviewer: "Test Reviewer",
        now: new Date(2027, 0, 17, 10, 0),
        config,
        logger: silentLogger,
        cwd: path.dirname(home),
        env: {},
      });
      expect(files[0]?.name).toBe(`${NAME}_2027-01-17.html`);

      const { content, index } = await built(home);

      expect(content.sites.map(({ name, folders }) => ({ name, folders }))).toEqual([
        { name: NAME, folders: [FIXTURE_FOLDER] },
        { name: EXAMPLE_FOLDER, folders: [EXAMPLE_FOLDER] },
      ]);
      // The fixture folder's three shares are the site's, the newest first, and are still published
      // under the folder, whatever each is named.
      const [site] = content.sites;
      expect(site?.reports.map(({ id }) => id)).toEqual([
        `report-${FIXTURE_FOLDER}-3`,
        `report-${FIXTURE_FOLDER}-2`,
        `report-${FIXTURE_FOLDER}-1`,
      ]);
      expect(site?.reports[0]?.files.map(({ href }) => href)[0]).toBe(
        `${FIXTURE_FOLDER}/${NAME}_2027-01-17.html`,
      );
      expect(sitesOn(index).map(([, heading]) => heading)).toEqual([NAME, EXAMPLE_FOLDER]);
    });
  });
});

describe("the package's entry", () => {
  it("exports buildSite", async () => {
    const api = await import("../src/index.js");

    expect(api.buildSite).toBe(buildSite);
  });

  it("exports its types", () => {
    // This compiles only if the entry exports each of these types.
    const types: [
      Api.BuildSiteOptions | null,
      Api.BuildSiteResult | null,
      Api.SiteContent | null,
      Api.PublishedReport | null,
      Api.PublishedFile | null,
      // What `readShares` gives back, so a caller can name it.
      Api.SharesAsRead | null,
    ] = [null, null, null, null, null, null];

    expect(types).toHaveLength(6);
  });
});
