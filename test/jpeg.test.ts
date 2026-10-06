import { describe, expect, it } from "vitest";

import { jpegSize } from "../src/util/jpeg.js";
import { TINY_JPEG } from "./helpers/jpeg.js";

/** A JPEG segment: its marker, then its payload behind a length that counts the length itself. */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

/** A frame header, the segment that holds a picture's size, with one color component. */
function frame(marker: number, width: number, height: number): number[] {
  return segment(marker, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]);
}

const START = [0xff, 0xd8];
const jpeg = (...parts: number[][]) => Uint8Array.from(parts.flat());
/** Markers, named as the JPEG specification names them: "FFC0". */
const named = (markers: number[]) =>
  markers.map((marker) => [`FF${marker.toString(16).toUpperCase()}`, marker] as const);

describe("jpegSize", () => {
  it("reads a real JPEG's size", () => {
    expect(jpegSize(TINY_JPEG)).toEqual({ width: 16, height: 12 });
  });

  it("gives null for a PNG, for no bytes at all, and for text", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect(jpegSize(png)).toBeNull();
    expect(jpegSize(new Uint8Array())).toBeNull();
    expect(jpegSize(new TextEncoder().encode("not a picture"))).toBeNull();
  });

  it("gives null for a JPEG's bytes that don't begin where a JPEG does", () => {
    expect(jpegSize(TINY_JPEG.subarray(2))).toBeNull();
    expect(jpegSize(jpeg([0x00], START, frame(0xc0, 40, 30)))).toBeNull();
  });

  it("finds the frame header after the segments before it, and reads sizes beyond one byte", () => {
    const picture = jpeg(
      START,
      segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
      segment(0xfe, [0x68, 0x69]),
      segment(0xdb, [0, 1, 2, 3]),
      frame(0xc0, 1280, 720),
      segment(0xc4, [0, 1, 2, 3]),
    );
    expect(jpegSize(picture)).toEqual({ width: 1280, height: 720 });
  });

  // Every kind of frame: baseline, extended, progressive, lossless, and the arithmetic-coded ones.
  it.each(named([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]))(
    "reads the size from a frame marked %s",
    (_name, marker) => {
      expect(jpegSize(jpeg(START, frame(marker, 300, 200)))).toEqual({ width: 300, height: 200 });
    },
  );

  // These three sit among the frame codes, and what they hold isn't a size: Huffman tables (C4), a
  // reserved code (C8), and arithmetic coding conditions (CC).
  it.each(named([0xc4, 0xc8, 0xcc]))(
    "doesn't take a segment marked %s for a frame",
    (_name, marker) => {
      expect(jpegSize(jpeg(START, frame(marker, 300, 200)))).toBeNull();
    },
  );

  it("goes by each segment's length, not by what looks like a marker inside it", () => {
    const comment = segment(0xfe, [...frame(0xc0, 999, 888)]);
    const picture = jpeg(START, comment, frame(0xc0, 40, 30));
    expect(jpegSize(picture)).toEqual({ width: 40, height: 30 });
  });

  it("allows the fill bytes a marker may have before it", () => {
    const picture = jpeg(START, [0xff], segment(0xe0, [0]), [0xff, 0xff], frame(0xc0, 640, 480));
    expect(jpegSize(picture)).toEqual({ width: 640, height: 480 });
  });

  it("gives null for a frame with no width or no height", () => {
    expect(jpegSize(jpeg(START, frame(0xc0, 0, 480)))).toBeNull();
    expect(jpegSize(jpeg(START, frame(0xc0, 640, 0)))).toBeNull();
  });

  it("gives null when the picture's data comes before any frame header, or the bytes end first", () => {
    expect(jpegSize(jpeg(START, segment(0xda, [1, 1, 0, 0, 0x3f, 0]), [0x12, 0x34]))).toBeNull();
    expect(jpegSize(jpeg(START, [0xff, 0xd9]))).toBeNull();
    expect(jpegSize(jpeg(START, segment(0xe0, [0])))).toBeNull();
    expect(jpegSize(jpeg(START))).toBeNull();
  });

  it("gives null for a segment whose length can't be right", () => {
    // Shorter than the length itself, and longer than the bytes there are.
    expect(jpegSize(jpeg(START, [0xff, 0xe0, 0x00, 0x01], frame(0xc0, 40, 30)))).toBeNull();
    expect(jpegSize(jpeg(START, [0xff, 0xe0, 0xff, 0xff, 0], frame(0xc0, 40, 30)))).toBeNull();
    // A frame header too short to hold a size.
    expect(jpegSize(jpeg(START, segment(0xc0, [8, 0, 40])))).toBeNull();
  });

  it("gives null for a JPEG cut off anywhere in its frame header, and its size once that's whole", () => {
    const whole = jpeg(START, segment(0xe0, [1, 2, 3]), frame(0xc0, 40, 30));
    for (let length = 0; length < whole.length; length++) {
      expect(jpegSize(whole.subarray(0, length)), `${length} bytes`).toBeNull();
    }
    expect(jpegSize(whole)).toEqual({ width: 40, height: 30 });
  });

  it("does the same with a real JPEG cut off at every length", () => {
    // The frame header of a real JPEG: its marker, its length (17), 8 bits, 12 high, and 16 wide.
    const header = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x0c, 0x00, 0x10]);
    const frameEnds = Buffer.from(TINY_JPEG).indexOf(header) + 2 + 0x11;
    expect(frameEnds).toBeGreaterThan(2 + 0x11);
    for (let length = 0; length <= TINY_JPEG.length; length++) {
      const size = jpegSize(TINY_JPEG.subarray(0, length));
      expect(size, `${length} bytes`).toEqual(
        length >= frameEnds ? { width: 16, height: 12 } : null,
      );
    }
  });
});
