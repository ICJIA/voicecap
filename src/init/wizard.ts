import { existsSync } from "node:fs";
import path from "node:path";

import { readPageList } from "../pages/page-list.js";
import { resolvePageUrl, sameOrigin } from "../pages/url.js";
import { DEFAULT_OUT_DIR, resolveHome, siteFolder } from "../run/paths.js";
import { UsageError } from "../util/errors.js";
import { fromGitBash } from "../util/git-bash.js";
import { localDate } from "../util/time.js";
import { composeArgs, formatCommand, quoteArg, type PageChoice } from "./compose.js";
import type { Prompter } from "./prompt.js";
import type { Readiness } from "./readiness.js";
import { checkSite, checkSitemap, findSitemap, normalizeSiteAnswer, withScheme } from "./site.js";

/** What `runWizard` works with, all injectable for tests. */
export interface WizardDeps {
  prompter: Prompter;
  /** For the site and sitemap checks. */
  fetch: typeof globalThis.fetch;
  /** The current folder: a page list's path and the transcripts home are relative to it. */
  cwd: string;
  /** Read for VOICECAP_TRANSCRIPTS. */
  env: NodeJS.ProcessEnv;
  /** Now, for the date folder the run goes into. */
  now: () => Date;
  /** Whether this computer can run the command, asked once the command is shown. */
  readiness: () => Readiness;
  /**
   * Aborted on Ctrl+C (`Prompter.interrupted`); passed to every site and sitemap check so one
   * stops at once instead of running out its own timeout.
   */
  signal?: AbortSignal;
  /**
   * For reading a Git Bash path answer and comparing transcripts homes; defaults to
   * `process.platform`.
   */
  platform?: NodeJS.Platform;
}

/** The composed run: its arguments, the command that gives them, and whether to run it now. */
export interface WizardResult {
  args: string[];
  command: string;
  run: boolean;
}

const SITE_HINT =
  "Enter the site's address, such as dvfr.illinois.gov or https://dvfr.illinois.gov.";
const SITEMAP_HINT = "Enter a full URL, such as https://dvfr.illinois.gov/sitemap.xml.";
const LIMIT_HINT = "Enter a whole number of at least 1, or press Enter for all.";
const HOME_TIP =
  'Tip: set VOICECAP_TRANSCRIPTS to keep every run in one place. See "The audit record" in the README.';

/**
 * Ask `init`'s questions in order: the website, where the pages are, how many (for a sitemap or a
 * page list), and the transcripts home. Then show the command (with what to change for cmd when it
 * has a single-quoted value, and the folder to run it from when it depends on one) and, where this
 * computer can run it, warn that NVDA takes over and ask whether to run it now; elsewhere, say why
 * it can't. A wrong answer is explained and asked again. The prompter's InterruptedError and
 * InputEndedError propagate, and closing the prompter is left to the caller.
 */
export async function runWizard(deps: WizardDeps): Promise<WizardResult> {
  const { prompter } = deps;
  prompter.say("");
  const site = await askSite(deps);
  const pages = await askPages(deps, site);
  const limit = pages.kind === "page" ? null : await askLimit(deps);
  const home = await askHome(deps, site);

  const args = composeArgs({ site: site.origin, pages, limit, home });
  const command = formatCommand(args);
  prompter.say("");
  prompter.say("Your command:");
  prompter.say(`  ${command}`);
  // cmd doesn't treat single quotes as quotes: a quoted value keeps them there, and a space or an
  // & in it splits the command.
  if (args.some((arg) => quoteArg(arg) !== arg)) {
    prompter.say("In cmd, use double quotes instead of single quotes.");
  }
  prompter.say("Run the same command again later to resume where it stopped.");
  if (dependsOnFolder(pages, home, deps.env)) prompter.say(`Run it from this folder: ${deps.cwd}`);
  prompter.say("");
  const readiness = deps.readiness();
  if (!readiness.canRun) {
    prompter.say(readiness.reason);
    return { args, command, run: false };
  }
  prompter.say("NVDA will speak and take over the keyboard until the run ends.");
  return { args, command, run: await prompter.confirm("Run it now?", false) };
}

/**
 * Whether the command reads a path against the folder it's run from: a page list given as a
 * relative path, or a relative transcripts home, whether written with --out (`home`) or in effect
 * without it (VOICECAP_TRANSCRIPTS when set, else transcripts).
 */
function dependsOnFolder(pages: PageChoice, home: string | null, env: NodeJS.ProcessEnv): boolean {
  if (pages.kind === "pages" && !path.isAbsolute(pages.file)) return true;
  const fromEnv = env.VOICECAP_TRANSCRIPTS?.trim();
  return !path.isAbsolute(home ?? (fromEnv ? fromEnv : DEFAULT_OUT_DIR));
}

/**
 * The website, asked until one answers or is used anyway. Returns the origin it answers from, after
 * any redirect (a run keeps to --site's origin, so it must be the one the pages are on), or the
 * origin given when it doesn't answer and "Use it anyway?" gets a yes; a no asks again. Each check
 * can take up to 15 seconds, so it's announced.
 */
async function askSite(deps: WizardDeps): Promise<URL> {
  const { prompter } = deps;
  for (;;) {
    const answer = await prompter.ask("Website", {
      check: (value) => (normalizeSiteAnswer(value) === null ? SITE_HINT : null),
    });
    const given = normalizeSiteAnswer(answer)!;
    prompter.say(`Checking ${given.origin}…`);
    const check = await checkSite(given, deps.fetch, deps.signal);
    if (check.ok) {
      prompter.say(
        check.moved
          ? `  → ${check.site.origin} (${given.origin} redirects there)`
          : `  → ${check.site.origin} (it answers)`,
      );
      return check.site;
    }
    prompter.say(`  → ${given.origin} doesn't answer (${check.reason}).`);
    if (await prompter.confirm("Use it anyway?", false)) return given;
  }
}

/**
 * Where the pages are. When the site's sitemap is found, it's the first choice and the default;
 * otherwise "One page" is the default. The search can take up to 30 seconds, so it's announced.
 */
async function askPages(deps: WizardDeps, site: URL): Promise<PageChoice> {
  deps.prompter.say("Looking for the site's sitemap…");
  const found = await findSitemap(site, deps.fetch, deps.signal);
  const choices: { label: string; ask: () => Promise<PageChoice> }[] = [
    { label: "A sitemap at another address", ask: () => askOtherSitemap(deps) },
    { label: "A page list file (.csv or .json)", ask: () => askPageList(deps) },
    { label: "One page", ask: () => askPage(deps, site) },
  ];
  if (found !== null) {
    choices.unshift({
      label: `The site's sitemap: ${found}`,
      ask: () => Promise.resolve({ kind: "sitemap", url: found }),
    });
  }
  const picked = await deps.prompter.choose(
    "Where are the pages?",
    choices.map((choice) => choice.label),
    found === null ? choices.length - 1 : 0,
  );
  return choices[picked]!.ask();
}

/**
 * A sitemap at another address: an http(s) URL (`https://` is added when there's no scheme, as for
 * the website) that answers with a sitemap document, or one that doesn't after a yes to "Use it
 * anyway?"; a no asks again.
 */
async function askOtherSitemap(deps: WizardDeps): Promise<PageChoice> {
  const { prompter } = deps;
  for (;;) {
    const answer = await prompter.ask("Sitemap URL", {
      check: (value) => (httpUrl(value) === null ? SITEMAP_HINT : null),
    });
    const url = httpUrl(answer)!;
    const check = await checkSitemap(url, deps.fetch, deps.signal);
    if (check.ok) return { kind: "sitemap", url };
    prompter.say(`  → ${url}: ${check.reason}.`);
    if (await prompter.confirm("Use it anyway?", false)) return { kind: "sitemap", url };
  }
}

/**
 * The full http(s) URL an answer names, as `--sitemap` reads one (`https://` added when it has no
 * scheme), or null for anything else.
 */
function httpUrl(value: string): string | null {
  try {
    const url = new URL(withScheme(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A page list file, relative to the current folder: it must exist, be a .csv or .json file, and
 * read as a page list, and the number of pages it lists is shown. Kept as typed (less any quotes
 * around it, and translated from a Git Bash path on Windows), for --pages.
 */
async function askPageList(deps: WizardDeps): Promise<PageChoice> {
  const { prompter, cwd } = deps;
  const platform = deps.platform ?? process.platform;
  for (;;) {
    const answer = await prompter.ask("Page list file (.csv or .json)", {
      check: (value) => {
        const file = fromGitBash(unquote(value), platform);
        if (!existsSync(path.resolve(cwd, file))) return `There's no file at ${file}.`;
        const ext = path.extname(file).toLowerCase();
        return ext === ".csv" || ext === ".json" ? null : "A page list is a .csv or .json file.";
      },
    });
    const file = fromGitBash(unquote(answer), platform);
    try {
      const listed = (await readPageList(path.resolve(cwd, file))).entries.length;
      prompter.say(`  → ${listed} ${listed === 1 ? "page" : "pages"} listed`);
      return { kind: "pages", file };
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      prompter.say(error.message);
    }
  }
}

/**
 * One page: a full URL, or a path resolved against the site, on the site's origin, with the site's
 * home page as the default. It's written as a full URL, so Git Bash can't rewrite it.
 */
async function askPage(deps: WizardDeps, site: URL): Promise<PageChoice> {
  const answer = await deps.prompter.ask("Page (a full URL, or a path like /faq/)", {
    default: site.href,
    check: (value) =>
      pageOnSite(value, site) === null
        ? `Enter a page on ${site.origin}: a full URL, or a path like /faq/.`
        : null,
  });
  return { kind: "page", url: pageOnSite(answer, site)!.href };
}

/** The page an answer names, resolved against the site, or null when it isn't on the site. */
function pageOnSite(answer: string, site: URL): URL | null {
  const url = resolvePageUrl(answer, site);
  return url !== null && sameOrigin(url, site) ? url : null;
}

/** How many pages, for a sitemap or a page list; null for all (Enter, or "all"). */
async function askLimit(deps: WizardDeps): Promise<number | null> {
  const answer = await deps.prompter.ask("How many pages? A number, or Enter for all", {
    default: "all",
    check: (value) => (isAll(value) || pageCount(value) !== null ? null : LIMIT_HINT),
  });
  return isAll(answer) ? null : pageCount(answer);
}

function isAll(value: string): boolean {
  return value.toLowerCase() === "all";
}

/**
 * A whole number of at least 1, as `--limit` reads one, or null. A number too large to be exact
 * would be written back in exponent form, which `--limit` rejects.
 */
function pageCount(value: string): number | null {
  const count = Number(value);
  return /^\d+$/.test(value) && count >= 1 && Number.isSafeInteger(count) ? count : null;
}

/**
 * The transcripts home: the one in effect (VOICECAP_TRANSCRIPTS when set, else transcripts) is the
 * default, and any path is accepted. The folder the run goes into follows, then, when
 * VOICECAP_TRANSCRIPTS isn't set, a tip to set it. Returns null when the answer is the home in
 * effect (compared case-insensitively on Windows), so --out is left out; otherwise the answer as
 * typed (less any quotes around it, and translated from a Git Bash path on Windows).
 */
async function askHome(deps: WizardDeps, site: URL): Promise<string | null> {
  const { prompter, cwd, env } = deps;
  const platform = deps.platform ?? process.platform;
  const fromEnv = env.VOICECAP_TRANSCRIPTS?.trim();
  const answer = fromGitBash(
    unquote(
      await prompter.ask("Transcripts home", { default: fromEnv ? fromEnv : DEFAULT_OUT_DIR }),
    ),
    platform,
  );
  const home = path.resolve(cwd, answer);
  const runFolder = path.join(home, siteFolder(site), localDate(deps.now()));
  prompter.say(`  → this run goes into ${runFolder}${path.sep}`);
  if (!fromEnv) prompter.say(HOME_TIP);
  const inEffect = resolveHome({ env, cwd });
  const sameHome =
    platform === "win32"
      ? path.win32.resolve(home).toLowerCase() === path.win32.resolve(inEffect).toLowerCase()
      : home === inEffect;
  return sameHome ? null : answer;
}

/**
 * A path answer without one pair of matching quotes around it (`"…"` or `'…'`), as Windows'
 * "Copy as path" adds them; anything else is returned unchanged.
 */
function unquote(answer: string): string {
  return /^(["']).*\1$/s.test(answer) ? answer.slice(1, -1) : answer;
}
