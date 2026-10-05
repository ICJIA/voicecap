/**
 * What the website reads of the transcripts home: each site folder's share/shares.json, the record
 * of what `voicecap share` sent, and the demo's (the site folders of voicecap-demo/). The site
 * publishes files from these, and a record is a file a person can edit, so it's read as untrusted:
 * an entry is kept only when its seal holds and its seq, at, by, and files are as voicecap records
 * them, and one of its files only when its name is one voicecap would give. Its site, which is no
 * part of what's published, is read as none when it isn't a root. What isn't kept is left out and
 * named, and never stops the rest, whatever a record holds. No file an entry lists is read here:
 * the build checks each one against its recorded size and SHA-256.
 */
import { stat } from "node:fs/promises";
import path from "node:path";

import { DEMO_OUT } from "../demo/words.js";
import type { SharedFile } from "../model.js";
import { isWebRoot } from "../pages/canonical.js";
import { linkPath, shareDir, sharesPath } from "../run/paths.js";
import { siteFolders } from "../run/site-dir.js";
import { longDate } from "../share/format.js";
import {
  describeShare,
  isPlainName,
  isSeq,
  readShares,
  recordedFiles,
  sealHolds,
} from "../share/shares.js";
import { isRunId } from "../share/walkthrough.js";

/** An entry of a shares.json the site can publish from: its seal holds, and its fields are readable. */
export interface SiteEntry {
  /** Its site's folder, as the home names it (for the demo, as voicecap-demo/ does). */
  folder: string;
  /** Where its files are: that folder's share/. */
  dir: string;
  seq: number;
  /** As recorded: a local ISO date and time. */
  at: string;
  by: string;
  /**
   * The root of the site the entry's copies name, as it records it (from 0.10.0): the site's
   * canonical address, or, for a share made with none known, the address voicecap read
   * ("http://127.0.0.1:4848/"), which names the site to no reader: a heading takes only a canonical
   * address (see `recordedCanonical`). Null for an entry from before 0.10.0, and for one whose
   * `site` isn't an http(s) root (see `isWebRoot`): it's published all the same.
   */
  site: string | null;
  /**
   * The files whose names voicecap would give, in the record's order: at least one, and a run on
   * one is a run id.
   */
  files: SharedFile[];
}

export interface SiteRecords {
  /** Each site folder with an entry to publish, by folder name; its entries in the record's order. */
  sites: { folder: string; entries: SiteEntry[] }[];
  /** The latest entry in voicecap-demo/'s site folders; null when there's none. */
  demo: SiteEntry | null;
  /** What's left out, one line each, for the build's output: "<path from the home>: <why>". */
  leftOut: string[];
}

/** The names voicecap gives a site's folder: its host, with anything but a-z 0-9 . - made "_". */
const SITE_FOLDER_NAME = /^[a-z0-9._-]+$/;
/**
 * What voicecap's names for a share's files are made of: letters, digits, ".", "_", and "-". ".."
 * is made of them too, so a name must also be a plain one (see isPlainName).
 */
const FILE_NAME = /^[A-Za-z0-9._-]+$/;
/**
 * What a published file's name may not start or end with: a "." first (a hidden file) or a "." last
 * (Windows drops it). A "-" first is fine: a host can be written with one, and voicecap names a
 * share's files from its folder. A site folder's name has only its characters to keep to.
 */
const DOT_AT_EDGE = /^\.|\.$/;
/**
 * What a published file's name ends with: .html (a page), .docx (its Word copy), or .json (a
 * walkthrough file), in lower case, as voicecap names its copies. Any other kind would be served
 * from the site's own address with no policy of its own, and an .svg or an .htm that holds a script
 * would run there.
 */
const PUBLISHED_KIND = /\.(?:html|docx|json)$/;
/**
 * The name of the file a folder's own address is served from. Netlify serves a site folder's
 * index.html at /<folder>/ as well as at its own address, and _headers has no rule for /<folder>/,
 * so such a page would run with no policy of its own. voicecap never names a copy so. A host that
 * takes no notice of letter case serves Index.html there too, so the name is refused in any case.
 */
const FOLDER_INDEX = "index.html";
/**
 * The folder the demo is published in on the site, demo/, which the build (./build.ts) uses too. The
 * home's own site folder of that name isn't published, since it would take the demo's place.
 */
export const DEMO_SITE = "demo";

/**
 * Every entry of the home's records that the site can publish from, and a line for each thing left
 * out. A demo's folder that isn't a folder, a site's folder that can't be published, a record that
 * can't be read, an entry that can't be trusted or read or has no file to publish, and a file with
 * a name voicecap wouldn't give, each leave out only themselves. Each line is safe to print (see
 * leaveOut).
 */
export async function readSiteRecords(home: string): Promise<SiteRecords> {
  const leftOut: string[] = [];
  const sites = await readSites(home, home, leftOut);
  const demoSites = await readDemoSites(home, leftOut);
  return { sites, demo: latestOf(demoSites.flatMap(({ entries }) => entries)), leftOut };
}

/**
 * The site folders of the home's voicecap-demo/ that have an entry to publish. Something there that
 * isn't a folder (Git for Windows checks a committed link out as a plain file) has no site folders
 * to read: it's left out and named, and the rest of the records are read all the same. A link to a
 * folder counts as that folder, and nothing there is nothing to name.
 */
async function readDemoSites(home: string, leftOut: string[]): Promise<SiteRecords["sites"]> {
  const demoDir = path.join(home, DEMO_OUT);
  const found = await whatIsAt(demoDir);
  if (found === "nothing") return [];
  if (found === "other") {
    leaveOut(leftOut, `${linkPath(home, demoDir)}: not published: it isn't a folder`);
    return [];
  }
  return readSites(home, demoDir, leftOut);
}

/**
 * What's at a path: nothing, a folder (a link to one too), or something else. A lookup that fails
 * for any other reason than there being nothing says it's something else: a folder that can't even
 * be looked at isn't one that can be read.
 */
async function whatIsAt(target: string): Promise<"nothing" | "folder" | "other"> {
  try {
    return (await stat(target)).isDirectory() ? "folder" : "other";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
    return code === "ENOENT" || code === "ENOTDIR" ? "nothing" : "other";
  }
}

/**
 * The site folders of `root` that have an entry to publish. `root` is the home, whose site folders
 * can't be named demo, or its voicecap-demo/, whose can: the demo's are published as demo/.
 */
async function readSites(
  home: string,
  root: string,
  leftOut: string[],
): Promise<SiteRecords["sites"]> {
  const sites: SiteRecords["sites"] = [];
  for (const folder of await siteFolders(root)) {
    const siteDir = path.join(root, folder);
    if (!SITE_FOLDER_NAME.test(folder)) {
      leaveOut(
        leftOut,
        `${linkPath(home, siteDir)}: not published: its name isn't one voicecap gives a site's folder`,
      );
    } else if (root === home && folder === DEMO_SITE) {
      leaveOut(
        leftOut,
        `${linkPath(home, siteDir)}: not published: a site folder named demo would take the demo's place on the site`,
      );
    } else {
      const entries = await readEntries(home, folder, siteDir, leftOut);
      if (entries.length > 0) sites.push({ folder, entries });
    }
  }
  return sites;
}

/**
 * The entries of one site folder's record that the site can publish from, in the record's order. An
 * entry is named in the lines as `voicecap verify` names it (see describeShare).
 */
async function readEntries(
  home: string,
  folder: string,
  siteDir: string,
  leftOut: string[],
): Promise<SiteEntry[]> {
  const where = linkPath(home, sharesPath(siteDir));
  let shares: Record<string, unknown>[];
  try {
    shares = (await readShares(siteDir)).shares;
  } catch {
    // A record that isn't JSON, isn't a record of shares, or can't be read vouches for nothing.
    leaveOut(leftOut, `${where}: not a readable record of what was shared`);
    return [];
  }

  const entries: SiteEntry[] = [];
  for (const entry of shares) {
    const name = describeShare(entry);
    if (!sealHolds(entry)) {
      leaveOut(leftOut, `${where}: ${name} changed since it was recorded`);
      continue;
    }
    const fields = readFields(entry);
    if ("unreadable" in fields) {
      leaveOut(
        leftOut,
        `${where}: ${name} can't be published: its ${fields.unreadable} isn't what voicecap records`,
      );
      continue;
    }
    // A name that holds a path, or isn't one voicecap gives, is never kept: it's never read, since
    // it could lead anywhere. The entry's other files are.
    const files: SharedFile[] = [];
    for (const file of fields.files) {
      if (isPublishableName(file.name)) {
        files.push(withVettedRun(file));
      } else {
        leaveOut(
          leftOut,
          `${where}: ${name} names ${JSON.stringify(file.name)}, which isn't a file voicecap would publish`,
        );
      }
    }
    if (files.length === 0) {
      leaveOut(leftOut, `${where}: ${name} names no file voicecap would publish`);
      continue;
    }
    entries.push({
      folder,
      dir: shareDir(siteDir),
      seq: fields.seq,
      at: fields.at,
      by: fields.by,
      // Not one of the fields an entry needs to be published: an entry from before 0.10.0 has none,
      // and a site that isn't a root names nothing, so the entry is read with none.
      site: isWebRoot(entry.site) ? entry.site : null,
      files,
    });
  }
  return entries;
}

/**
 * `text` written so that it's safe to print: each control character in it, and each of U+2028 and
 * U+2029 (which end a line), is written as a backslash, "u", and four lower-case hex digits. What a
 * record holds, and what a folder or a file is named, is its own, and what the build says is printed
 * to a terminal and kept in a log, so nothing in it may act there.
 */
export function printable(text: string): string {
  return text.replace(
    /[\p{Cc}\u{2028}\u{2029}]/gu,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Add a line to what's left out, written so that it's safe to print (see printable). Every line
 * goes through here, the build's own (./build.ts) as well as this module's.
 */
export function leaveOut(leftOut: string[], line: string): void {
  leftOut.push(printable(line));
}

/** An entry's seq, at, by, and files as voicecap records them, or the first of them that isn't. */
function readFields(
  entry: Record<string, unknown>,
):
  | { seq: number; at: string; by: string; files: SharedFile[] }
  | { unreadable: "seq" | "at" | "by" | "files" } {
  const { seq, at, by } = entry;
  if (!isSeq(seq)) return { unreadable: "seq" };
  if (typeof at !== "string" || !isTime(at)) return { unreadable: "at" };
  if (typeof by !== "string") return { unreadable: "by" };
  const files = recordedFiles(entry.files);
  if (files === null) return { unreadable: "files" };
  return { seq, at, by, files };
}

/**
 * Whether `at` is a time the site can use: one Date.parse reads, and one that format.ts can write a
 * date from, as it must for the site's pages. That is format.ts's own check of voicecap's local ISO
 * time (longDate and clock refuse any other), so its pattern isn't copied here.
 */
function isTime(at: string): boolean {
  if (Number.isNaN(Date.parse(at))) return false;
  try {
    longDate(at);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a file with this name is one voicecap would publish: a plain name, made of what
 * voicecap's are, with no dot at either edge (see DOT_AT_EDGE), of a kind voicecap names its
 * copies (see PUBLISHED_KIND), and not the one a folder's own address is served from (see
 * FOLDER_INDEX).
 */
function isPublishableName(name: string): boolean {
  return (
    isPlainName(name) &&
    FILE_NAME.test(name) &&
    !DOT_AT_EDGE.test(name) &&
    PUBLISHED_KIND.test(name) &&
    name.toLowerCase() !== FOLDER_INDEX
  );
}

/**
 * A file as the site keeps it: with its run only when that's a run id. The run is printed on the
 * site, so text that isn't an id is dropped, and the file stays, as one with no run.
 */
function withVettedRun(file: SharedFile): SharedFile {
  if (file.run === undefined || isRunId(file.run)) return file;
  return { name: file.name, bytes: file.bytes, sha256: file.sha256 };
}

/** The entry with the latest time, the higher seq of those with the same time; null for none. */
function latestOf(entries: readonly SiteEntry[]): SiteEntry | null {
  let latest: SiteEntry | null = null;
  for (const entry of entries) {
    if (latest === null || isLater(entry, latest)) latest = entry;
  }
  return latest;
}

/** Whether `entry` is later than `other`, by the moment its time names, then by its seq. */
function isLater(entry: SiteEntry, other: SiteEntry): boolean {
  const [time, otherTime] = [Date.parse(entry.at), Date.parse(other.at)];
  return time > otherTime || (time === otherTime && entry.seq > other.seq);
}
