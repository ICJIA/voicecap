/**
 * What the site reads of a transcripts home: each site folder's share/shares.json, and the demo's
 * in voicecap-demo/. Each test makes the small home it needs, with site folders (each with a date
 * folder, so that it counts as a site's) and records of entries sealed as `voicecap share` seals
 * them. The files an entry lists are never read here (the build checks each one), so no share/
 * holds any, and the fingerprints are made up.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SharedFile } from "../src/model.js";
import { shareDir, sharesPath } from "../src/run/paths.js";
import { readSiteRecords, type SiteRecords } from "../src/site/records.js";
import { sealOf } from "../src/util/hash.js";

const JAN_14 = "2027-01-14T16:00:00-06:00";
const JAN_15 = "2027-01-15T10:00:00-06:00";
const JAN_16 = "2027-01-16T09:30:00-06:00";
const JAN_17 = "2027-01-17T14:05:00-06:00";
/** The night the clocks go back in US Central time: 1:30 CDT, and 40 minutes later, 1:10 CST. */
const CDT = "2027-11-07T01:30:00-05:00";
const CST = "2027-11-07T01:10:00-06:00";

/** How the build's output names the example site's record. */
const EXAMPLE_RECORD = "example.illinois.gov/share/shares.json";
const BAD_FOLDER_NAME = "not published: its name isn't one voicecap gives a site's folder";

// Characters a terminal would act on, written with braces: a plain backslash-u escape can't be kept
// in a file by the tools that write this one.
const ESC = "\u{1b}";
const DEL = "\u{7f}";
const NEL = "\u{85}";
const LINE_SEPARATOR = "\u{2028}";
const PARAGRAPH_SEPARATOR = "\u{2029}";
/** A control character, or a line separator: what no line of the output may hold as it is. */
const RAW = /[\p{Cc}\u{2028}\u{2029}]/u;
/** How the output writes such a character: a backslash, "u", and four lower-case hex digits. */
const escaped = (hex: string) => `\\u${hex}`;

/** The transcripts home: new for each test, and empty. */
let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "voicecap-site-records-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** A site's folder, with a date folder in it as a site's has: under the home, or under `root`. */
async function siteFolder(name: string, root: string = home): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, "2027-01-14"), { recursive: true });
  return dir;
}

/** The demo's folder in the home, where `voicecap demo` writes. */
const demoRoot = () => path.join(home, "voicecap-demo");

/** Leave `text` where a site's record is, as a person or another program might have left it. */
async function plant(dir: string, text: string): Promise<void> {
  await mkdir(shareDir(dir), { recursive: true });
  await writeFile(sharesPath(dir), text);
}

/** Leave a record of `shares` in a site's folder. */
async function record(dir: string, shares: unknown[]): Promise<void> {
  await plant(dir, JSON.stringify({ schemaVersion: 1, shares }, null, 2));
}

/**
 * An entry as `voicecap share` writes one, sealed over what it holds. `change` replaces fields
 * before the seal is made, so that a value no share would record can still have a seal that holds.
 * The chain (prev) is for `voicecap verify`: the site reads each entry on its own.
 */
function sealed(
  seq: number,
  at: string,
  files: unknown,
  change: Record<string, unknown> = {},
): Record<string, unknown> {
  const body = { seq, prev: null, at, by: "Pat Lee", runs: ["2027-01-14_1315"], files, ...change };
  return { ...body, seal: sealOf(body) };
}

/** A page and its Word copy, as an entry lists them, named for `stem`. */
function copies(stem: string): SharedFile[] {
  return [
    { name: `${stem}.html`, bytes: 120, sha256: "a".repeat(64) },
    { name: `${stem}.docx`, bytes: 340, sha256: "b".repeat(64) },
  ];
}

/** The entries of every site, in the order read. */
function kept(sites: SiteRecords["sites"]): SiteRecords["sites"][number]["entries"] {
  return sites.flatMap(({ entries }) => entries);
}

describe("readSiteRecords", () => {
  it("reads every site's entries, and the demo's latest", async () => {
    // Made in the opposite order to their names, and zeta's entries aren't in the order of their
    // times (a clock set back records a later share first): the sites come by name, and each site's
    // entries as they're recorded.
    const zeta = await siteFolder("zeta.illinois.gov");
    await record(zeta, [
      sealed(1, JAN_16, copies("zeta.illinois.gov_2027-01-16"), { by: "Sam Ortiz" }),
      sealed(2, JAN_15, copies("zeta.illinois.gov_2027-01-15"), { by: "Sam Ortiz" }),
    ]);
    const alpha = await siteFolder("alpha.illinois.gov");
    await record(alpha, [sealed(1, JAN_15, copies("alpha.illinois.gov_2027-01-15"))]);
    const demo = await siteFolder("127.0.0.1_4848", demoRoot());
    await record(demo, [
      sealed(1, JAN_14, copies("127.0.0.1_4848_2027-01-14")),
      sealed(2, JAN_17, copies("127.0.0.1_4848_2027-01-17")),
    ]);

    const records = await readSiteRecords(home);

    expect(records).toEqual({
      sites: [
        {
          folder: "alpha.illinois.gov",
          entries: [
            {
              folder: "alpha.illinois.gov",
              dir: path.join(alpha, "share"),
              seq: 1,
              at: JAN_15,
              by: "Pat Lee",
              files: copies("alpha.illinois.gov_2027-01-15"),
            },
          ],
        },
        {
          folder: "zeta.illinois.gov",
          entries: [
            {
              folder: "zeta.illinois.gov",
              dir: path.join(zeta, "share"),
              seq: 1,
              at: JAN_16,
              by: "Sam Ortiz",
              files: copies("zeta.illinois.gov_2027-01-16"),
            },
            {
              folder: "zeta.illinois.gov",
              dir: path.join(zeta, "share"),
              seq: 2,
              at: JAN_15,
              by: "Sam Ortiz",
              files: copies("zeta.illinois.gov_2027-01-15"),
            },
          ],
        },
      ],
      demo: {
        folder: "127.0.0.1_4848",
        dir: path.join(demo, "share"),
        seq: 2,
        at: JAN_17,
        by: "Pat Lee",
        files: copies("127.0.0.1_4848_2027-01-17"),
      },
      leftOut: [],
    });
  });

  it("keeps a walkthrough file's run, and drops one that isn't text", async () => {
    const dir = await siteFolder("example.illinois.gov");
    const stem = "example.illinois.gov_2027-01-15";
    await record(dir, [
      sealed(1, JAN_15, [
        { name: `${stem}.html`, bytes: 120, sha256: "a".repeat(64) },
        {
          name: `${stem}_2027-01-14_1315_walkthrough.json`,
          bytes: 30,
          sha256: "c".repeat(64),
          run: "2027-01-14_1315",
        },
        // As a person might leave a record: a run that isn't text, and a field it never has.
        {
          name: `${stem}_2027-01-14_1402_walkthrough.json`,
          bytes: 31,
          sha256: "d".repeat(64),
          run: 1402,
          note: "x",
        },
      ]),
    ]);

    const { sites } = await readSiteRecords(home);

    const files = kept(sites)[0]?.files;
    // Strictly: a file with no run has no run key, and not one that's undefined.
    expect(files).toStrictEqual([
      { name: `${stem}.html`, bytes: 120, sha256: "a".repeat(64) },
      {
        name: `${stem}_2027-01-14_1315_walkthrough.json`,
        bytes: 30,
        sha256: "c".repeat(64),
        run: "2027-01-14_1315",
      },
      { name: `${stem}_2027-01-14_1402_walkthrough.json`, bytes: 31, sha256: "d".repeat(64) },
    ]);
    // The run comes last, as voicecap records it.
    expect(Object.keys(files![1]!)).toEqual(["name", "bytes", "sha256", "run"]);
  });

  it("leaves out an entry whose seal no longer holds, and names it", async () => {
    const dir = await siteFolder("example.illinois.gov");
    const { seal: _lost, ...unsealed } = sealed(
      3,
      JAN_17,
      copies("example.illinois.gov_2027-01-17"),
    );
    await record(dir, [
      sealed(1, JAN_15, copies("example.illinois.gov_2027-01-15")),
      // Changed after it was sealed.
      {
        ...sealed(2, JAN_16, copies("example.illinois.gov_2027-01-16")),
        by: "Someone Else",
      },
      // One that lost its seal was changed too, as `voicecap verify` says.
      unsealed,
      sealed(4, JAN_17, copies("example.illinois.gov_2027-01-17-2")),
    ]);

    const { sites, leftOut } = await readSiteRecords(home);

    // The site's other entries are kept.
    expect(kept(sites).map(({ seq }) => seq)).toEqual([1, 4]);
    expect(leftOut).toEqual([
      `${EXAMPLE_RECORD}: share 2 (${JAN_16}) changed since it was recorded`,
      `${EXAMPLE_RECORD}: share 3 (${JAN_17}) changed since it was recorded`,
    ]);
  });

  it("leaves out a record that can't be read, and keeps the other sites", async () => {
    for (const name of ["alpha.illinois.gov", "zeta.illinois.gov"]) {
      await record(await siteFolder(name), [sealed(1, JAN_15, copies(`${name}_2027-01-15`))]);
    }
    await plant(await siteFolder("b-not-json.illinois.gov"), "{ not json");
    await plant(
      await siteFolder("c-wrong-shape.illinois.gov"),
      JSON.stringify({ schemaVersion: 1, shares: ["x"] }),
    );
    // Not a file at all, so reading it fails in a way that isn't the record's own.
    await mkdir(sharesPath(await siteFolder("d-a-folder.illinois.gov")), { recursive: true });

    const { sites, leftOut } = await readSiteRecords(home);

    expect(sites.map(({ folder }) => folder)).toEqual(["alpha.illinois.gov", "zeta.illinois.gov"]);
    expect(leftOut).toEqual([
      "b-not-json.illinois.gov/share/shares.json: not a readable record of what was shared",
      "c-wrong-shape.illinois.gov/share/shares.json: not a readable record of what was shared",
      "d-a-folder.illinois.gov/share/shares.json: not a readable record of what was shared",
    ]);
  });

  it("never keeps a file named with a path, or as voicecap names none", async () => {
    const dir = await siteFolder("example.illinois.gov");
    const [page, word] = copies("example.illinois.gov_2027-01-15");
    // Each name, and how the output shows it: as JSON writes it, so that nothing in it is taken
    // for the line's own words.
    const odd: [name: string, shown: string][] = [
      ["../outside.html", '"../outside.html"'],
      ["/etc/passwd", '"/etc/passwd"'],
      ["a/b.html", '"a/b.html"'],
      ["a\\b.html", String.raw`"a\\b.html"`],
      ["x y.html", '"x y.html"'],
      ["..", '".."'],
    ];
    const oddFiles = odd.map(([name]) => ({ name, bytes: 5, sha256: "c".repeat(64) }));
    await record(dir, [sealed(1, JAN_15, [page, ...oddFiles, word])]);

    const { sites, leftOut } = await readSiteRecords(home);

    // The entry's other files are kept, in the order it lists them.
    expect(kept(sites).map(({ files }) => files)).toEqual([[page, word]]);
    expect(leftOut).toEqual(
      odd.map(
        ([, shown]) =>
          `${EXAMPLE_RECORD}: share 1 (${JAN_15}) names ${shown}, which isn't a file voicecap would publish`,
      ),
    );
  });

  it("leaves out a site folder voicecap would never name, and one named demo", async () => {
    // Each has a record whose entry is sound: it's the folder's name that leaves it out.
    for (const name of ["my site", "Upper.example.gov", "demo", "example.illinois.gov"]) {
      await record(await siteFolder(name), [sealed(1, JAN_15, copies(`${name}_2027-01-15`))]);
    }

    const { sites, demo, leftOut } = await readSiteRecords(home);

    expect(sites.map(({ folder }) => folder)).toEqual(["example.illinois.gov"]);
    // A folder named demo isn't the demo's either: that's voicecap-demo/.
    expect(demo).toBeNull();
    expect(leftOut).toEqual([
      `Upper.example.gov: ${BAD_FOLDER_NAME}`,
      "demo: not published: a site folder named demo would take the demo's place on the site",
      `my site: ${BAD_FOLDER_NAME}`,
    ]);
  });

  it("leaves out an entry it can't read: a seq that isn't one, an at that isn't a time, a by that isn't text", async () => {
    const dir = await siteFolder("example.illinois.gov");
    const files = copies("example.illinois.gov_2027-01-15");
    // Each is sealed over what it holds, so that it's the field, not the seal, that leaves it out.
    await record(dir, [
      sealed(1, JAN_15, files),
      sealed(2, JAN_14, files, { seq: "2" }),
      sealed(3, JAN_15, files, { seq: 0 }),
      sealed(4, JAN_16, files, { seq: 2.5 }),
      sealed(5, "not a time", files),
      sealed(6, JAN_15, files, { at: 20270115 }),
      sealed(7, JAN_15, files, { by: 7 }),
      sealed(8, JAN_17, files),
    ]);

    const { sites, leftOut } = await readSiteRecords(home);

    expect(kept(sites).map(({ seq }) => seq)).toEqual([1, 8]);
    // An entry with no seq to name it is named by its time.
    expect(leftOut).toEqual([
      `${EXAMPLE_RECORD}: a share at ${JAN_14} can't be published: its seq isn't what voicecap records`,
      `${EXAMPLE_RECORD}: a share at ${JAN_15} can't be published: its seq isn't what voicecap records`,
      `${EXAMPLE_RECORD}: a share at ${JAN_16} can't be published: its seq isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 5 (not a time) can't be published: its at isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 6 (20270115) can't be published: its at isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 7 (${JAN_15}) can't be published: its by isn't what voicecap records`,
    ]);
  });

  it("names the first of an entry's fields that isn't readable, in the order seq, at, by, files", async () => {
    const dir = await siteFolder("example.illinois.gov");
    await record(dir, [
      sealed(1, "not a time", "x", { seq: 0, by: 7 }),
      sealed(2, "not a time", "x", { by: 7 }),
      sealed(3, JAN_16, "x", { by: 7 }),
      sealed(4, JAN_17, "x"),
    ]);

    const { sites, leftOut } = await readSiteRecords(home);

    expect(sites).toEqual([]);
    expect(leftOut).toEqual([
      `${EXAMPLE_RECORD}: a share at not a time can't be published: its seq isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 2 (not a time) can't be published: its at isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 3 (${JAN_16}) can't be published: its by isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 4 (${JAN_17}) can't be published: its files isn't what voicecap records`,
    ]);
  });

  it("names an entry whose time can't be made into text as a share, and reads on", async () => {
    // An object whose toString isn't a function can't be made into text, so an entry can't be
    // named by its time when that's its time: it's "a share". A record is untrusted, so the entry
    // is left out like any other, and the read goes on.
    const dir = await siteFolder("example.illinois.gov");
    const files = copies("example.illinois.gov_2027-01-15");
    const hostile = { toString: 1 };
    await record(dir, [
      sealed(1, JAN_15, files),
      sealed(2, JAN_16, files, { at: hostile }),
      // The same time, and an entry that was changed after it was sealed.
      { ...sealed(3, JAN_17, files, { at: hostile }), by: "Someone Else" },
      sealed(4, JAN_17, files),
    ]);

    const { sites, leftOut } = await readSiteRecords(home);

    expect(kept(sites).map(({ seq }) => seq)).toEqual([1, 4]);
    expect(leftOut).toEqual([
      `${EXAMPLE_RECORD}: a share can't be published: its at isn't what voicecap records`,
      `${EXAMPLE_RECORD}: a share changed since it was recorded`,
    ]);
  });

  it("leaves out an entry nested too deep for its seal to be checked, and reads on", async () => {
    // sealOf reads an entry by recursion, so one nested this deep can't even be sealed here: the
    // record's text is planted, the way a person could leave it.
    const dir = await siteFolder("example.illinois.gov");
    const files = copies("example.illinois.gov_2027-01-15");
    const tooDeep = JSON.stringify({
      seq: 2,
      prev: null,
      at: JAN_16,
      by: "Pat Lee",
      runs: [],
      files,
      note: "DEEP",
      seal: "0".repeat(64),
    }).replace('"DEEP"', `${"[".repeat(20_000)}${"]".repeat(20_000)}`);
    await plant(
      dir,
      `{ "schemaVersion": 1, "shares": [${[
        JSON.stringify(sealed(1, JAN_15, files)),
        tooDeep,
        JSON.stringify(sealed(3, JAN_17, files)),
      ].join(", ")}] }`,
    );

    const { sites, leftOut } = await readSiteRecords(home);

    // The entry is one that changed, as far as anyone can tell, and the others are kept.
    expect(kept(sites).map(({ seq }) => seq)).toEqual([1, 3]);
    expect(leftOut).toEqual([
      `${EXAMPLE_RECORD}: share 2 (${JAN_16}) changed since it was recorded`,
    ]);
  });

  it("names an entry whose time is nested too deep to be made into text as a share", async () => {
    // Making a list text reads the lists in it, so this overflows too, in the name of the entry.
    const dir = await siteFolder("example.illinois.gov");
    const files = copies("example.illinois.gov_2027-01-15");
    const tooDeep = JSON.stringify({
      seq: 2,
      prev: null,
      at: "DEEP",
      by: "Pat Lee",
      runs: [],
      files,
      seal: "0".repeat(64),
    }).replace('"DEEP"', `${"[".repeat(20_000)}${"]".repeat(20_000)}`);
    await plant(
      dir,
      `{ "schemaVersion": 1, "shares": [${[JSON.stringify(sealed(1, JAN_15, files)), tooDeep].join(
        ", ",
      )}] }`,
    );

    const { sites, leftOut } = await readSiteRecords(home);

    expect(kept(sites).map(({ seq }) => seq)).toEqual([1]);
    expect(leftOut).toEqual([`${EXAMPLE_RECORD}: a share changed since it was recorded`]);
  });

  it("leaves out an entry whose time isn't both one Date.parse reads and one voicecap writes", async () => {
    // The site writes each time with format.ts, which reads only voicecap's own local ISO time, and
    // orders them with Date.parse. Each is a time to one of the two, and not to the other.
    const dir = await siteFolder("example.illinois.gov");
    const files = copies("example.illinois.gov_2027-01-15");
    await record(dir, [
      sealed(1, JAN_15, files),
      // Times to Date.parse, but not voicecap's.
      sealed(2, "1/15/2027", files),
      sealed(3, "2027-01-15", files),
      sealed(4, "Jan 15 2027 10:00", files),
      sealed(5, "2027-01-15T24:00:00-06:00", files),
      // Voicecap's start, with more after it that Date.parse can't read.
      sealed(6, "2027-01-15T10:00:00-06:00x", files),
    ]);

    const { sites, leftOut } = await readSiteRecords(home);

    expect(kept(sites).map(({ seq }) => seq)).toEqual([1]);
    expect(leftOut).toEqual([
      `${EXAMPLE_RECORD}: share 2 (1/15/2027) can't be published: its at isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 3 (2027-01-15) can't be published: its at isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 4 (Jan 15 2027 10:00) can't be published: its at isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 5 (2027-01-15T24:00:00-06:00) can't be published: its at isn't what voicecap records`,
      `${EXAMPLE_RECORD}: share 6 (2027-01-15T10:00:00-06:00x) can't be published: its at isn't what voicecap records`,
    ]);
  });

  it("leaves out an entry whose files aren't a list of files voicecap records", async () => {
    const dir = await siteFolder("example.illinois.gov");
    const good = copies("example.illinois.gov_2027-01-15");
    const shapes: unknown[] = [
      "page.html",
      [null],
      [{ name: "a.html", bytes: 5 }],
      [{ name: "a.html", bytes: "5", sha256: "a".repeat(64) }],
      [{ name: 5, bytes: 5, sha256: "a".repeat(64) }],
      // Sound files beside one that isn't: the entry's list isn't one voicecap wrote.
      [...good, { name: "b.docx" }],
    ];
    await record(dir, [
      sealed(1, JAN_15, good),
      ...shapes.map((files, index) => sealed(index + 2, JAN_15, files)),
    ]);

    const { sites, leftOut } = await readSiteRecords(home);

    expect(kept(sites).map(({ seq }) => seq)).toEqual([1]);
    expect(leftOut).toEqual(
      [2, 3, 4, 5, 6, 7].map(
        (seq) =>
          `${EXAMPLE_RECORD}: share ${seq} (${JAN_15}) can't be published: its files isn't what voicecap records`,
      ),
    );
  });

  it("keeps a walkthrough file's run only when it's a run id, and the file either way", async () => {
    // A run id, as the walkthrough file's own reader takes one: 1 to 100 letters, digits, ".", "_",
    // and "-". The run is printed on the site and in its output, so text that isn't one is dropped.
    const dir = await siteFolder("example.illinois.gov");
    const stem = "example.illinois.gov_2027-01-15";
    const withoutRun = (letter: string) => ({
      name: `${stem}_${letter}_walkthrough.json`,
      bytes: 30,
      sha256: "c".repeat(64),
    });
    const runs: [letter: string, run: unknown][] = [
      ["a", "2027-01-14_1315"],
      ["b", "a".repeat(100)],
      ["c", "a".repeat(101)],
      ["d", ""],
      ["e", "../../outside"],
      ["f", "2027-01-14_1315\n"],
      ["g", "2027-01-14 1315"],
    ];
    await record(dir, [
      sealed(
        1,
        JAN_15,
        runs.map(([letter, run]) => ({ ...withoutRun(letter), run })),
      ),
    ]);

    const { sites, leftOut } = await readSiteRecords(home);

    // Each file is kept, as it's named; a run that isn't an id is left off it.
    expect(kept(sites)[0]?.files).toStrictEqual([
      { ...withoutRun("a"), run: "2027-01-14_1315" },
      { ...withoutRun("b"), run: "a".repeat(100) },
      withoutRun("c"),
      withoutRun("d"),
      withoutRun("e"),
      withoutRun("f"),
      withoutRun("g"),
    ]);
    expect(leftOut).toEqual([]);
  });

  it("refuses a file name that starts with . or -, or ends with .", async () => {
    const dir = await siteFolder("example.illinois.gov");
    const [page, word] = copies("example.illinois.gov_2027-01-15");
    // A name with a dot first is a hidden file, one with a hyphen first can be taken for an option
    // by a command, and Windows drops a dot from the end. An underscore first is as an IPv6 site's
    // folder has it, so it's fine.
    const underscored = { name: "_x.html", bytes: 5, sha256: "d".repeat(64) };
    const refused = [".env", "-x.html", "x.html."];
    const refusedFiles = refused.map((name) => ({ name, bytes: 5, sha256: "c".repeat(64) }));
    await record(dir, [sealed(1, JAN_15, [page, ...refusedFiles, underscored, word])]);

    const { sites, leftOut } = await readSiteRecords(home);

    expect(kept(sites).map(({ files }) => files)).toEqual([[page, underscored, word]]);
    expect(leftOut).toEqual(
      refused.map(
        (name) =>
          `${EXAMPLE_RECORD}: share 1 (${JAN_15}) names "${name}", which isn't a file voicecap would publish`,
      ),
    );
  });

  it("keeps a site folder by its characters alone: an IPv6 site's starts with an underscore", async () => {
    // http://[::1]:4848 is the folder ___1__4848, and a URL can have a host with a hyphen first.
    // The rule about how a name starts and ends is for a file's name, not a folder's.
    const folders = ["-x.example.gov", "___1__4848"];
    for (const folder of folders) {
      await record(await siteFolder(folder), [sealed(1, JAN_15, copies("example_2027-01-15"))]);
    }

    const { sites, leftOut } = await readSiteRecords(home);

    expect(sites.map((site) => site.folder)).toEqual(folders);
    expect(leftOut).toEqual([]);
  });

  it("leaves out an entry with no file to publish, after naming the files it refused", async () => {
    const dir = await siteFolder("example.illinois.gov");
    const refused = (name: string) => ({ name, bytes: 5, sha256: "c".repeat(64) });
    await record(dir, [
      sealed(1, JAN_15, copies("example.illinois.gov_2027-01-15")),
      // Every name is one it won't publish.
      sealed(2, JAN_16, [refused("../outside.html"), refused(".env")]),
      // It records none at all.
      sealed(3, JAN_17, []),
    ]);

    const { sites, leftOut } = await readSiteRecords(home);

    expect(kept(sites).map(({ seq }) => seq)).toEqual([1]);
    expect(leftOut).toEqual([
      `${EXAMPLE_RECORD}: share 2 (${JAN_16}) names "../outside.html", which isn't a file voicecap would publish`,
      `${EXAMPLE_RECORD}: share 2 (${JAN_16}) names ".env", which isn't a file voicecap would publish`,
      `${EXAMPLE_RECORD}: share 2 (${JAN_16}) names no file voicecap would publish`,
      `${EXAMPLE_RECORD}: share 3 (${JAN_17}) names no file voicecap would publish`,
    ]);
  });

  it("writes each control character in a line of the output as an escape, a time's too", async () => {
    // A record is a file a person can edit, and its lines are printed to a terminal, so a time with a
    // line break and an ESC in it (as red text starts) must not reach it as it is: in an entry that
    // was changed, and in one whose seal holds.
    const dir = await siteFolder("example.illinois.gov");
    const files = copies("example.illinois.gov_2027-01-15");
    const at = `first\nsecond ${ESC}[31mred`;
    await record(dir, [{ ...sealed(1, at, files), by: "Someone Else" }, sealed(2, at, files)]);

    const { leftOut } = await readSiteRecords(home);

    const shown = `first${escaped("000a")}second ${escaped("001b")}[31mred`;
    expect(leftOut).toEqual([
      `${EXAMPLE_RECORD}: share 1 (${shown}) changed since it was recorded`,
      `${EXAMPLE_RECORD}: share 2 (${shown}) can't be published: its at isn't what voicecap records`,
    ]);
    expect(leftOut.filter((line) => RAW.test(line))).toEqual([]);
  });

  it("writes a file's name without what JSON leaves as it is: DEL, C1 controls, line separators", async () => {
    // JSON writes a character below U+0020 as an escape, so these are the ones it passes through.
    const dir = await siteFolder("example.illinois.gov");
    const [page, word] = copies("example.illinois.gov_2027-01-15");
    const odd: [name: string, shown: string][] = [
      [`a${DEL}.html`, `"a${escaped("007f")}.html"`],
      [`a${NEL}.html`, `"a${escaped("0085")}.html"`],
      [`a${LINE_SEPARATOR}.html`, `"a${escaped("2028")}.html"`],
      [`a${PARAGRAPH_SEPARATOR}.html`, `"a${escaped("2029")}.html"`],
      [`a${ESC}.html`, `"a${escaped("001b")}.html"`],
    ];
    const oddFiles = odd.map(([name]) => ({ name, bytes: 5, sha256: "c".repeat(64) }));
    await record(dir, [sealed(1, JAN_15, [page, ...oddFiles, word])]);

    const { sites, leftOut } = await readSiteRecords(home);

    expect(kept(sites).map(({ files }) => files)).toEqual([[page, word]]);
    expect(leftOut).toEqual(
      odd.map(
        ([, shown]) =>
          `${EXAMPLE_RECORD}: share 1 (${JAN_15}) names ${shown}, which isn't a file voicecap would publish`,
      ),
    );
    expect(leftOut.filter((line) => RAW.test(line))).toEqual([]);
  });

  it("writes a rejected folder's name without its control characters, the demo's too", async () => {
    // Names a person could give a folder on any system, Windows included.
    const names = [`a${DEL}`, `a${NEL}`, `a${LINE_SEPARATOR}`, `a${PARAGRAPH_SEPARATOR}`];
    for (const name of names) {
      await record(await siteFolder(name), [
        sealed(1, JAN_15, copies("example.illinois.gov_2027-01-15")),
      ]);
    }
    await record(await siteFolder(`b${NEL}`, demoRoot()), [
      sealed(1, JAN_15, copies("example.illinois.gov_2027-01-15")),
    ]);

    const { sites, demo, leftOut } = await readSiteRecords(home);

    expect(sites).toEqual([]);
    expect(demo).toBeNull();
    expect(leftOut).toEqual([
      `a${escaped("007f")}: ${BAD_FOLDER_NAME}`,
      `a${escaped("0085")}: ${BAD_FOLDER_NAME}`,
      `a${escaped("2028")}: ${BAD_FOLDER_NAME}`,
      `a${escaped("2029")}: ${BAD_FOLDER_NAME}`,
      `voicecap-demo/b${escaped("0085")}: ${BAD_FOLDER_NAME}`,
    ]);
  });

  // Windows doesn't allow an ESC in a name, so only a folder made elsewhere can have one.
  it.skipIf(process.platform === "win32")(
    "writes a rejected folder's name with an ESC in it as an escape, in the demo's folders too",
    async () => {
      const name = `a${ESC}[2Jb`;
      await record(await siteFolder(name), [sealed(1, JAN_15, copies("a_2027-01-15"))]);
      await record(await siteFolder(name, demoRoot()), [sealed(1, JAN_15, copies("a_2027-01-15"))]);

      const { leftOut } = await readSiteRecords(home);

      expect(leftOut).toEqual([
        `a${escaped("001b")}[2Jb: ${BAD_FOLDER_NAME}`,
        `voicecap-demo/a${escaped("001b")}[2Jb: ${BAD_FOLDER_NAME}`,
      ]);
    },
  );

  it("reads a home with nothing shared as nothing", async () => {
    // A site that never shared has no share/ folder, and one may have a record with no entries.
    await siteFolder("never.illinois.gov");
    await record(await siteFolder("empty.illinois.gov"), []);

    expect(await readSiteRecords(home)).toEqual({ sites: [], demo: null, leftOut: [] });
    // And so does a home that isn't there.
    expect(await readSiteRecords(path.join(home, "not-there"))).toEqual({
      sites: [],
      demo: null,
      leftOut: [],
    });
  });
});

describe("readSiteRecords, for the demo", () => {
  it("takes the demo's latest by the moment each time names, across the demo's site folders", async () => {
    // The latest is the first entry of the first folder: not the last one recorded, not the one
    // numbered highest, and not the one whose time is greatest as text (1:30 CDT comes before
    // 1:10 CST, though its text is greater).
    const first = await siteFolder("127.0.0.1_4848", demoRoot());
    await record(first, [
      sealed(1, CST, copies("127.0.0.1_4848_2027-11-07")),
      sealed(2, CDT, copies("127.0.0.1_4848_2027-11-07-2")),
    ]);
    const second = await siteFolder("127.0.0.1_4849", demoRoot());
    await record(second, [sealed(1, JAN_17, copies("127.0.0.1_4849_2027-01-17"))]);

    const { demo } = await readSiteRecords(home);

    expect(demo).toMatchObject({ folder: "127.0.0.1_4848", seq: 1, at: CST });
  });

  it("takes the one with the higher seq when two entries share a moment", async () => {
    // The same moment, spelled in two ways. The folders come in order of name, so neither the
    // first nor the last of them is the one to take.
    const folders = [
      ["127.0.0.1_4848", 1, JAN_15],
      ["127.0.0.1_4849", 3, "2027-01-15T16:00:00+00:00"],
      ["127.0.0.1_4850", 2, JAN_15],
    ] as const;
    for (const [name, seq, at] of folders) {
      await record(await siteFolder(name, demoRoot()), [
        sealed(seq, at, copies(`${name}_2027-01-15`)),
      ]);
    }

    const { demo } = await readSiteRecords(home);

    expect(demo).toMatchObject({ folder: "127.0.0.1_4849", seq: 3 });
  });

  it("leaves out of the demo what it leaves out of a site, by its path from the home", async () => {
    await record(await siteFolder("my site", demoRoot()), [
      sealed(1, JAN_17, copies("my site_2027-01-17")),
    ]);
    await plant(await siteFolder("127.0.0.1_4849", demoRoot()), "{ not json");
    await record(await siteFolder("127.0.0.1_4850", demoRoot()), [
      { ...sealed(1, JAN_16, copies("127.0.0.1_4850_2027-01-16")), by: "Someone Else" },
      sealed(2, JAN_15, copies("127.0.0.1_4850_2027-01-15")),
    ]);

    const { sites, demo, leftOut } = await readSiteRecords(home);

    // What is left of the demo is the one entry that can be read.
    expect(demo).toMatchObject({ folder: "127.0.0.1_4850", seq: 2 });
    expect(sites).toEqual([]);
    expect(leftOut).toEqual([
      "voicecap-demo/127.0.0.1_4849/share/shares.json: not a readable record of what was shared",
      `voicecap-demo/127.0.0.1_4850/share/shares.json: share 1 (${JAN_16}) changed since it was recorded`,
      `voicecap-demo/my site: ${BAD_FOLDER_NAME}`,
    ]);
  });

  it("lets a site folder of the demo be named demo, which the home's own can't be", async () => {
    await record(await siteFolder("demo", demoRoot()), [
      sealed(1, JAN_15, copies("demo_2027-01-15")),
    ]);

    const { demo, leftOut } = await readSiteRecords(home);

    expect(demo).toMatchObject({ folder: "demo", seq: 1 });
    expect(leftOut).toEqual([]);
  });

  it("takes the latest entry that has a file to publish", async () => {
    // The latest by time has none, so it's left out, and the one before it is the demo.
    await record(await siteFolder("127.0.0.1_4848", demoRoot()), [
      sealed(1, JAN_15, copies("127.0.0.1_4848_2027-01-15")),
      sealed(2, JAN_17, []),
    ]);

    const { demo, leftOut } = await readSiteRecords(home);

    expect(demo).toMatchObject({ folder: "127.0.0.1_4848", seq: 1, at: JAN_15 });
    expect(leftOut).toEqual([
      `voicecap-demo/127.0.0.1_4848/share/shares.json: share 2 (${JAN_17}) names no file voicecap would publish`,
    ]);
  });
});
