/**
 * A run whose record names the library that drives the screen reader everywhere a record does, for
 * the tests of what the shareable page and its Word copy say in its place: the driver and its
 * version (`guidepup 0.34.0`), the software the computer recorded (`software.guidepup`), and the
 * line NVDA's settings carry on where they come from. Built in memory, as share-data.ts builds
 * runs; the record keeps the library's name, as a run writes it.
 */
import type { MachineRecord, RunJson } from "../../src/model.js";
import { buildShareModel, type ShareModel } from "../../src/share/model.js";
import { shareRun } from "./share-data.js";
import { inputOf, LINES, storeOf, TRANSCRIPTS } from "./share-model.js";

/** The line the driver records with NVDA's settings, in the driver's own words. */
const SETTINGS_LINE =
  "only settings that differ from NVDA 2026.2's defaults (Guidepup's configuration plus voicecap's nvdaSettings)";

/** A computer as voicecap 0.6.0 records it, whose software has `driver` as its Guidepup. */
function machineOf(driver: string): MachineRecord {
  return {
    os: { name: "Windows 11 Pro 25H2", build: "10.0.26200.9550", arch: "x64" },
    cpu: {
      name: "Intel Core Ultra 7 265F",
      baseMhz: 2400,
      physicalCores: 20,
      logicalProcessors: 20,
    },
    memoryBytes: 34_045_000_000,
    display: { width: 3440, height: 1440, refreshHz: 59, scalePercent: 110 },
    browserWindow: { width: 1280, height: 960 },
    timeZone: "America/Chicago",
    utcOffset: "-05:00",
    language: "en-US",
    software: { node: "24.19.0", voicecap: "0.6.0", guidepup: driver, playwright: "1.63.0" },
  };
}

/**
 * A run of one page, Home, read with the driver at version 0.34.0. Resumed (`resumed`), it has a
 * second session with the driver at 0.35.0, so the tools changed during the run.
 */
export function driverNamedRun(resumed = false): RunJson {
  const session = (driver: string) => ({
    environment: {
      driver: { name: "guidepup", version: driver },
      machine: machineOf(driver),
      screenReaderSettings: { speech: { rate: 50 }, recorded: SETTINGS_LINE },
    },
  });
  return shareRun({
    id: "r1",
    sessions: resumed ? [session("0.34.0"), session("0.35.0")] : [session("0.34.0")],
    pages: [{ path: "/", files: TRANSCRIPTS, passes: LINES }],
  });
}

/** The model of that run, with every transcript it lists readable. */
export function driverNamedModel(resumed = false): ShareModel {
  return buildShareModel(inputOf([driverNamedRun(resumed)], { transcripts: storeOf() }));
}
