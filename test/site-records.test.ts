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
    // An object whose toString isn't a function can't be made into text, so the way `voicecap
    // verify` names an entry (by its seq and time) can't name one that has such a time. A record is
    // untrusted, so that entry is left out like any other, and the read goes on.
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
});
