import { existsSync } from "node:fs";
import path from "node:path";

import { isLocalHost, normalizeCanonical } from "../pages/canonical.js";
import { readPageList } from "../pages/page-list.js";
import {
  resolvePageUrl,
  resolveSitemapUrl,
  sameOrigin,
  startsWithHost,
  withScheme,
} from "../pages/url.js";
import { DEFAULT_OUT_DIR, resolveHome, siteFolder } from "../run/paths.js";
import { UsageError } from "../util/errors.js";
import { fromGitBash } from "../util/git-bash.js";
import { localDate } from "../util/time.js";
import { composeArgs, formatCommand, quoteArg, type PageChoice } from "./compose.js";
import type { Prompter } from "./prompt.js";
import {
  checkSite,
  checkSitemap,
  findSitemaps,
  normalizeSiteAnswer,
  type FoundSitemap,
} from "./site.js";

/** Whether this computer can run the composed command now, or the one-line reason it can't. */
export type Readiness = { canRun: true; screenReader: string } | { canRun: false; reason: string };

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
const SITEMAP_HINT =
  "Enter a full URL, such as https://dvfr.illinois.gov/sitemap.xml, or a name or path on the site, such as sitemap.xml.";
const LIMIT_HINT = "Enter a whole number of at least 1, or press Enter for all.";
const CANONICAL_QUESTION =
  "This address is an IP address or a local address, so reports need the address people visit. What is it? (for example, https://dvfr.illinois.gov)";
const CANONICAL_HINT =
  "A report has to name the site. Enter the address people visit, such as https://dvfr.illinois.gov.";
const HOME_TIP =
  'Tip: set VOICECAP_TRANSCRIPTS to keep every run in one place. See "The audit record" in the README.';
/** The reviewer's quick default, for Enter; a person's name can be typed instead. */
const DEFAULT_REVIEWER = "icjia";
const REVIEWER_TIP = "Tip: set VOICECAP_REVIEWER to make your own name the default.";

/**
 * Ask `init`'s questions in order: the website, the address people visit (only when the website is
 * an IP address or a local address, and its home page doesn't name the host's own root), where the
 * pages are, how many (for a sitemap or a page list), the transcripts home, and the reviewer. Then
 * show the command (with what to change for cmd when it has a single-quoted value, and the folder
 * to run it from when it depends on one) and, where this computer can run it, warn that the screen
 * reader takes over and ask whether to run it now; elsewhere, say why it can't. A wrong answer is
 * explained and asked again. The prompter's InterruptedError and InputEndedError propagate, and
 * closing the prompter is left to the caller.
 */
export async function runWizard(deps: WizardDeps): Promise<WizardResult> {
  const { prompter } = deps;
  prompter.say("");
  const { site, named } = await askSite(deps);
  const canonical = await askCanonical(deps, site, named);
  const pages = await askPages(deps, site);
  const limit = pages.kind === "page" ? null : await askLimit(deps);
  const home = await askHome(deps, site);
  const reviewer = await askReviewer(deps);

  const args = composeArgs({ site: site.origin, canonical, pages, limit, home, reviewer });
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
  prompter.say(
    `${readiness.screenReader} will speak and take over the keyboard until the run ends.`,
  );
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

/** The website `askSite` settled on, and the host's own root, if its home page names that. */
interface AskedSite {
  site: URL;
  /** Null when the home page names no such root (see `SiteCheck`), or the site didn't answer. */
  named: string | null;
}

/**
 * The website, asked until one answers or is used anyway. Returns the origin it answers from, after
 * any redirect (a run keeps to --site's origin, so it must be the one the pages are on), or the
 * origin given when it doesn't answer and "Use it anyway?" gets a yes; a no asks again. Each check
 * can take up to 15 seconds, so it's announced. With the origin comes the canonical address the
 * site's home page names, when it names the host's own root (see `SiteCheck`).
 */
async function askSite(deps: WizardDeps): Promise<AskedSite> {
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
      return { site: check.site, named: check.canonical };
    }
    prompter.say(`  → ${given.origin} doesn't answer (${check.reason}).`);
    if (await prompter.confirm("Use it anyway?", false)) return { site: given, named: null };
  }
}

/**
 * The address people visit, for reports to name the site by. A home page that names the host's own
 * root (`named`) settles it: that's said, nothing is asked, and the command leaves --canonical out.
 * That's the home page's word alone: the run reads every page's tag and goes by its inner pages'
 * first, so it can choose another root. Otherwise a site at an IP address or a local address is
 * asked for the address people visit, until an answer `normalizeCanonical` accepts; a wrong answer,
 * or none, is explained and asked again. Returns the root asked for, for --canonical, or null when
 * none was: any other site is left to the run.
 */
async function askCanonical(
  deps: WizardDeps,
  site: URL,
  named: string | null,
): Promise<string | null> {
  const { prompter } = deps;
  if (named !== null) {
    prompter.say(`The site names its canonical address: ${named}. Reports will name it so.`);
    return null;
  }
  if (!isLocalHost(site.hostname)) return null;
  const answer = await prompter.ask(CANONICAL_QUESTION, { check: canonicalProblem });
  return normalizeCanonical(answer);
}

/** What's wrong with an answer to the canonical question, in one line, or null when it's fine. */
function canonicalProblem(answer: string): string | null {
  if (answer === "") return CANONICAL_HINT;
  try {
    normalizeCanonical(answer);
    return null;
  } catch (error) {
    if (error instanceof UsageError) return error.message;
    throw error;
  }
}

/** One choice on the "Where are the pages?" menu: its label, and what choosing it asks next. */
interface MenuChoice {
  label: string;
  ask: () => Promise<PageChoice>;
}

/**
 * Where the pages are. Each sitemap the site has is a choice, in the order `findSitemaps` finds
 * them, and the first is the default; when there's more than one, each says where it was found.
 * With none, "One page" is the default. The search can take up to 30 seconds, so it's announced.
 */
async function askPages(deps: WizardDeps, site: URL): Promise<PageChoice> {
  deps.prompter.say("Looking for the site's sitemap…");
  const found = await findSitemaps(site, deps.fetch, deps.signal);
  const choices: MenuChoice[] = [
    ...found.map((sitemap): MenuChoice => ({
      label: found.length === 1 ? `The site's sitemap: ${sitemap.url}` : sitemapLabel(sitemap),
      ask: () => Promise.resolve({ kind: "sitemap", url: sitemap.url }),
    })),
    { label: "A sitemap at another address", ask: () => askOtherSitemap(deps, site) },
    { label: "A page list file (.csv or .json)", ask: () => askPageList(deps) },
    { label: "One page", ask: () => askPage(deps, site) },
  ];
  const picked = await deps.prompter.choose(
    "Where are the pages?",
    choices.map((choice) => choice.label),
    found.length === 0 ? choices.length - 1 : 0,
  );
  return choices[picked]!.ask();
}

/** A found sitemap's label when the site has more than one: where it was found, then its URL. */
function sitemapLabel(sitemap: FoundSitemap): string {
  return sitemap.from === "robots.txt"
    ? `The site's sitemap, listed in robots.txt: ${sitemap.url}`
    : `The site's sitemap at /sitemap.xml: ${sitemap.url}`;
}

/**
 * A sitemap at another address: a full http(s) URL, or a name or path on the site, as `--sitemap`
 * reads one (see `sitemapAnswer`), that answers with a sitemap document, or one that doesn't after
 * a yes to "Use it anyway?"; a no asks again. The command gets its full URL either way.
 */
async function askOtherSitemap(deps: WizardDeps, site: URL): Promise<PageChoice> {
  const { prompter } = deps;
  for (;;) {
    const answer = await prompter.ask("Sitemap (a full URL, or a name like sitemap.xml)", {
      check: (value) => (sitemapAnswer(value, site) === null ? SITEMAP_HINT : null),
    });
    const url = sitemapAnswer(answer, site)!;
    const check = await checkSitemap(url, deps.fetch, deps.signal);
    if (check.ok) return { kind: "sitemap", url };
    prompter.say(`  → ${url}: ${check.reason}.`);
    if (await prompter.confirm("Use it anyway?", false)) return { kind: "sitemap", url };
  }
}

/**
 * The full URL of the sitemap an answer names, as `--sitemap` reads one: a full http(s) URL, or a
 * name or path resolved against the site (`sitemap.xml`, `/sitemaps/pages.xml`). An address typed
 * the short way, starting with its host (`dvfr.illinois.gov/sitemap.xml`, `localhost:3000/…`),
 * gets `https://`, as for the website. Null for anything else.
 */
function sitemapAnswer(value: string, site: URL): string | null {
  const address = startsWithHost(value) ? withScheme(value) : value;
  return resolveSitemapUrl(address, site)?.href ?? null;
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
 * The reviewer, recorded with each session of the run. Enter takes VOICECAP_REVIEWER when it's
 * set, else "icjia", a quick default; a person's name can be typed instead. Without
 * VOICECAP_REVIEWER, a tip says how to make one's own name the default.
 */
async function askReviewer(deps: WizardDeps): Promise<string> {
  const fromEnv = deps.env.VOICECAP_REVIEWER?.trim();
  const reviewer = await deps.prompter.ask("Reviewer, recorded with the run", {
    default: fromEnv ? fromEnv : DEFAULT_REVIEWER,
  });
  if (!fromEnv) deps.prompter.say(REVIEWER_TIP);
  return reviewer;
}

/**
 * A path answer without one pair of matching quotes around it (`"…"` or `'…'`), as Windows'
 * "Copy as path" adds them; anything else is returned unchanged.
 */
function unquote(answer: string): string {
  return /^(["']).*\1$/s.test(answer) ? answer.slice(1, -1) : answer;
}
