/**
 * Shares as voicecap made them before it wrote the report for AI tools, for the tests and scripts
 * that build the website from a home of real shares. A share now has the report as Markdown and as
 * JSON beside its page and its Word copy, and the website doesn't publish them yet (it leaves out the
 * Markdown, and gives the JSON no kind of its own). Those tests and scripts are of what the website
 * makes of a share's page, its Word copy, and its walkthrough files, so their home is of shares
 * without the report. The tests of the report's own files make their own shares.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SharedFile } from "../../src/model.js";
import { shareDir, sharesPath } from "../../src/run/paths.js";
import { sealOf } from "../../src/util/hash.js";

/**
 * Make each share of the site folder `siteDir` as voicecap made one before it wrote the report for
 * AI tools: the Markdown and the JSON, which are named for the share alone and have no run, are taken
 * out of the share/ folder and out of the record, which is sealed again entry by entry along its
 * chain. Every other file of an entry is as it was written.
 */
export async function withoutReportForAi(siteDir: string): Promise<void> {
  const record = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as {
    shares: Record<string, unknown>[];
  };
  const taken: string[] = [];
  let prev: string | null = null;
  const shares = record.shares.map(({ seal: _seal, ...share }) => {
    const files = (share.files as SharedFile[]).filter(({ name, run }) => {
      const reportForAi = run === undefined && /\.(?:md|json)$/.test(name);
      if (reportForAi) taken.push(name);
      return !reportForAi;
    });
    // The spread keeps each key where the entry had it.
    const body = { ...share, prev, files };
    const entry = { ...body, seal: sealOf(body) };
    prev = entry.seal;
    return entry;
  });
  await writeFile(
    sharesPath(siteDir),
    `${JSON.stringify({ schemaVersion: 1, shares }, null, 2)}\n`,
  );
  for (const name of taken) await rm(path.join(shareDir(siteDir), name));
}
