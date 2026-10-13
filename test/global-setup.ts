import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The variables a system reads its temp folder from: Windows, then macOS and Linux. */
const TEMP_VARIABLES = ["TEMP", "TMP", "TMPDIR"] as const;

/**
 * Runs once, before the first test file. It makes one temp folder for the whole run, in the
 * system's own: `voicecap-tests-` and some random letters. It points TEMP and TMP (which Windows
 * reads) and TMPDIR (which macOS and Linux read) at that folder, so `os.tmpdir()`, and every
 * program a test starts, use it too, and what the tests leave behind is in one place. It returns
 * the function that removes that folder when the run ends, and puts the variables back.
 */
export default function setup(): () => void {
  const before = TEMP_VARIABLES.map((name) => [name, process.env[name]] as const);
  const folder = mkdtempSync(path.join(tmpdir(), "voicecap-tests-"));
  for (const name of TEMP_VARIABLES) process.env[name] = folder;

  return () => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  };
}
