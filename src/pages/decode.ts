export interface DecodedText {
  text: string;
  encoding: "utf-8" | "windows-1252";
  /** Whether the bytes started with a UTF-8 byte order mark (removed from `text`). */
  bom: boolean;
}

/**
 * Decode a text file that should be UTF-8. Excel's plain "CSV (Comma delimited)" format is
 * Windows-1252, not UTF-8: bytes that aren't valid UTF-8 are decoded as Windows-1252 instead,
 * and the caller warns.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8", bom };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(body), encoding: "windows-1252", bom };
  }
}
