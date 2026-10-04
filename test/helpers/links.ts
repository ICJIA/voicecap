/**
 * Links to folders, for the tests that make them. On Windows a link to a folder is a junction, which
 * needs no privilege; elsewhere it's a symbolic link.
 */
import { symlink } from "node:fs/promises";

/**
 * What Windows says when another program holds a name for a moment: a scanner that has a file open
 * after it was removed, or a folder just made. It refuses to make a link at that name, with either of
 * these, and the next try works.
 */
const HELD = new Set(["EBUSY", "EPERM"]);

/** How many times a link is tried, and how long the wait after the first try is (it grows each time). */
const TRIES = 6;
const WAIT_MS = 100;

/**
 * Make a link at `link` to the folder `target`. When the name is held for a moment (see HELD), try
 * again a few times, as the code that removes a file it wrote does; any other error, and a name that
 * stays held, is given.
 */
export async function linkToFolder(target: string, link: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await symlink(target, link, "junction");
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt === TRIES || code === undefined || !HELD.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS * attempt));
    }
  }
}
