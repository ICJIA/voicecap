/**
 * The quick checks both platforms share, with no driver imports: Node.js, another voicecap using
 * the same screen reader, and the browser. Each platform module wraps these into CheckRunners
 * alongside its own platform-specific checks.
 */
import type { Check } from "./model.js";
import { errorMessage } from "../util/errors.js";

/** The oldest Node.js voicecap supports (package.json engines; @guidepup/setup needs it). */
export const MIN_NODE = [22, 19, 0];

/** Whether `version` (e.g. "22.19.0", with or without a leading "v") is MIN_NODE or later. */
export function nodeIsSupported(version: string): boolean {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < MIN_NODE.length; i++) {
    const have = parts[i] ?? 0;
    const need = MIN_NODE[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

/** OK "Node.js <v>"; FAIL "Node.js <v> is too old" when older than MIN_NODE. */
export function nodeCheck(version: string, again: string): Check {
  if (nodeIsSupported(version)) {
    return { id: "node", status: "OK", summary: `Node.js ${version}` };
  }
  return {
    id: "node",
    status: "FAIL",
    summary: `Node.js ${version} is too old`,
    problem: {
      title: "Node.js",
      whatsWrong: "voicecap needs Node.js 22.19 or later.",
      fix: ["Install the current Node.js LTS from https://nodejs.org.", `Run ${again} again.`],
      setupHelps: false,
    },
  };
}

/** OK "No other voicecap is using <screenReader>"; FAIL naming the process holding the lock. */
export function otherVoicecapCheck(
  holder: { pid: number; startedAt: string } | null,
  lockFile: string,
  screenReader: string,
  again: string,
): Check {
  if (!holder) {
    return {
      id: "otherVoicecap",
      status: "OK",
      summary: `No other voicecap is using ${screenReader}`,
    };
  }
  return {
    id: "otherVoicecap",
    status: "FAIL",
    summary: `Another voicecap is using ${screenReader}`,
    problem: {
      title: "Another voicecap",
      whatsWrong:
        `Another voicecap (process ${holder.pid}, started ${holder.startedAt}) is using ` +
        `${screenReader} on this computer, and only one can at a time.`,
      fix: [
        "Wait for it to finish, or stop it.",
        `If no other voicecap is running, delete its lock: ${lockFile}`,
        `Run ${again} again.`,
      ],
      setupHelps: false,
    },
  };
}

/** OK "Browser: <name>"; FAIL "No browser for voicecap" when resolve() throws. */
export function browserCheck(resolve: () => { name: string; path: string }): Check {
  try {
    const { name } = resolve();
    return { id: "browser", status: "OK", summary: `Browser: ${name}` };
  } catch (error) {
    return {
      id: "browser",
      status: "FAIL",
      summary: "No browser for voicecap",
      problem: {
        title: "The browser",
        whatsWrong: errorMessage(error),
        fix: ["Run npx @icjia/voicecap setup."],
        setupHelps: true,
      },
    };
  }
}
