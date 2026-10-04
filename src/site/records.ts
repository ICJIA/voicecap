/**
 * What the website reads of the transcripts home: each site folder's share/shares.json, the record
 * of what `voicecap share` sent, and the demo's (the site folders of voicecap-demo/). The site
 * publishes files from these, and a record is a file a person can edit, so it's read as untrusted:
 * an entry is kept only when its seal holds and its fields are as voicecap records them, and one of
 * its files only when its name is one voicecap would give. What isn't kept is left out and named,
 * and never stops the rest. No file an entry lists is read here: the build checks each one against
 * its recorded size and SHA-256.
 */
import path from "node:path";

import { DEMO_OUT } from "../demo/words.js";
import type { SharedFile } from "../model.js";
import { linkPath, shareDir, sharesPath } from "../run/paths.js";
import { siteFolders } from "../run/site-dir.js";
import { describeShare, isPlainName, isSeq, readShares, recordedFiles } from "../share/shares.js";
import { sealOf } from "../util/hash.js";

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
  /** The files whose names voicecap would give, in the record's order. */
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
/** The demo is published as demo/ on the site, so the home's own site folder of that name isn't. */
const DEMO_SITE = "demo";

/**
 * Every entry of the home's records that the site can publish from, and a line for each thing left
 * out. A site's folder that can't be published, a record that can't be read, an entry that can't be
 * trusted or read, and a file with a name voicecap wouldn't give, each leave out only themselves.
 */
export async function readSiteRecords(home: string): Promise<SiteRecords> {
  const leftOut: string[] = [];
  const sites = await readSites(home, home, leftOut);
  const demoSites = await readSites(home, path.join(home, DEMO_OUT), leftOut);
  return { sites, demo: latestOf(demoSites.flatMap(({ entries }) => entries)), leftOut };
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
      leftOut.push(
        `${linkPath(home, siteDir)}: not published: its name isn't one voicecap gives a site's folder`,
      );
    } else if (root === home && folder === DEMO_SITE) {
      leftOut.push(
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
    leftOut.push(`${where}: not a readable record of what was shared`);
    return [];
  }

  const entries: SiteEntry[] = [];
  for (const entry of shares) {
    const name = nameOf(entry);
    // An entry that lost its seal was changed, just like one that no longer matches it.
    if (entry.seal !== sealOf(entry)) {
      leftOut.push(`${where}: ${name} changed since it was recorded`);
      continue;
    }
    const fields = readFields(entry);
    if ("unreadable" in fields) {
      leftOut.push(
        `${where}: ${name} can't be published: its ${fields.unreadable} isn't what voicecap records`,
      );
      continue;
    }
    // A name that holds a path, or isn't one voicecap gives, is never kept: it's never read, since
    // it could lead anywhere. The entry's other files are.
    const files: SharedFile[] = [];
    for (const file of fields.files) {
      if (isPlainName(file.name) && FILE_NAME.test(file.name)) {
        files.push(file);
      } else {
        leftOut.push(
          `${where}: ${name} names ${JSON.stringify(file.name)}, which isn't a file voicecap would publish`,
        );
      }
    }
    entries.push({
      folder,
      dir: shareDir(siteDir),
      seq: fields.seq,
      at: fields.at,
      by: fields.by,
      files,
    });
  }
  return entries;
}

/**
 * How a line names an entry: as `voicecap verify` does (see describeShare). An entry whose time
 * can't be made into text (an object whose toString isn't a function) is "a share": a record is
 * untrusted, so naming an entry never stops the read.
 */
function nameOf(entry: Record<string, unknown>): string {
  try {
    return describeShare(entry);
  } catch {
    return "a share";
  }
}

/** An entry's seq, at, by, and files as voicecap records them, or the first of them that isn't. */
function readFields(
  entry: Record<string, unknown>,
):
  | { seq: number; at: string; by: string; files: SharedFile[] }
  | { unreadable: "seq" | "at" | "by" | "files" } {
  const { seq, at, by } = entry;
  if (!isSeq(seq)) return { unreadable: "seq" };
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return { unreadable: "at" };
  if (typeof by !== "string") return { unreadable: "by" };
  const files = recordedFiles(entry.files);
  if (files === null) return { unreadable: "files" };
  return { seq, at, by, files };
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
