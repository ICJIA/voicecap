/**
 * share/shares.json, the record of what was sent: read, and added to one entry at a time, chained
 * and sealed as reviews.json is, and never overwritten when it can't be read.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { shareDir, sharePath, sharesPath, shareWordPath } from "../src/run/paths.js";
import { appendShare, isSeq, readShares, recordedNames } from "../src/share/shares.js";
import { UsageError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";

const FILES = [
  { name: "x_2026-09-30.html", bytes: 10, sha256: "a".repeat(64) },
  { name: "x_2026-09-30.docx", bytes: 20, sha256: "b".repeat(64) },
];
const entry = {
  at: "2026-09-30T10:00:00-05:00",
  by: "Pat Lee",
  runs: ["2026-09-29_1315", "2026-09-29_1402"],
  files: FILES,
};

/** An entry's keys, in the order the file reads them. */
const KEYS = ["seq", "prev", "at", "by", "runs", "files", "seal"];

/** The site's folder: new for each test, and empty, with no share/ folder in it yet. */
let siteDir: string;

beforeEach(async () => {
  siteDir = await mkdtemp(path.join(tmpdir(), "voicecap-shares-"));
});

afterEach(async () => {
  await rm(siteDir, { recursive: true, force: true });
});

/** Leave `text` where the record is, as a person or another program might have left it. */
async function plant(text: string): Promise<void> {
  await mkdir(shareDir(siteDir), { recursive: true });
  await writeFile(sharesPath(siteDir), text);
}

/**
 * That a call was refused as a record it can't use: with a UsageError that names the file, says
 * voicecap never overwrites the record of what was shared, and says to fix it or restore it.
 */
async function expectRefused(call: Promise<unknown>): Promise<void> {
  await expect(call).rejects.toThrow(UsageError);
  await expect(call).rejects.toThrow(sharesPath(siteDir));
  await expect(call).rejects.toThrow(/never overwrites the record of what was shared/);
  await expect(call).rejects.toThrow(/fix the file or restore it from version control/);
}

describe("sharesPath", () => {
  it("is share/shares.json in the site's folder, beside the page and its Word copy", () => {
    const site = path.join("home", "dvfr.illinois.gov");
    expect(sharesPath(site)).toBe(path.join(site, "share", "shares.json"));
    expect(path.dirname(sharesPath(site))).toBe(path.dirname(sharePath(site)));
    expect(path.dirname(sharesPath(site))).toBe(path.dirname(shareWordPath(site)));
  });
});

describe("readShares", () => {
  it("gives an empty record for a site that has shared nothing", async () => {
    expect(await readShares(siteDir)).toEqual({ schemaVersion: 1, shares: [] });
    // It only reads: nothing is made for a site that has shared nothing.
    expect(await readdir(siteDir)).toEqual([]);
  });

  it("reads an empty list of shares as the record it is", async () => {
    await plant(JSON.stringify({ schemaVersion: 1, shares: [] }));
    expect(await readShares(siteDir)).toEqual({ schemaVersion: 1, shares: [] });
    expect(await appendShare(siteDir, entry)).toMatchObject({ seq: 1, prev: null });
  });

  it("reads a file that starts with a byte order mark, as a Windows editor leaves one", async () => {
    const first = await appendShare(siteDir, entry);
    await plant(`\uFEFF${await readFile(sharesPath(siteDir), "utf8")}`);
    expect(await readShares(siteDir)).toEqual({ schemaVersion: 1, shares: [first] });
    // And it's added to as any record is: an editor's mark is no reason to refuse it.
    const second = await appendShare(siteDir, { ...entry, at: "2026-09-30T11:00:00-05:00" });
    expect(second).toMatchObject({ seq: 2, prev: first.seal });
  });

  it.each([
    ["text that isn't JSON", "{ not json"],
    ["an empty file", ""],
    ["a file cut off in the middle", '{ "schemaVersion": 1, "shares": [ { "seq": 1, '],
  ])("refuses %s, and keeps the JSON error as the cause", async (_what, text) => {
    await plant(text);
    const read = readShares(siteDir);
    await expectRefused(read);
    await expect(read).rejects.toHaveProperty("cause", expect.any(SyntaxError));
  });

  it("refuses a record that isn't a list of shares", async () => {
    await plant(JSON.stringify({ schemaVersion: 1, shares: ["x"] }));
    await expect(readShares(siteDir)).rejects.toThrow(UsageError);
  });

  it.each<[string, unknown]>([
    ["an entry that is null", { schemaVersion: 1, shares: [null] }],
    ["an entry that is a list", { schemaVersion: 1, shares: [[]] }],
    ["an entry that is a number", { schemaVersion: 1, shares: [{}, 3] }],
    ["shares that is an object, not a list", { schemaVersion: 1, shares: {} }],
    ["shares that is null", { schemaVersion: 1, shares: null }],
    ["no shares", { schemaVersion: 1 }],
    ["a schemaVersion other than 1", { schemaVersion: 2, shares: [] }],
    ["a schemaVersion that is text", { schemaVersion: "1", shares: [] }],
    ["no schemaVersion", { shares: [] }],
    ["a list in place of the record", []],
    ["null in place of the record", null],
    ["text in place of the record", "shares"],
  ])("refuses a record with %s", async (_what, record) => {
    await plant(JSON.stringify(record));
    await expectRefused(readShares(siteDir));
  });
});

describe("appendShare", () => {
  it("chains and seals each entry, as reviews are", async () => {
    const first = await appendShare(siteDir, entry);
    const second = await appendShare(siteDir, { ...entry, at: "2026-09-30T11:00:00-05:00" });
    expect(first).toMatchObject({ seq: 1, prev: null });
    expect(first.seal).toBe(sealOf(first));
    expect(second).toMatchObject({ seq: 2, prev: first.seal });
    expect(second.seal).toBe(sealOf(second));
    expect((await readShares(siteDir)).shares).toEqual([first, second]);
  });

  it("chains a third entry from the second", async () => {
    const first = await appendShare(siteDir, entry);
    const second = await appendShare(siteDir, { ...entry, at: "2026-09-30T11:00:00-05:00" });
    const third = await appendShare(siteDir, { ...entry, at: "2026-09-30T12:00:00-05:00" });
    expect(third).toMatchObject({ seq: 3, prev: second.seal });
    expect(third.seal).toBe(sealOf(third));
    expect((await readShares(siteDir)).shares).toEqual([first, second, third]);
  });

  it("takes seq from one past the highest in the file, and prev from the entry that has it", async () => {
    const numbered = (seq: number) => ({ ...entry, seq, prev: null, seal: String(seq).repeat(64) });
    // Out of order, so that the last entry isn't the highest.
    await plant(
      JSON.stringify({ schemaVersion: 1, shares: [numbered(2), numbered(3), numbered(1)] }),
    );
    expect(await appendShare(siteDir, entry)).toMatchObject({ seq: 4, prev: "3".repeat(64) });
  });

  it("leaves an entry without a numeric seq out of the chain", async () => {
    const unnumbered = { ...entry, seal: "e".repeat(64) };
    await plant(
      JSON.stringify({ schemaVersion: 1, shares: [unnumbered, { ...unnumbered, seq: "7" }] }),
    );
    expect(await appendShare(siteDir, entry)).toMatchObject({ seq: 1, prev: null });

    const numbered = { ...entry, seq: 5, prev: null, seal: "f".repeat(64) };
    await plant(JSON.stringify({ schemaVersion: 1, shares: [numbered, unnumbered] }));
    expect(await appendShare(siteDir, entry)).toMatchObject({ seq: 6, prev: "f".repeat(64) });
  });

  // The next entry follows the highest one by its seal. A seal that isn't text can't be followed,
  // so prev is null: not the number or list that was there, and not an earlier entry's seal.
  it.each<[string, Record<string, unknown>]>([
    ["a number", { seal: 7 }],
    ["null", { seal: null }],
    ["a list", { seal: ["f".repeat(64)] }],
    ["missing", {}],
  ])("gives prev as null when the highest entry's seal is %s, not text", async (_what, seal) => {
    const lower = { ...entry, seq: 1, prev: null, seal: "e".repeat(64) };
    const highest = { ...entry, seq: 2, prev: null, ...seal };
    await plant(JSON.stringify({ schemaVersion: 1, shares: [lower, highest] }));
    expect(await appendShare(siteDir, entry)).toMatchObject({ seq: 3, prev: null });
    const written = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as {
      shares: { prev: unknown }[];
    };
    expect(written.shares.at(-1)?.prev).toBeNull();
  });

  // The rule `voicecap verify` chains by: a whole number, 1 or more. JSON can say 1e999 only as
  // that, and it reads as Infinity, which writes back as null.
  it("counts only a seq that is a whole number of 1 or more", async () => {
    const sealed = (seq: string, seal: string) =>
      `{ "seq": ${seq}, "prev": null, "at": "x", "by": "x", "runs": [], "files": [], "seal": "${seal.repeat(64)}" }`;
    const odd = [
      sealed("2.5", "a"),
      sealed("1e999", "b"),
      sealed("0", "c"),
      sealed("-1", "d"),
      sealed('"7"', "e"),
      sealed("null", "f"),
    ];
    // Of these, none is a place in the chain.
    await plant(`{ "schemaVersion": 1, "shares": [${odd.join(", ")}] }`);
    expect(await appendShare(siteDir, entry)).toMatchObject({ seq: 1, prev: null });

    // And none is the one that the next entry follows, when a numbered entry is beside them.
    await plant(`{ "schemaVersion": 1, "shares": [${[...odd, sealed("3", "3")].join(", ")}] }`);
    expect(await appendShare(siteDir, entry)).toMatchObject({ seq: 4, prev: "3".repeat(64) });
    const written = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as {
      shares: { seq: unknown }[];
    };
    expect(written.shares.at(-1)?.seq).toBe(4);
  });

  it("gives back the entry it recorded, not the file, with its keys in the order a reader sees", async () => {
    const recorded = await appendShare(siteDir, entry);
    expect(Object.keys(recorded)).toEqual(KEYS);
    const written = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as { shares: object[] };
    expect(Object.keys(written.shares[0]!)).toEqual(KEYS);
  });

  // 0.10.0: the root of the site the copies are named for, after who made them.
  it("records the site it's given, sealed with the rest, and with its key after by", async () => {
    const site = "https://voicecap.netlify.app/demo-site/";
    const recorded = await appendShare(siteDir, { ...entry, site });
    expect(recorded.site).toBe(site);
    expect(Object.keys(recorded)).toEqual([
      "seq",
      "prev",
      "at",
      "by",
      "site",
      "runs",
      "files",
      "seal",
    ]);
    // The seal holds, and covers the site: an entry that named another site has another seal.
    expect(recorded.seal).toBe(sealOf(recorded));
    expect(sealOf({ ...recorded, site: "https://dvfr.illinois.gov/" })).not.toBe(recorded.seal);
    const written = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as { shares: object[] };
    expect(written.shares).toEqual([recorded]);
    expect(Object.keys(written.shares[0]!)).toEqual(Object.keys(recorded));
  });

  it("records no site for an entry that has none, as an entry from before 0.10.0 has none", async () => {
    const recorded = await appendShare(siteDir, entry);
    expect(recorded).not.toHaveProperty("site");
    // Not as a key left undefined either: the file has none.
    const written = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as {
      shares: Record<string, unknown>[];
    };
    expect(Object.hasOwn(written.shares[0]!, "site")).toBe(false);
    // And it's chained from entries that have none, and from entries that have one.
    const second = await appendShare(siteDir, { ...entry, site: "https://dvfr.illinois.gov/" });
    expect(second).toMatchObject({ seq: 2, prev: recorded.seal });
    const third = await appendShare(siteDir, entry);
    expect(third).toMatchObject({ seq: 3, prev: second.seal });
  });

  // 0.12.3: what the copies say of the site, which the website's card shows, after the runs.
  it("records the result it's given, sealed with the rest, and with its key after runs", async () => {
    const result = { pages: 9, read: 9, problems: 0, problemPages: 0 };
    const recorded = await appendShare(siteDir, {
      ...entry,
      site: "https://sfs.icjia.illinois.gov/",
      result,
    });
    expect(recorded.result).toEqual(result);
    expect(Object.keys(recorded)).toEqual([
      "seq",
      "prev",
      "at",
      "by",
      "site",
      "runs",
      "result",
      "files",
      "seal",
    ]);
    // In the order the file reads them, whatever order it's handed them in.
    expect(Object.keys(recorded.result ?? {})).toEqual([
      "pages",
      "read",
      "problems",
      "problemPages",
    ]);
    // The seal holds, and covers the result: an entry that said otherwise has another seal.
    expect(recorded.seal).toBe(sealOf(recorded));
    expect(sealOf({ ...recorded, result: { ...result, problems: 1, problemPages: 1 } })).not.toBe(
      recorded.seal,
    );
    const written = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as { shares: object[] };
    expect(written.shares).toEqual([recorded]);
  });

  it("writes a result's numbers in one order, and nothing else it's handed in one", async () => {
    const handed = { problemPages: 2, extra: "x", read: 30, problems: 3, pages: 32 };
    const recorded = await appendShare(siteDir, {
      ...entry,
      result: handed,
    });
    expect(recorded.result).toEqual({ pages: 32, read: 30, problems: 3, problemPages: 2 });
    expect(Object.keys(recorded.result ?? {})).toEqual([
      "pages",
      "read",
      "problems",
      "problemPages",
    ]);
  });

  it("records no result for an entry that has none, as an entry from before 0.12.3 has none", async () => {
    const recorded = await appendShare(siteDir, entry);
    expect(recorded).not.toHaveProperty("result");
    const written = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as {
      shares: Record<string, unknown>[];
    };
    expect(Object.hasOwn(written.shares[0]!, "result")).toBe(false);
  });

  it("chains the entry itself: a seq, prev, or seal it's handed, or any other field, isn't kept", async () => {
    const handed = { ...entry, seq: 99, prev: "z".repeat(64), seal: "y".repeat(64), extra: "x" };
    const recorded = await appendShare(siteDir, handed);
    const chained = { seq: 1, prev: null, ...entry };
    expect(recorded).toEqual({ ...chained, seal: sealOf(chained) });
    expect(recorded).not.toHaveProperty("extra");
  });

  it("keeps every earlier entry, and any field of the file it doesn't know, as they were", async () => {
    const body = { seq: 1, prev: null, ...entry, note: "kept" };
    const earlier = { ...body, seal: sealOf(body) };
    await plant(JSON.stringify({ schemaVersion: 1, note: "kept too", shares: [earlier] }, null, 4));
    const added = await appendShare(siteDir, entry);
    const written = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as {
      note: string;
      shares: unknown[];
    };
    expect(written.note).toBe("kept too");
    expect(written.shares).toEqual([earlier, added]);
    expect(added).toMatchObject({ seq: 2, prev: earlier.seal });
  });

  it("writes JSON with two-space indents and a final newline", async () => {
    const first = await appendShare(siteDir, entry);
    const written = await readFile(sharesPath(siteDir), "utf8");
    const record = {
      schemaVersion: 1,
      shares: [{ seq: 1, prev: null, ...entry, seal: first.seal }],
    };
    expect(written).toBe(`${JSON.stringify(record, null, 2)}\n`);
    expect(written.split("\n").slice(0, 4)).toEqual([
      "{",
      '  "schemaVersion": 1,',
      '  "shares": [',
      "    {",
    ]);
    expect(written.endsWith("}\n")).toBe(true);
  });

  it("makes the share folder when the site has none yet", async () => {
    expect(await readdir(siteDir)).toEqual([]);
    const first = await appendShare(siteDir, entry);
    expect(await readdir(siteDir)).toEqual(["share"]);
    // Only the record is left in it: the file it was written through is gone.
    expect(await readdir(path.join(siteDir, "share"))).toEqual(["shares.json"]);
    const written = await readFile(path.join(siteDir, "share", "shares.json"), "utf8");
    expect(JSON.parse(written)).toEqual({ schemaVersion: 1, shares: [first] });
  });

  // Review Focus 5.
  it("never overwrites a record it can't read", async () => {
    await plant("{ not json");
    await expect(appendShare(siteDir, entry)).rejects.toThrow(
      /never overwrites the record of what was shared/,
    );
    expect(await readFile(sharesPath(siteDir), "utf8")).toBe("{ not json");
  });

  it("leaves a record of the wrong shape exactly as it was", async () => {
    await plant('{\n  "schemaVersion": 1,\n  "shares": ["x"]\n}\n');
    const before = await readFile(sharesPath(siteDir));
    await expectRefused(appendShare(siteDir, entry));
    expect(await readFile(sharesPath(siteDir))).toEqual(before);
    // And nothing else is left beside it.
    expect(await readdir(shareDir(siteDir))).toEqual(["shares.json"]);
  });
});

describe("isSeq", () => {
  it("takes a whole number of 1 or more, and nothing else", () => {
    for (const seq of [1, 2, 41]) expect(isSeq(seq)).toBe(true);
    const not = [0, -1, 2.5, Infinity, -Infinity, NaN, "1", null, undefined, true, [1], {}];
    for (const seq of not) expect(isSeq(seq)).toBe(false);
  });
});

describe("recordedNames", () => {
  it("names the file of each well-formed item of each entry that lists its files", () => {
    const names = recordedNames([
      { seq: 1, files: FILES },
      { seq: 2, files: [{ name: "b.html" }, { name: "c.docx", bytes: 1 }] },
    ]);
    expect(names).toEqual(new Set([...FILES.map(({ name }) => name), "b.html", "c.docx"]));
  });

  it("takes an entry whose files aren't a list, and an item with no name, as naming nothing", () => {
    const odd = [
      null,
      7,
      "x_2026-09-30.html",
      ["x_2026-09-30.html"],
      {},
      { files: "x_2026-09-30.html" },
      { files: { name: "x_2026-09-30.html" } },
      {
        files: [null, 7, "x_2026-09-30.html", ["x_2026-09-30.html"], {}, { name: 5 }, { bytes: 1 }],
      },
    ];
    expect(recordedNames(odd)).toEqual(new Set());
    expect(recordedNames([])).toEqual(new Set());
  });

  it("keeps the good names of an entry that has odd items beside them", () => {
    const names = recordedNames([{ files: [null, { name: 5 }, { name: "a.docx" }, 7] }]);
    expect(names).toEqual(new Set(["a.docx"]));
  });
});
