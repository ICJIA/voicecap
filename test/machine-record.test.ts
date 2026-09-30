import { readFileSync } from "node:fs";
import os from "node:os";

import { describe, expect, it } from "vitest";

import {
  collectMachineRecord,
  installedVersion,
  machineProbeFor,
  memoizedProbe,
  nodeMachineFacts,
  type MachineFacts,
  type MachineProbe,
} from "../src/run/machine-record.js";
import { isoLocal } from "../src/util/time.js";
import { voicecapVersion } from "../src/util/version.js";

const facts: MachineFacts = {
  cpus: [{ model: "Intel(R) Core(TM) Ultra 7 265F" }, { model: "Intel(R) Core(TM) Ultra 7 265F" }],
  totalmem: 34_000_000_000,
  arch: "x64",
  timeZone: "America/Chicago",
  utcOffset: "-05:00",
  browserWindow: { width: 1280, height: 960 },
  software: { node: "24.19.0", voicecap: "0.6.0", guidepup: "0.34.0", playwright: "1.63.0" },
};
const probe: MachineProbe = {
  os: () => Promise.resolve({ name: "Windows 11 Pro 25H2", build: "10.0.26200.9550" }),
  cpu: () => Promise.resolve({ baseMhz: 2400, physicalCores: 20 }),
  display: () => Promise.resolve({ width: 3440, height: 1440, refreshHz: 59, scalePercent: 110 }),
  language: () => Promise.resolve("en-US"),
};

const fails = () => Promise.reject(new Error("no"));

describe("the computer's details", () => {
  it("puts together the computer's details", async () => {
    expect(await collectMachineRecord(probe, facts)).toEqual({
      os: { name: "Windows 11 Pro 25H2", build: "10.0.26200.9550", arch: "x64" },
      cpu: {
        name: "Intel(R) Core(TM) Ultra 7 265F",
        baseMhz: 2400,
        physicalCores: 20,
        logicalProcessors: 2,
      },
      memoryBytes: 34_000_000_000,
      display: { width: 3440, height: 1440, refreshHz: 59, scalePercent: 110 },
      browserWindow: { width: 1280, height: 960 },
      timeZone: "America/Chicago",
      utcOffset: "-05:00",
      language: "en-US",
      software: { node: "24.19.0", voicecap: "0.6.0", guidepup: "0.34.0", playwright: "1.63.0" },
    });
  });

  it("leaves out a part it can't read, and never fails for it", async () => {
    const record = await collectMachineRecord({ ...probe, display: fails }, facts);
    expect(record.display).toBeNull();
  });

  it("never records the computer's name or the account's", async () => {
    const record = await collectMachineRecord(
      machineProbeFor(process.platform),
      nodeMachineFacts(),
    );
    const text = JSON.stringify(record);
    expect(text).not.toContain(os.hostname());
    expect(text).not.toContain(os.userInfo().username);
  });

  it("says what it can't read is unknown, or leaves it out", async () => {
    const broken: MachineProbe = { os: fails, cpu: fails, display: fails, language: fails };
    expect(await collectMachineRecord(broken, facts)).toEqual({
      os: { name: "unknown", build: null, arch: "x64" },
      cpu: {
        name: "Intel(R) Core(TM) Ultra 7 265F",
        baseMhz: null,
        physicalCores: null,
        logicalProcessors: 2,
      },
      memoryBytes: 34_000_000_000,
      display: null,
      browserWindow: { width: 1280, height: 960 },
      timeZone: "America/Chicago",
      utcOffset: "-05:00",
      language: null,
      software: { node: "24.19.0", voicecap: "0.6.0", guidepup: "0.34.0", playwright: "1.63.0" },
    });
  });

  it("keeps the other parts when one can't be read", async () => {
    const whole = await collectMachineRecord(probe, facts);
    expect(await collectMachineRecord({ ...probe, os: fails }, facts)).toEqual({
      ...whole,
      os: { name: "unknown", build: null, arch: "x64" },
    });
    expect(await collectMachineRecord({ ...probe, cpu: fails }, facts)).toEqual({
      ...whole,
      cpu: { ...whole.cpu, baseMhz: null, physicalCores: null },
    });
    expect(await collectMachineRecord({ ...probe, language: fails }, facts)).toEqual({
      ...whole,
      language: null,
    });
  });

  it("takes a part that throws at once as one that can't be read", async () => {
    const throws = () => {
      throw new Error("no");
    };
    const record = await collectMachineRecord({ ...probe, language: throws }, facts);
    expect(record.language).toBeNull();
    expect(record.display).toEqual({ width: 3440, height: 1440, refreshHz: 59, scalePercent: 110 });
  });

  it("names a computer whose processors Node can't list", async () => {
    const record = await collectMachineRecord(probe, { ...facts, cpus: [] });
    expect(record.cpu).toEqual({
      name: "unknown",
      baseMhz: 2400,
      physicalCores: 20,
      logicalProcessors: 0,
    });
  });

  it("trims the processor's name, which some processors pad, and calls a blank one unknown", async () => {
    const padded = {
      ...facts,
      cpus: [{ model: "   Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz  " }],
    };
    expect((await collectMachineRecord(probe, padded)).cpu.name).toBe(
      "Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz",
    );
    const blank = { ...facts, cpus: [{ model: " " }] };
    expect((await collectMachineRecord(probe, blank)).cpu.name).toBe("unknown");
  });

  it("records no browser window for a computer that opened none", async () => {
    const record = await collectMachineRecord(probe, { ...facts, browserWindow: null });
    expect(record.browserWindow).toBeNull();
  });
});

describe("what Node and voicecap know", () => {
  it("reads the computer from node:os, Intl, and the installed packages", () => {
    const known = nodeMachineFacts({ width: 800, height: 600 });
    expect(known).toMatchObject({
      totalmem: os.totalmem(),
      arch: os.arch(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      browserWindow: { width: 800, height: 600 },
    });
    expect(known.cpus).toHaveLength(os.cpus().length);
    expect(known.software).toEqual({
      node: process.versions.node,
      voicecap: voicecapVersion(),
      guidepup: expect.stringMatching(/^\d+\.\d+\.\d+/) as unknown,
      playwright: expect.stringMatching(/^\d+\.\d+\.\d+/) as unknown,
    });
  });

  it("gives the Guidepup that voicecap pins", () => {
    const pins = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(nodeMachineFacts().software.guidepup).toBe(pins.dependencies["@guidepup/guidepup"]);
  });

  it("keeps only each processor's model", () => {
    for (const cpu of nodeMachineFacts().cpus) expect(Object.keys(cpu)).toEqual(["model"]);
  });

  it("has no browser window unless it's given one", () => {
    expect(nodeMachineFacts().browserWindow).toBeNull();
  });

  it("writes the UTC offset as a local ISO time does", () => {
    const offset = nodeMachineFacts().utcOffset;
    expect(offset).toMatch(/^[+-]\d\d:\d\d$/);
    expect(isoLocal(new Date()).endsWith(offset)).toBe(true);
  });

  it("gives a package's installed version, and null for one that isn't installed", () => {
    expect(installedVersion("@guidepup/guidepup")).toMatch(/^\d+\.\d+\.\d+/);
    expect(installedVersion("playwright")).toMatch(/^\d+\.\d+\.\d+/);
    expect(installedVersion("no-such-package-for-voicecap")).toBeNull();
  });
});

describe("the probe for a platform", () => {
  it("answers from node:os alone where there is no NVDA or VoiceOver to drive", async () => {
    const other = machineProbeFor("linux");
    expect(await other.os()).toEqual({ name: os.version(), build: null });
    expect(await other.cpu()).toEqual({ baseMhz: null, physicalCores: null });
    expect(await other.display()).toBeNull();
    expect(await other.language()).toBe(Intl.DateTimeFormat().resolvedOptions().locale);
  });

  it("is the same probe every time, so a process reads its computer once", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      expect(machineProbeFor(platform)).toBe(machineProbeFor(platform));
    }
  });

  it("reads each part once, however often it's asked, and gives every asker the answer", async () => {
    const reads: string[] = [];
    const counting: MachineProbe = {
      os: () => {
        reads.push("os");
        return probe.os();
      },
      cpu: () => {
        reads.push("cpu");
        return probe.cpu();
      },
      display: () => {
        reads.push("display");
        return probe.display();
      },
      language: () => {
        reads.push("language");
        return probe.language();
      },
    };
    const once = memoizedProbe(counting);
    const [first, second] = await Promise.all([
      collectMachineRecord(once, facts),
      collectMachineRecord(once, facts),
    ]);
    const third = await collectMachineRecord(once, facts);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(reads.sort()).toEqual(["cpu", "display", "language", "os"]);
  });
});
