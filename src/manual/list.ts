import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ManualSessionJson } from "../model.js";
import { DATE_FOLDER } from "../run/paths.js";

export interface ManualSessionFile {
  json: ManualSessionJson;
  /** Paths relative to the site folder, with forward slashes. */
  jsonPath: string;
  txtPath: string;
  rawPath: string | null;
}

/**
 * Every imported manual session (<date>/<time>_manual_<slug>/session.json), sorted by page then
 * session id. Each dated folder is checked; only its `*_manual_*` children with a readable
 * session.json count, so a run's own folder (no "_manual_" in its name) is never picked up.
 */
export async function listManualSessions(outDir: string): Promise<ManualSessionFile[]> {
  if (!existsSync(outDir)) return [];
  const sessions: ManualSessionFile[] = [];
  for (const dateEntry of await readdir(outDir, { withFileTypes: true })) {
    if (!dateEntry.isDirectory() || !DATE_FOLDER.test(dateEntry.name)) continue;
    const dateDir = path.join(outDir, dateEntry.name);
    for (const sessionEntry of await readdir(dateDir, { withFileTypes: true })) {
      if (!sessionEntry.isDirectory() || !sessionEntry.name.includes("_manual_")) continue;
      const dir = path.join(dateDir, sessionEntry.name);
      let json: ManualSessionJson;
      try {
        json = JSON.parse(
          await readFile(path.join(dir, "session.json"), "utf8"),
        ) as ManualSessionJson;
      } catch {
        continue;
      }
      if (json.schemaVersion !== 1 || typeof json.id !== "string") continue;
      const rel = (name: string) => [dateEntry.name, sessionEntry.name, name].join("/");
      sessions.push({
        json,
        jsonPath: rel("session.json"),
        txtPath: rel("session.txt"),
        rawPath: json.input.raw.kept ? rel(json.input.raw.path) : null,
      });
    }
  }
  return sessions.sort(
    (a, b) => a.json.page.key.localeCompare(b.json.page.key) || a.json.id.localeCompare(b.json.id),
  );
}
