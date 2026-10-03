import { describe, expect, it } from "vitest";

import { canonicalJson, sealOf } from "../src/util/hash.js";

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

  it("counts a key named __proto__ as any other key, so adding one changes the seal", () => {
    // As verify reads a record: JSON.parse makes "__proto__" an ordinary key of its own.
    const plain = JSON.parse('{"a":1,"b":{"c":2}}') as object;
    const top = JSON.parse('{"a":1,"b":{"c":2},"__proto__":{"a":9}}') as object;
    const nested = JSON.parse('{"a":1,"b":{"c":2,"__proto__":3}}') as object;

    expect(sealOf(top)).not.toBe(sealOf(plain));
    expect(sealOf(nested)).not.toBe(sealOf(plain));
    expect(canonicalJson(top)).toBe('{"__proto__":{"a":9},"a":1,"b":{"c":2}}');
    expect(canonicalJson(nested)).toBe('{"a":1,"b":{"__proto__":3,"c":2}}');
  });

  it("writes a record without one exactly as before, so every seal already written still holds", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null, u: undefined } })).toBe(
      '{"a":{"c":null,"d":[1,{"e":3,"f":2}]},"b":1}',
    );
    // The seal 0.7.0 gave this record.
    expect(sealOf({ a: 2, b: 1 })).toBe(
      "d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772",
    );
  });
});
