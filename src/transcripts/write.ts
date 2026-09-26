import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FileHash, TranscriptJson } from "../model.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { sha256 } from "../util/hash.js";
import { bodyLines, contentSha256, renderTranscriptTxt } from "./format.js";

export interface WrittenTranscript {
  /** SHA-256 and size of each file written, by file name ("read.txt", "read.json"). */
  files: Record<string, FileHash>;
  /** SHA-256 of the TXT body. */
  contentSha256: string;
}

/** Write <pass>.txt and <pass>.json into a page folder, atomically, and return their hashes. */
export async function writeTranscript(
  pageDir: string,
  transcript: TranscriptJson,
): Promise<WrittenTranscript> {
  const txtName = `${transcript.pass}.txt`;
  const jsonName = `${transcript.pass}.json`;
  const txt = renderTranscriptTxt(transcript);
  const json = `${JSON.stringify(transcript, null, 2)}\n`;
  await writeFileAtomic(path.join(pageDir, txtName), txt);
  await writeFileAtomic(path.join(pageDir, jsonName), json);
  return {
    files: { [txtName]: fileHash(txt), [jsonName]: fileHash(json) },
    contentSha256: contentSha256(bodyLines(transcript)),
  };
}

export async function readTranscriptJson(file: string): Promise<TranscriptJson> {
  return JSON.parse(await readFile(file, "utf8")) as TranscriptJson;
}

export function fileHash(content: string | Uint8Array): FileHash {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return { sha256: sha256(bytes), bytes: bytes.length };
}
