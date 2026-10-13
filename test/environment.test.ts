import { describe, expect, it } from "vitest";

describe("the tests' environment", () => {
  it("never holds the person's transcripts home, reviewer name, or config file, so no test can reach them", () => {
    // test/setup.ts takes them out before each test file. CI sets all three for its test run, so
    // that this is checked there as well as on a computer that has them.
    expect(process.env.VOICECAP_TRANSCRIPTS).toBeUndefined();
    expect(process.env.VOICECAP_REVIEWER).toBeUndefined();
    expect(process.env.VOICECAP_CONFIG).toBeUndefined();
  });
});
