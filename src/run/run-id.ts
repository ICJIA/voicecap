import { mkdir } from "node:fs/promises";
import path from "node:path";

import { UsageError } from "../util/errors.js";
import { localDate, localStamp } from "../util/time.js";
import { runDir } from "./paths.js";

const MAX_NAME = 24;

/** --run-name as a folder-safe suffix: letters, digits, ".", "_" and "-"; spaces become "-". */
export function sanitizeRunName(name: string): string {
  const safe = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, MAX_NAME)
    .replace(/[.-]+$/, "");
  if (safe === "") {
    throw new UsageError(
      `--run-name "${name}" has no usable characters (use letters, digits, "-").`,
    );
  }
  return safe;
}

/**
 * Create the run's folder and return its id: local date and time plus the run name, e.g.
 * 2026-09-26_1405 or 2026-09-26_1405_exhaustive. A taken id gets -2, -3, ... Creating the
 * folder claims the id, so two runs started in the same minute can't collide.
 */
export async function allocateRunId(
  outDir: string,
  now: Date,
  name: string | null,
): Promise<string> {
  await mkdir(path.join(outDir, localDate(now)), { recursive: true });
  const base = name ? `${localStamp(now)}_${sanitizeRunName(name)}` : localStamp(now);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    try {
      await mkdir(runDir(outDir, id));
      return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
