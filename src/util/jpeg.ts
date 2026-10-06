/**
 * A JPEG is a start marker (FF D8), then segments: each a marker (FF and a code), and, but for a few
 * markers, a length (two bytes, counting themselves) and the segment's content. The picture's size is
 * in its frame header, the "start of frame" segment, whichever way the picture is coded: one of the
 * codes C0 to CF, but for three that aren't frames (C4, Huffman tables; C8, reserved; and CC,
 * arithmetic coding conditions). It comes before the picture's data (the "start of scan", DA), so
 * reading it takes only the first few hundred bytes.
 */

/** The picture's size in pixels from its frame header; null for anything that isn't a JPEG with one. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  for (;;) {
    // Any number of fill bytes (FF) may come before a marker.
    while (bytes[at] === 0xff && bytes[at + 1] === 0xff) at++;
    const code = bytes[at] === 0xff ? bytes[at + 1] : undefined;
    // The bytes ran out, or what's here can't be a segment of the header: the start of the picture's
    // data or its end, with no frame header before them, or a second start.
    if (code === undefined || code === 0x00 || code === 0xd8 || code === 0xd9 || code === 0xda) {
      return null;
    }
    // A marker with no length: restart markers, and a temporary one.
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = uint16(bytes, at + 2);
    if (length === undefined || length < 2 || at + 2 + length > bytes.length) return null;
    if (isFrame(code)) {
      // The length, 8 bits for each sample, the height, the width, and the count of components.
      if (length < 8) return null;
      const height = uint16(bytes, at + 5);
      const width = uint16(bytes, at + 7);
      return width && height ? { width, height } : null;
    }
    at += 2 + length;
  }
}

/** Whether a marker's code starts a frame: C0 to CF, but for the three that don't (C4, C8, CC). */
function isFrame(code: number): boolean {
  return code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc;
}

/** The two bytes at `at`, as a number (the high byte first); undefined where the bytes end. */
function uint16(bytes: Uint8Array, at: number): number | undefined {
  const high = bytes[at];
  const low = bytes[at + 1];
  return high === undefined || low === undefined ? undefined : (high << 8) | low;
}
