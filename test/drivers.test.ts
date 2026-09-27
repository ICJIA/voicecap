import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { AtDriverNvdaDriver } from "../src/drivers/at-driver-nvda.js";
import { createDriver, selectDriver } from "../src/drivers/index.js";
import { InterruptedError } from "../src/passes/steps.js";
import { handleInterrupts } from "../src/run/signals.js";
import { EnvironmentError, UsageError } from "../src/util/errors.js";
import { createMemoryLogger, silentLogger } from "../src/util/log.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const context = { config: DEFAULT_CONFIG, logger: silentLogger };

describe("driver selection", () => {
  it("--replay-from selects the replay driver, whatever the config says", () => {
    const selection = selectDriver(DEFAULT_CONFIG, "fixture/replay-run", "/work");
    expect(selection).toMatchObject({ name: "replay", replayLabel: "fixture/replay-run" });
    expect(path.isAbsolute(selection.replayFrom ?? "")).toBe(true);
  });

  it("driver: replay without a folder is a usage error", () => {
    expect(() => selectDriver({ ...DEFAULT_CONFIG, driver: "replay" }, null, "/work")).toThrow(
      UsageError,
    );
  });

  it("NVDA drivers explain that NVDA needs Windows", async () => {
    for (const name of ["guidepup", "at-driver"] as const) {
      await expect(
        createDriver({ name, replayFrom: null, replayLabel: null }, context, "darwin"),
      ).rejects.toBeInstanceOf(EnvironmentError);
    }
  });

  it("creates the Guidepup NVDA driver on Windows, without starting NVDA", async () => {
    const driver = await createDriver(
      { name: "guidepup", replayFrom: null, replayLabel: null },
      context,
      "win32",
    );
    expect(driver.name).toBe("guidepup");
  });
});

describe("AT Driver stub", () => {
  it("throws a clear 'not implemented' error from every method", async () => {
    const driver = new AtDriverNvdaDriver();
    const calls = [
      () => driver.start(),
      () => driver.stop(),
      () => driver.getEnvironmentInfo(),
      () => driver.cleanupStale(),
      () => driver.openPage("https://example.illinois.gov/"),
      () => driver.nextLine(),
      () => driver.nextHeading(),
      () => driver.nextFocusable(),
      () => driver.toTop(),
      () => driver.toBottom(),
      () => driver.focusInDocument(),
      () => driver.focusedElement(),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow(
        /at-driver driver is a stub: \w+\(\) is not implemented/,
      );
    }
  });
});

describe("architecture", () => {
  it("keeps driver libraries inside src/drivers/", async () => {
    const offenders: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full !== path.join(SRC, "drivers")) await walk(full);
        } else if (entry.name.endsWith(".ts")) {
          const source = await readFile(full, "utf8");
          if (/from\s+["'](@guidepup\/|playwright|@playwright\/)/.test(source)) {
            offenders.push(path.relative(SRC, full));
          }
        }
      }
    };
    await walk(SRC);
    expect(offenders).toEqual([]);
  });
});

describe("Ctrl+C", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts the run on the first signal and exits on the second", () => {
    const controller = new AbortController();
    const logger = createMemoryLogger();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const unhook = handleInterrupts(controller, logger);
    try {
      process.emit("SIGINT");
      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBeInstanceOf(InterruptedError);
      expect(logger.text()).toContain("saving state");
      expect(exit).not.toHaveBeenCalled();
      process.emit("SIGINT");
      expect(exit).toHaveBeenCalledWith(130);
    } finally {
      unhook();
    }
  });
});
