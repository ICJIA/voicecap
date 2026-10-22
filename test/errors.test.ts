import { describe, expect, it } from "vitest";

import { withCauses } from "../src/util/errors.js";

describe("withCauses", () => {
  it("ends a chain of causes that comes back to an error already seen", () => {
    const first = new Error("NVDA cannot be started");
    const second = new Error("Cannot connect to NVDA", { cause: first });
    first.cause = second;
    expect(withCauses(first)).toBe("NVDA cannot be started (Cannot connect to NVDA)");
  });

  it("takes a cause that isn't an Error by its text, and goes no further", () => {
    const error = new Error("NVDA cannot be started", { cause: "connect ECONNREFUSED" });
    expect(withCauses(error)).toBe("NVDA cannot be started (connect ECONNREFUSED)");
  });

  it("gives the message alone when no cause says anything new", () => {
    const error = new Error("NVDA cannot be started", {
      cause: new Error("NVDA cannot be started", { cause: new Error("\nat waitForRunning") }),
    });
    expect(withCauses(error)).toBe("NVDA cannot be started");
  });
});
