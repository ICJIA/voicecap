import { afterEach, describe, expect, it, vi } from "vitest";

import { createConsoleLogger } from "../src/util/log.js";

/** A stream that records what's written to it, and says whether it's a terminal. */
function stream(terminal: boolean) {
  let text = "";
  return {
    stream: { write: (chunk: string) => ((text += chunk), true), ...(terminal && { isTTY: true }) },
    text: () => text,
  };
}

/**
 * node:util's styleText checks that process.stdout can show color too, and under vitest it's a
 * pipe. FORCE_COLOR makes that check pass, so what's tested is the logger's own decision: whether
 * the stream it writes to is a terminal, and whether NO_COLOR is set.
 */
function allowNodeToColor(): void {
  vi.stubEnv("FORCE_COLOR", "1");
  vi.stubEnv("NO_COLOR", undefined);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the console logger's outcome lines", () => {
  it("shows a passing line in green and a failing line in red at a terminal, with its words", () => {
    allowNodeToColor();
    const out = stream(true);
    const logger = createConsoleLogger(out.stream, stream(true).stream);

    logger.info("✓ Ready: all good.", "pass");
    logger.info("✗ Not ready: 2 things to fix.", "fail");

    expect(out.text()).toBe(
      "\u001b[32m✓ Ready: all good.\u001b[39m\n\u001b[31m✗ Not ready: 2 things to fix.\u001b[39m\n",
    );
  });

  it("leaves a line with no outcome plain, even at a terminal", () => {
    allowNodeToColor();
    const out = stream(true);

    createConsoleLogger(out.stream, stream(true).stream).info("Checks");

    expect(out.text()).toBe("Checks\n");
  });

  it("is plain when the output isn't a terminal", () => {
    allowNodeToColor();
    const out = stream(false);
    const logger = createConsoleLogger(out.stream, stream(false).stream);

    logger.info("✓ Ready: all good.", "pass");
    logger.info("✗ Not ready: 2 things to fix.", "fail");

    expect(out.text()).toBe("✓ Ready: all good.\n✗ Not ready: 2 things to fix.\n");
  });

  it("is plain when NO_COLOR is set, even at a terminal", () => {
    allowNodeToColor();
    vi.stubEnv("NO_COLOR", "1");
    const out = stream(true);
    const logger = createConsoleLogger(out.stream, stream(true).stream);

    logger.info("✓ Ready: all good.", "pass");
    logger.info("✗ Not ready: 2 things to fix.", "fail");

    expect(out.text()).toBe("✓ Ready: all good.\n✗ Not ready: 2 things to fix.\n");
  });
});
