import { mkdir, open } from "node:fs/promises";
import path from "node:path";

/** Keeps Git from rewriting transcripts, which would break their recorded hashes. */
export const GITATTRIBUTES = `# Written by voicecap. Git must not change line endings in these files: the SHA-256
# hashes in run.json and reviews.json only match the files byte for byte.
* -text
`;

/**
 * Keeps out of Git the run lock, raw NVDA logs (which can hold typed passwords), the shareable page
 * and its Word copy that each site's folder keeps current (written again after every run and
 * review, so a copy in Git each time would only grow the record; the dated copies that are sent
 * stay), the temporary files a crash can leave (writeFileAtomic names them
 * .<name>.<pid>.<hex>.tmp), the lock files Word keeps beside a document it has open (named ~$
 * first, as beside a sent copy someone is reading), the website that `voicecap site` builds (_site/,
 * made again from the records by every build), and the files an operating system adds to folders.
 */
export const GITIGNORE = `# Written by voicecap. Keep these out of Git:
# the lock a run holds while it writes,
.voicecap.lock
# raw NVDA logs, which can hold typed passwords (their SHA-256 stays in session.json),
**/*_manual_*/raw/
# the shareable page and its Word copy, which every run and review writes again (the dated copies that are sent stay),
**/share/current.*
# temporary files a crash can leave behind,
.*.tmp
# Word's lock files beside a document it has open,
~$*
# the website voicecap site builds,
_site/
# and files the operating system adds.
.DS_Store
Thumbs.db
desktop.ini
`;

/**
 * Write .gitattributes and .gitignore at the home's top, if they aren't there yet. Neither file
 * is ever overwritten, so the owner's own edits or additions stay. The names written, in the order
 * they were written.
 */
export async function ensureGitFiles(home: string): Promise<string[]> {
  await mkdir(home, { recursive: true });
  return writeEachIfMissing(home, [
    [".gitattributes", GITATTRIBUTES],
    [".gitignore", GITIGNORE],
  ]);
}

/**
 * Write each of `files` into `folder` where there's no file of its name yet, in order, never over
 * one that's there (see writeIfMissing). The names written, in the order they were written.
 */
export async function writeEachIfMissing(
  folder: string,
  files: readonly (readonly [name: string, content: string])[],
): Promise<string[]> {
  const written: string[] = [];
  for (const [name, content] of files) {
    if (await writeIfMissing(path.join(folder, name), content)) written.push(name);
  }
  return written;
}

/**
 * Write `content` to `file` when there's no file there yet. A file that's there is never written
 * over. Whether it wrote: false means the file was there.
 */
export async function writeIfMissing(file: string, content: string): Promise<boolean> {
  try {
    const handle = await open(file, "wx");
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  }
}
