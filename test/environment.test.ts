import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("the tests' environment", () => {
  it("never holds the person's transcripts home, reviewer name, or config file, so no test can reach them", () => {
    // test/setup.ts takes them out before each test file. CI sets all three for its test run, so
    // that this is checked there as well as on a computer that has them.
    expect(process.env.VOICECAP_TRANSCRIPTS).toBeUndefined();
    expect(process.env.VOICECAP_REVIEWER).toBeUndefined();
    expect(process.env.VOICECAP_CONFIG).toBeUndefined();
  });

  it("gives every test one temp folder of its own, which test/global-setup.ts removes when the run ends", () => {
    // Windows reads TEMP (then TMP) for the temp folder; macOS and Linux read TMPDIR (then TMP
    // and TEMP). The setup points all three at the one folder, so what a test makes there, and
    // what a program a test starts makes there, goes when the run does.
    expect(path.basename(tmpdir())).toMatch(/^voicecap-tests-/);
    expect(existsSync(tmpdir())).toBe(true);
    for (const name of ["TEMP", "TMP", "TMPDIR"]) {
      expect(process.env[name], name).toBe(tmpdir());
    }
  });
});
