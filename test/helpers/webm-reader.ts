/**
 * A reader for the part of EBML that voicecap's WebM files use, for the voice tests. It reads a
 * file into its elements, and says so, by throwing, when the file isn't well formed: an element
 * that runs past the end of the one holding it, a size left unknown, an element it doesn't know
 * (so that nothing is added to a file without the tests being told), or bytes between elements.
 *
 * It is not the muxer's twin. It reads sizes and IDs as the Matroska specification describes them,
 * and the tests work out what the file should say from the sound's length, not from the muxer.
 */

type Kind = "master" | "uint" | "int" | "float" | "string" | "binary";

/** Every element a voicecap WebM may hold, by its ID with the length marker, as it is written. */
const ELEMENTS: Readonly<Record<number, readonly [name: string, kind: Kind]>> = {
  0x1a45dfa3: ["EBML", "master"],
  0x4286: ["EBMLVersion", "uint"],
  0x42f7: ["EBMLReadVersion", "uint"],
  0x42f2: ["EBMLMaxIDLength", "uint"],
  0x42f3: ["EBMLMaxSizeLength", "uint"],
  0x4282: ["DocType", "string"],
  0x4287: ["DocTypeVersion", "uint"],
  0x4285: ["DocTypeReadVersion", "uint"],
  0x18538067: ["Segment", "master"],
  0x1549a966: ["Info", "master"],
  0x2ad7b1: ["TimecodeScale", "uint"],
  0x4489: ["Duration", "float"],
  0x4d80: ["MuxingApp", "string"],
  0x5741: ["WritingApp", "string"],
  0x1654ae6b: ["Tracks", "master"],
  0xae: ["TrackEntry", "master"],
  0xd7: ["TrackNumber", "uint"],
  0x73c5: ["TrackUID", "uint"],
  0x83: ["TrackType", "uint"],
  0x9c: ["FlagLacing", "uint"],
  0x86: ["CodecID", "string"],
  0x63a2: ["CodecPrivate", "binary"],
  0x56aa: ["CodecDelay", "uint"],
  0x56bb: ["SeekPreRoll", "uint"],
  0xe1: ["Audio", "master"],
  0xb5: ["SamplingFrequency", "float"],
  0x9f: ["Channels", "uint"],
  0x1c53bb6b: ["Cues", "master"],
  0xbb: ["CuePoint", "master"],
  0xb3: ["CueTime", "uint"],
  0xb7: ["CueTrackPositions", "master"],
  0xf7: ["CueTrack", "uint"],
  0xf1: ["CueClusterPosition", "uint"],
  0x1f43b675: ["Cluster", "master"],
  0xe7: ["Timecode", "uint"],
  0xa3: ["SimpleBlock", "binary"],
  0xa0: ["BlockGroup", "master"],
  0xa1: ["Block", "binary"],
  0x75a2: ["DiscardPadding", "int"],
};

/** An element of the file, with where it is and what it holds. */
export interface Element {
  name: string;
  /** Where its ID begins in the file. */
  start: number;
  /** Where its body begins, after its ID and size. */
  dataStart: number;
  /** One past the last byte of its body. */
  end: number;
  /** The number, text, or bytes of an element that isn't a master. */
  value: number | string | Uint8Array | undefined;
  /** What a master holds, in order, covering its body exactly. */
  children: Element[];
}

/** A block, as the player reads it: its time, and its Opus packet. */
export interface Block {
  /** The time in milliseconds, its cluster's plus its own. */
  time: number;
  packet: Uint8Array;
  /** Whether it is a SimpleBlock's keyframe flag, or a Block's flags byte. */
  flags: number;
  /** Whether it sits in a BlockGroup. */
  grouped: boolean;
  /** The BlockGroup's DiscardPadding, in nanoseconds. */
  discardPadding: number | undefined;
  /** The index of its cluster. */
  cluster: number;
}

/** A file read: the elements the tests look at, and every block in order. */
export interface WebmFile {
  /** The top-level elements, which hold the whole file. */
  top: Element[];
  header: Element;
  segment: Element;
  info: Element;
  tracks: Element;
  cues: Element | undefined;
  clusters: Element[];
  blocks: Block[];
}

function readId(bytes: Uint8Array, at: number): { id: number; length: number } {
  const first = bytes[at];
  if (first === undefined) throw new Error(`The file ends where an ID begins, at ${at}.`);
  const length = Math.clz32(first) - 23;
  if (length < 1 || length > 4) throw new Error(`Not an ID at ${at}: first byte ${first}.`);
  let id = 0;
  for (let index = 0; index < length; index++) {
    const byte = bytes[at + index];
    if (byte === undefined) throw new Error(`The file ends inside an ID, at ${at}.`);
    id = id * 256 + byte;
  }
  return { id, length };
}

function readSize(bytes: Uint8Array, at: number): { size: number; length: number } {
  const first = bytes[at];
  if (first === undefined) throw new Error(`The file ends where a size begins, at ${at}.`);
  const length = Math.clz32(first) - 23;
  if (length < 1 || length > 8) throw new Error(`Not a size at ${at}: first byte ${first}.`);
  const marker = 0xff >> length;
  let size = first & marker;
  let ones = size === marker;
  for (let index = 1; index < length; index++) {
    const byte = bytes[at + index];
    if (byte === undefined) throw new Error(`The file ends inside a size, at ${at}.`);
    size = size * 256 + byte;
    ones = ones && byte === 0xff;
  }
  if (ones) throw new Error(`An element at ${at} has no size: every size should be known.`);
  return { size, length };
}

function unsigned(body: Uint8Array): number {
  if (body.length < 1 || body.length > 6) throw new Error(`An integer of ${body.length} bytes.`);
  let value = 0;
  for (const byte of body) value = value * 256 + byte;
  return value;
}

function signed(body: Uint8Array): number {
  const value = unsigned(body);
  const top = body[0] ?? 0;
  return top >= 0x80 ? value - 256 ** body.length : value;
}

function float(body: Uint8Array): number {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (body.length === 4) return view.getFloat32(0, false);
  if (body.length === 8) return view.getFloat64(0, false);
  throw new Error(`A float of ${body.length} bytes.`);
}

/** The elements in `bytes[start, end)`, which they cover exactly. */
function elementsIn(bytes: Uint8Array, start: number, end: number): Element[] {
  const found: Element[] = [];
  let at = start;
  while (at < end) {
    const { id, length: idLength } = readId(bytes, at);
    const known = ELEMENTS[id];
    if (known === undefined)
      throw new Error(`An element the muxer shouldn't write: 0x${id.toString(16)} at ${at}.`);
    const [name, kind] = known;
    const { size, length: sizeLength } = readSize(bytes, at + idLength);
    const dataStart = at + idLength + sizeLength;
    const dataEnd = dataStart + size;
    if (dataEnd > end) throw new Error(`${name} at ${at} runs past the end of what holds it.`);
    const body = bytes.subarray(dataStart, dataEnd);
    const element: Element = {
      name,
      start: at,
      dataStart,
      end: dataEnd,
      value: undefined,
      children: [],
    };
    if (kind === "master") element.children = elementsIn(bytes, dataStart, dataEnd);
    else if (kind === "uint") element.value = unsigned(body);
    else if (kind === "int") element.value = signed(body);
    else if (kind === "float") element.value = float(body);
    else if (kind === "string")
      element.value = new TextDecoder("utf-8", { fatal: true }).decode(body);
    else element.value = body;
    found.push(element);
    at = dataEnd;
  }
  return found;
}

/** The value, or an error that says what was missing. */
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`There is no ${what}.`);
  return value;
}

/** The children of `parent` with this name. */
export function childrenOf(parent: Element, name: string): Element[] {
  return parent.children.filter((child) => child.name === name);
}

/** The one child of `parent` with this name; it is an error for there to be none or two. */
export function childOf(parent: Element, name: string): Element {
  const [only, ...more] = childrenOf(parent, name);
  if (only === undefined || more.length > 0) {
    throw new Error(
      `${parent.name} should hold one ${name}, not ${childrenOf(parent, name).length}.`,
    );
  }
  return only;
}

/** The value of the one child of `parent` with this name. */
export function valueOf<T extends number | string | Uint8Array>(parent: Element, name: string): T {
  return childOf(parent, name).value as T;
}

/** A block's bytes read as the specification gives them: track, time, flags, then the packet. */
function blockFrom(body: Uint8Array): { time: number; flags: number; packet: Uint8Array } {
  if (body[0] !== 0x81) throw new Error(`A block of a track other than track 1: ${body[0]}.`);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { time: view.getInt16(1, false), flags: view.getUint8(3), packet: body.subarray(4) };
}

/** Reads a WebM file, and throws if it isn't one voicecap would write. */
export function readWebm(bytes: Uint8Array): WebmFile {
  const top = elementsIn(bytes, 0, bytes.length);
  const [header, segment, ...rest] = top;
  if (header?.name !== "EBML" || segment?.name !== "Segment" || rest.length > 0) {
    throw new Error(
      `A file should be an EBML header and a Segment, not ${top.map((e) => e.name).join(", ")}.`,
    );
  }
  const info = childOf(segment, "Info");
  const tracks = childOf(segment, "Tracks");
  const cues = childrenOf(segment, "Cues")[0];
  const clusters = childrenOf(segment, "Cluster");
  const blocks: Block[] = [];
  clusters.forEach((cluster, index) => {
    const base = valueOf<number>(cluster, "Timecode");
    for (const child of cluster.children) {
      if (child.name === "Timecode") continue;
      if (child.name === "SimpleBlock") {
        const block = blockFrom(child.value as Uint8Array);
        blocks.push({
          ...block,
          time: base + block.time,
          grouped: false,
          discardPadding: undefined,
          cluster: index,
        });
      } else if (child.name === "BlockGroup") {
        const block = blockFrom(childOf(child, "Block").value as Uint8Array);
        const padding = childrenOf(child, "DiscardPadding")[0]?.value as number | undefined;
        blocks.push({
          ...block,
          time: base + block.time,
          grouped: true,
          discardPadding: padding,
          cluster: index,
        });
      } else {
        throw new Error(`A ${child.name} in a Cluster.`);
      }
    }
  });
  return { top, header, segment, info, tracks, cues, clusters, blocks };
}
