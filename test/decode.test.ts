import { describe, expect, it } from "vitest";

import { decodeText } from "../src/pages/decode.js";

describe("decodeText", () => {
  it("decodes UTF-8 without a byte order mark", () => {
    const result = decodeText(new TextEncoder().encode("url\nCafé “quoted”"));
    expect(result).toEqual({ text: "url\nCafé “quoted”", encoding: "utf-8", bom: false });
  });

  it("strips a UTF-8 byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("url,label")]);
    expect(decodeText(bytes)).toEqual({ text: "url,label", encoding: "utf-8", bom: true });
  });

  it("falls back to Windows-1252 for bytes that aren't valid UTF-8", () => {
    // “Grants” – FY27 café, as Excel's "CSV (Comma delimited)" writes it.
    const bytes = new Uint8Array([
      0x93, 0x47, 0x72, 0x61, 0x6e, 0x74, 0x73, 0x94, 0x20, 0x96, 0x20, 0x46, 0x59, 0x32, 0x37,
      0x20, 0x63, 0x61, 0x66, 0xe9, 0x20, 0x80,
    ]);
    const result = decodeText(bytes);
    expect(result.encoding).toBe("windows-1252");
    expect(result.text).toBe("“Grants” – FY27 café €");
  });

  it("treats plain ASCII as UTF-8", () => {
    expect(decodeText(new TextEncoder().encode("/about")).encoding).toBe("utf-8");
  });
});
