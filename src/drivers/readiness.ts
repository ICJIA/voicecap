/**
 * The only place that maps a platform to its readiness module. Platform modules load lazily, as
 * drivers do, so choosing one never loads another platform's libraries (Guidepup stays out of
 * replay runs and of Linux).
 */
import os from "node:os";

import type { VoicecapConfig } from "../config/schema.js";
import { diskSpace, gigabytes } from "../readiness/machine.js";
import type { Check, CheckRunner, MachineInfo, PlatformReadiness } from "../readiness/model.js";
import { resolveHome } from "../run/paths.js";
import type { Logger } from "../util/log.js";
import { voicecapVersion } from "../util/version.js";

export interface ReadinessOptions {
  platform: NodeJS.Platform;
  config: VoicecapConfig;
  logger: Logger;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** The command to rerun after fixing a problem, e.g. "npx @icjia/voicecap init" or "the same command". */
  again: string;
}

export async function loadPlatformReadiness(options: ReadinessOptions): Promise<PlatformReadiness> {
  switch (options.platform) {
    case "win32":
      return (await import("./guidepup/readiness-windows.js")).windowsReadiness(options);
    case "darwin":
      return (await import("./voiceover/readiness-mac.js")).macReadiness(options);
    default:
      return otherReadiness(options);
  }
}

/** Linux, and anything else: voicecap has no screen reader to drive here. */
function otherReadiness(options: ReadinessOptions): PlatformReadiness {
  return {
    screenReader: null,
    cannotRunYet: "voicecap drives NVDA on Windows and VoiceOver on macOS.",
    readyTip: null,
    liveTestNotice: [],
    checkingNotice: [],
    liveTest: null,
    machineInfo: () => otherMachineInfo(options),
    quickChecks: () => [otherPlatformRunner()],
  };
}

async function otherMachineInfo(options: ReadinessOptions): Promise<MachineInfo> {
  const disk = await diskSpace(os.homedir());
  const cpuModel = os.cpus()[0]?.model ?? "Unknown CPU";
  const memory = `${gigabytes(os.totalmem())} memory`;
  const model = disk
    ? `${cpuModel}, ${memory}, ${gigabytes(disk.free)} free of ${gigabytes(disk.total)}`
    : `${cpuModel}, ${memory}`;
  const system = `${os.type()} ${os.release()}`;
  return {
    lines: [
      { label: "Computer", value: `${os.hostname()}, user ${os.userInfo().username}` },
      { label: "Model", value: model },
      { label: "System", value: `${system}, ${process.arch}` },
      { label: "Node.js", value: process.versions.node },
      { label: "voicecap", value: voicecapVersion() },
      { label: "Transcripts", value: resolveHome({ env: options.env, cwd: options.cwd }) },
    ],
    screenReader: null,
    system,
  };
}

function otherPlatformRunner(): CheckRunner {
  return { id: "platform", run: () => Promise.resolve(otherPlatformCheck()) };
}

/** FAIL: this computer has neither NVDA nor VoiceOver to drive. */
function otherPlatformCheck(): Check {
  return {
    id: "platform",
    status: "FAIL",
    summary: `This is ${os.type()}: voicecap drives NVDA on Windows and VoiceOver on macOS`,
    problem: {
      title: "No screen reader to drive here",
      whatsWrong: "voicecap drives NVDA on Windows and VoiceOver on macOS, and neither runs here.",
      fix: [
        "Use replay runs here: add --replay-from <run folder> to the command.",
        "Run real audits on a Windows computer or a Mac.",
      ],
      setupHelps: false,
    },
  };
}
