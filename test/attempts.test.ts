import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { keepEarlierAttempt } from "../src/run/attempts.js";
import { attemptsDir, pageDir } from "../src/run/paths.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-attempts-"));
const RUN_ID = "2026-09-27_1102";

describe("keepEarlierAttempt", () => {
  it("moves an earlier attempt aside instead of deleting it", async () => {
    const site = await tmp();
    const page = pageDir(site, RUN_ID, "faq");
    await mkdir(page, { recursive: true });
    await writeFile(path.join(page, "read.txt"), "first attempt");

    const first = await keepEarlierAttempt(site, RUN_ID, "faq");
    expect(first).toBe(path.join(attemptsDir(site, RUN_ID, "faq"), "1"));
    expect(await readFile(path.join(first!, "read.txt"), "utf8")).toBe("first attempt");
    expect(existsSync(page)).toBe(false);

    await mkdir(page, { recursive: true });
    await writeFile(path.join(page, "read.txt"), "second attempt");
    const second = await keepEarlierAttempt(site, RUN_ID, "faq");
    expect(second).toBe(path.join(attemptsDir(site, RUN_ID, "faq"), "2"));
    expect(await readFile(path.join(second!, "read.txt"), "utf8")).toBe("second attempt");
    // The first attempt is untouched by the second move.
    expect(await readFile(path.join(first!, "read.txt"), "utf8")).toBe("first attempt");
  });

  it("does nothing for a page that has no folder yet", async () => {
    const site = await tmp();
    expect(await keepEarlierAttempt(site, RUN_ID, "faq")).toBeNull();
    expect(existsSync(attemptsDir(site, RUN_ID, "faq"))).toBe(false);
  });

  it("does nothing for a page folder that exists but is empty", async () => {
    const site = await tmp();
    const page = pageDir(site, RUN_ID, "faq");
    await mkdir(page, { recursive: true });

    expect(await keepEarlierAttempt(site, RUN_ID, "faq")).toBeNull();
    expect(existsSync(attemptsDir(site, RUN_ID, "faq"))).toBe(false);
    // Nothing was deleted either: the empty folder is left as it was.
    expect(existsSync(page)).toBe(true);
  });
});
