/**
 * The computer a session ran on, for the session's environment record (see MachineRecord): what
 * Node and voicecap know, and what the system says when a probe asks it. Never the computer's maker,
 * model, or name, or the account's.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";

import { windowsMachineProbe } from "../drivers/guidepup/windows.js";
import { macMachineProbe } from "../drivers/voiceover/macos.js";
import type { MachineRecord } from "../model.js";
import { isoLocal } from "../util/time.js";
import { voicecapVersion } from "../util/version.js";

/**
 * What a platform reads from the system. Each part is asked on its own, and fails on its own: a
 * part that can't be read is left out of the record, and never stops the others or the run.
 */
export interface MachineProbe {
  os(): Promise<{ name: string; build: string | null }>;
  cpu(): Promise<{ baseMhz: number | null; physicalCores: number | null }>;
  display(): Promise<MachineRecord["display"]>;
  language(): Promise<string | null>;
}

/** What Node and voicecap know without asking the system: the rest of the record. */
export interface MachineFacts {
  cpus: { model: string }[];
  totalmem: number;
  arch: string;
  timeZone: string;
  utcOffset: string;
  browserWindow: MachineRecord["browserWindow"];
  software: MachineRecord["software"];
}

/**
 * The real facts, from node:os, Intl, and the installed packages. `browserWindow` is the size of
 * the window the session's browser opened at, or null when it opened none (a replay).
 */
export function nodeMachineFacts(
  browserWindow: MachineRecord["browserWindow"] = null,
): MachineFacts {
  return {
    cpus: os.cpus().map(({ model }) => ({ model })),
    totalmem: os.totalmem(),
    arch: os.arch(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // A local ISO time ends with its UTC offset: 2026-09-26T14:05:09-05:00.
    utcOffset: isoLocal(new Date()).slice(-6),
    browserWindow: browserWindow && { width: browserWindow.width, height: browserWindow.height },
    software: {
      node: process.versions.node,
      voicecap: voicecapVersion(),
      guidepup: installedVersion("@guidepup/guidepup"),
      playwright: installedVersion("playwright"),
    },
  };
}

/** The version in an installed package's package.json; null when the package isn't there to read. */
export function installedVersion(name: string): string | null {
  try {
    const file = createRequire(import.meta.url).resolve(`${name}/package.json`);
    const { version } = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * The computer's details: the probe's parts and the facts, put together. A part the probe can't
 * read is unknown ("unknown" for the system's name, null for the rest), and the record is always
 * made. The processor is named by the first in `facts.cpus` (some pad their names with spaces, and
 * Node may list none), which also counts the logical ones.
 */
export async function collectMachineRecord(
  probe: MachineProbe,
  facts: MachineFacts,
): Promise<MachineRecord> {
  const [system, processor, display, language] = await Promise.all([
    attempt(() => probe.os(), { name: "unknown", build: null }),
    attempt(() => probe.cpu(), { baseMhz: null, physicalCores: null }),
    attempt(() => probe.display(), null),
    attempt(() => probe.language(), null),
  ]);
  return {
    os: { name: system.name, build: system.build, arch: facts.arch },
    cpu: {
      name: facts.cpus[0]?.model.trim() || "unknown",
      baseMhz: processor.baseMhz,
      physicalCores: processor.physicalCores,
      logicalProcessors: facts.cpus.length,
    },
    memoryBytes: facts.totalmem,
    display,
    browserWindow: facts.browserWindow,
    timeZone: facts.timeZone,
    utcOffset: facts.utcOffset,
    language,
    software: facts.software,
  };
}

/** What `read` gives, or `fallback` when it fails, whether it rejects or throws. */
async function attempt<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/**
 * The probe with each part read once, however often and by however many it's asked: the computer
 * doesn't change while the process runs. A part that couldn't be read isn't kept, so the next
 * asker (a later session) reads it again.
 */
export function memoizedProbe(probe: MachineProbe): MachineProbe {
  const once = <T>(read: () => Promise<T>): (() => Promise<T>) => {
    let answer: Promise<T> | undefined;
    return () =>
      (answer ??= read().catch((error: unknown) => {
        answer = undefined;
        throw error;
      }));
  };
  return {
    os: once(() => probe.os()),
    cpu: once(() => probe.cpu()),
    display: once(() => probe.display()),
    language: once(() => probe.language()),
  };
}

const probes = new Map<NodeJS.Platform, MachineProbe>();

/**
 * The probe for a platform: Windows's, macOS's, or (where voicecap has no screen reader to drive)
 * one that answers from node:os alone. The same probe every time, reading each part once per
 * process, so a process's sessions ask the system once.
 */
export function machineProbeFor(platform: NodeJS.Platform): MachineProbe {
  let probe = probes.get(platform);
  if (!probe) {
    probe = platformProbe(platform);
    probes.set(platform, probe);
  }
  return probe;
}

function platformProbe(platform: NodeJS.Platform): MachineProbe {
  switch (platform) {
    case "win32":
      return memoizedProbe(windowsMachineProbe());
    case "darwin":
      return memoizedProbe(macMachineProbe());
    default:
      return nodeOnlyProbe();
  }
}

/**
 * The system's type and release as node:os has them ("Linux 6.8.0-45-generic", as a replay names
 * its host), and the language Intl has: no build and no display. Not os.version(), which on Linux
 * is the kernel's build string.
 */
function nodeOnlyProbe(): MachineProbe {
  return {
    os: () => Promise.resolve({ name: `${os.type()} ${os.release()}`, build: null }),
    cpu: () => Promise.resolve({ baseMhz: null, physicalCores: null }),
    display: () => Promise.resolve(null),
    language: () => Promise.resolve(Intl.DateTimeFormat().resolvedOptions().locale),
  };
}
