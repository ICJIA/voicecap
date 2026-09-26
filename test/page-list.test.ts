import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPageList } from "../src/pages/page-list.js";
import { UsageError } from "../src/util/errors.js";

const FIXTURE = fileURLToPath(new URL("../fixture/", import.meta.url));
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-pages-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, content: string | Uint8Array): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

describe("readPageList: fixture files", () => {
  it("reads pages.json with line numbers, labels, and templates", async () => {
    const list = await readPageList(path.join(FIXTURE, "pages.json"));
    expect(list.format).toBe("json");
    expect(list.encoding).toBe("utf-8");
    expect(list.invalid).toEqual([]);
    expect(list.entries.map((e) => [e.value, e.line])).toEqual([
      ["/", 2],
      ["/duplicates/", 4],
      ["http://127.0.0.1:4747/flawed/", 10],
      // Malformed, but that's decided when the URL is resolved (see resolve.test.ts).
      ["http://[not-a-host]/broken/", 16],
    ]);
    expect(list.entries[1]).toMatchObject({ label: "Duplicate lines", template: "content" });
  });

  it("reads pages.csv: BOM, CRLF, quoted fields, a blank line, and a multi-line note", async () => {
    const list = await readPageList(path.join(FIXTURE, "pages.csv"));
    expect(list.format).toBe("csv");
    expect(list.encoding).toBe("utf-8");
    expect(list.warnings).toEqual([]);
    expect(list.entries.map((e) => [e.value, e.line])).toEqual([
      ["/", 2],
      ["/duplicates/", 3],
      ["http://127.0.0.1:4747/flawed/", 5],
    ]);
    expect(list.entries[0]).toEqual({ value: "/", line: 2, label: "Home", template: "home" });
    expect(list.entries[1]).toMatchObject({
      label: "Duplicate lines, end-of-page test",
      notes: 'The last line, "Back to top", also appears earlier.',
    });
    expect(list.entries[2]!.notes).toBe(
      "Generic link text,\nan unlabeled button, and no skip link.",
    );
    // The row after the multi-line note starts on line 7.
    expect(list.invalid).toEqual([
      { line: 7, value: ",Row with no URL (invalid on purpose),,", reason: "empty url" },
    ]);
  });

  it("decodes a Windows-1252 CSV and recommends CSV UTF-8", async () => {
    const list = await readPageList(path.join(FIXTURE, "pages-windows-1252.csv"));
    expect(list.encoding).toBe("windows-1252");
    expect(list.warnings).toHaveLength(1);
    expect(list.warnings[0]).toMatch(/Windows-1252/);
    expect(list.warnings[0]).toMatch(/CSV UTF-8/);
    expect(list.entries.map((e) => [e.value, e.label, e.line])).toEqual([
      ["/", "“Home” – FY27", 2],
      ["/duplicates/", "Duplicate lines – “Back to top”", 3],
      ["http://127.0.0.1:4747/flawed/", "Flawed – résumé page", 4],
    ]);
    expect(list.entries[0]!.notes).toBe("Café notes");
  });

  it("hashes the file's bytes as read", async () => {
    const file = path.join(FIXTURE, "pages.csv");
    const expected = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    expect((await readPageList(file)).sha256).toBe(expected);
  });
});

describe("readPageList: CSV", () => {
  it("matches header names case-insensitively and ignores unknown columns", async () => {
    const file = await write("header.csv", " URL ,Label,Owner\n/a,Alpha,Jane\n/b,,\n");
    const list = await readPageList(file);
    expect(list.entries).toEqual([
      { value: "/a", line: 2, label: "Alpha" },
      { value: "/b", line: 3 },
    ]);
  });

  it("rejects a file without a url column", async () => {
    const file = await write("nourl.csv", "address,label\n/a,Alpha\n");
    await expect(readPageList(file)).rejects.toThrow(UsageError);
    await expect(readPageList(file)).rejects.toThrow(/no "url" column/);
  });

  it("rejects an empty file", async () => {
    const file = await write("empty.csv", "\r\n\r\n");
    await expect(readPageList(file)).rejects.toThrow(/empty/);
  });

  it("returns no entries for a header-only file", async () => {
    const file = await write("header-only.csv", "url,label\r\n");
    expect((await readPageList(file)).entries).toEqual([]);
  });

  it("keeps line numbers exact after multi-line CRLF fields and blank lines", async () => {
    const csv = [
      "url,notes",
      '/a,"one\r\ntwo\r\nthree"',
      "",
      "",
      "/b,x",
      "   ",
      '/c,"quote ""inside"""',
    ].join("\r\n");
    const list = await readPageList(await write("lines.csv", csv));
    expect(list.entries.map((e) => [e.value, e.line, e.notes])).toEqual([
      ["/a", 2, "one\ntwo\nthree"],
      ["/b", 7, "x"],
      ["/c", 9, 'quote "inside"'],
    ]);
  });

  it("reports rows with an empty url and continues", async () => {
    const list = await readPageList(
      await write("gaps.csv", "url,label\n,First\n/b,Second\n  ,Third\n"),
    );
    expect(list.entries.map((e) => e.value)).toEqual(["/b"]);
    expect(list.invalid.map((i) => [i.line, i.reason])).toEqual([
      [2, "empty url"],
      [4, "empty url"],
    ]);
  });

  it("warns about duplicate columns and uses the first", async () => {
    const list = await readPageList(await write("dupcol.csv", "url,url,label\n/a,/b,A\n"));
    expect(list.entries).toEqual([{ value: "/a", line: 2, label: "A" }]);
    expect(list.warnings[0]).toMatch(/column "url" appears more than once/);
  });

  it("rejects malformed CSV", async () => {
    const file = await write("bad.csv", 'url\n"/a\n');
    await expect(readPageList(file)).rejects.toThrow(/not valid CSV/);
  });
});

describe("readPageList: JSON", () => {
  it("accepts an array of URL strings", async () => {
    const list = await readPageList(
      await write("strings.json", '[\n  "/a",\n  "https://x.gov/b"\n]\n'),
    );
    expect(list.entries).toEqual([
      { value: "/a", line: 2 },
      { value: "https://x.gov/b", line: 3 },
    ]);
  });

  it("accepts a BOM, comments, and trailing commas", async () => {
    const text = '\uFEFF[\n  // home\n  "/",\n  { "url": "/b", "notes": "n" },\n]\n';
    const list = await readPageList(await write("lenient.json", text));
    expect(list.entries).toEqual([
      { value: "/", line: 3 },
      { value: "/b", line: 4, notes: "n" },
    ]);
  });

  it("reports elements without a usable url, with their lines", async () => {
    const text = [
      "[",
      '  { "label": "no url" },',
      '  { "url": 42 },',
      "  17,",
      '  "",',
      '  { "url": "/ok", "label": 2026, "extra": true }',
      "]",
    ].join("\n");
    const list = await readPageList(await write("mixed.json", text));
    expect(list.entries).toEqual([{ value: "/ok", line: 6, label: "2026" }]);
    expect(list.invalid.map((i) => [i.line, i.reason])).toEqual([
      [2, 'missing "url"'],
      [3, '"url" must be a string'],
      [4, "expected a URL string or an object with a url"],
      [5, "empty url"],
    ]);
    expect(list.warnings[0]).toMatch(/unknown key "extra"/);
  });

  it("rejects JSON that isn't an array", async () => {
    const file = await write("object.json", '{ "url": "/a" }');
    await expect(readPageList(file)).rejects.toThrow(/must contain a JSON array/);
  });

  it("rejects invalid JSON, citing line and column", async () => {
    const file = await write("syntax.json", '[\n  "/a"\n  "/b"\n]');
    await expect(readPageList(file)).rejects.toThrow(/line 3, column 3/);
  });
});

describe("readPageList: files", () => {
  it("rejects other extensions", async () => {
    const file = await write("pages.txt", "/a\n");
    await expect(readPageList(file)).rejects.toThrow(/\.csv or \.json/);
  });

  it("reports a missing file as a usage error", async () => {
    await expect(readPageList(path.join(dir, "missing.csv"))).rejects.toThrow(UsageError);
  });
});
