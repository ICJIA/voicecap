import { randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";

/** Windows refuses renames while antivirus or the search indexer holds the file open. */
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

export interface AtomicWriteOptions {
  /** How long to keep retrying a refused rename. Default 2 s. */
  retryForMs?: number;
  /** Replaces fs.rename (tests). */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Write a file so readers only ever see the old or the new contents, even after a power cut:
 * write a temporary file in the same folder, flush it to disk, then rename it over the target.
 */
export async function writeFileAtomic(
  file: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  const handle = await fsp.open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(tmp, file, options);
  } catch (error) {
    await fsp.rm(tmp, { force: true });
    throw error;
  }
}

async function renameWithRetry(
  from: string,
  to: string,
  options: AtomicWriteOptions,
): Promise<void> {
  const rename = options.rename ?? ((a: string, b: string) => fsp.rename(a, b));
  const deadline = Date.now() + (options.retryForMs ?? 2000);
  let delay = 25;
  for (;;) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === undefined || !RETRYABLE_CODES.has(code) || Date.now() + delay > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 250);
    }
  }
}
