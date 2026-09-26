import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ManualSessionJson } from "../model.js";
import { manualRoot } from "../run/paths.js";

export interface ManualSessionFile {
  json: ManualSessionJson;
  /** Paths relative to the transcripts folder, with forward slashes. */
  jsonPath: string;
  txtPath: string;
  rawPath: string | null;
}

/** Every imported manual session (manual/<slug>/<id>.json), sorted by page then session id. */
export async function listManualSessions(outDir: string): Promise<ManualSessionFile[]> {
  const root = manualRoot(outDir);
  if (!existsSync(root)) return [];
  const sessions: ManualSessionFile[] = [];
  for (const slugEntry of await readdir(root, { withFileTypes: true })) {
    if (!slugEntry.isDirectory()) continue;
    const dir = path.join(root, slugEntry.name);
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".json")) continue;
      let json: ManualSessionJson;
      try {
        json = JSON.parse(await readFile(path.join(dir, file), "utf8")) as ManualSessionJson;
      } catch {
        continue;
      }
      if (json.schemaVersion !== 1 || typeof json.id !== "string") continue;
      const rel = (name: string) => ["manual", slugEntry.name, name].join("/");
      sessions.push({
        json,
        jsonPath: rel(file),
        txtPath: rel(`${json.id}.txt`),
        rawPath: json.input.raw.kept ? rel(json.input.raw.path) : null,
      });
    }
  }
  return sessions.sort(
    (a, b) => a.json.page.key.localeCompare(b.json.page.key) || a.json.id.localeCompare(b.json.id),
  );
}
