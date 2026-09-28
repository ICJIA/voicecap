import { describe, expect, it } from "vitest";

import { sealOf } from "../src/util/hash.js";

describe("sealOf", () => {
  it("ignores key order and the record's own seal field", () => {
    expect(sealOf({ b: 1, a: 2, seal: "x" })).toBe(sealOf({ a: 2, b: 1 }));
    expect(sealOf({ a: 2, b: 1, seal: "x" })).toBe(sealOf({ a: 2, b: 1, seal: "y" }));
  });

  it("changes when any value changes", () => {
    const base = sealOf({ a: 2, b: 1 });
    expect(sealOf({ a: 2, b: 2 })).not.toBe(base);
    expect(sealOf({ a: 3, b: 1 })).not.toBe(base);
  });
});
