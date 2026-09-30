import { spawnSync } from "node:child_process";

import type { ReviewerRecord } from "../model.js";
import { UsageError } from "../util/errors.js";

export type Reviewer = ReviewerRecord;

export interface ReviewerOptions {
  /** --reviewer */
  option?: string | null | undefined;
  env?: NodeJS.ProcessEnv;
  /** The config's `reviewer` default. */
  configReviewer: string | null;
  cwd: string;
  /** Replaces `git config user.name` (tests). */
  gitUserName?: (cwd: string) => string | null;
}

/**
 * Who is recording this: --reviewer, then VOICECAP_REVIEWER, then `git config user.name`, then
 * the config default. Reviews and manual sessions are never recorded without a name.
 */
export function resolveReviewer(options: ReviewerOptions): Reviewer {
  const reviewer = findReviewer(options);
  if (reviewer) return reviewer;
  throw new UsageError(
    'No reviewer name. Pass --reviewer "Your Name", set VOICECAP_REVIEWER, set git config user.name, or set reviewer in voicecap.config.',
  );
}

/** The name `resolveReviewer` would take, or null when there's none (a run goes ahead without). */
export function findReviewer(options: ReviewerOptions): Reviewer | null {
  const env = options.env ?? process.env;
  const candidates: [string | null | undefined, Reviewer["source"]][] = [
    [options.option, "option"],
    [env.VOICECAP_REVIEWER, "environment"],
    [(options.gitUserName ?? gitUserName)(options.cwd), "git"],
    [options.configReviewer, "config"],
  ];
  for (const [value, source] of candidates) {
    const name = value?.trim();
    if (name) return { name, source };
  }
  return null;
}

export function gitUserName(cwd: string): string | null {
  try {
    const result = spawnSync("git", ["config", "user.name"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}
