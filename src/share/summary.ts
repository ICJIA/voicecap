/**
 * The summary: the result in one sentence that leads with the person's review, six numbers, four
 * panels, and three bars. Pure: every part is worked out from records already read.
 */
import type { FlagResult, RunJson, SkipReason } from "../model.js";
import { attentionClauses } from "./attention.js";
import type { Changes } from "./changes.js";
import { dateRange, names } from "./format.js";
import { PHRASES, type ProblemsSection } from "./problems.js";
import type { PageReview } from "./review.js";
import type { PageStanding, Standing } from "./standing.js";

export interface Summary {
  /** The result in one sentence, leading with the person's review as far as the records show it. */
  sentence: string;
  /** Fixed. */
  second: string;
  numbers: {
    pagesInScope: number;
    /** Pages with transcripts in the standing. */
    transcribed: number;
    /** Pages whose transcripts have flags, and how many different rules raised them. */
    flagged: number;
    rules: number;
    /** Pages whose session's statement answered "all": "part" is shown on a page, never counted. */
    listened: number;
    linesSpoken: number;
    nvdaMs: number;
  };
  /**
   * "What needs attention": each page with flags, a failure, or an open issue. `slug` is the page's,
   * to link its card. `clauses` is what a listener hears on it, "<what>; <what>", so `name` and
   * `clauses` make `attentionLine`'s line.
   */
  attention: { slug: string; name: string; clauses: string }[];
  /** "How complete the test was". */
  complete: string[];
  /** "What's still to do". */
  todo: string[];
  /** "When and how". */
  whenHow: { label: string; value: string }[];
  bars: {
    /** Each page's latest result: transcribed with no flags, with flags, or never transcribed. */
    results: { done: number; flagged: number; never: number };
    /** How many times each rule was raised, in every pass of every page, most often first. */
    flagsByRule: { rule: string; count: number }[];
    /** Each count out of its total: pages transcribed, or issues found. */
    review: { listened: [number, number]; reviewed: [number, number]; fixed: [number, number] };
  };
  /** From Changes, when there's a run before. */
  changesLine: string | null;
}

export interface SummaryInput {
  standing: Standing;
  /** Each page's review, by its key. */
  review: Map<string, PageReview>;
  problems: ProblemsSection;
  changes: Changes | null;
  /** Each page's flags, by its key: those of the transcripts shown. */
  flags: Map<string, FlagResult[]>;
  /** How a page is called in a sentence. */
  name: (page: { label?: string; url: string }) => string;
  /** The lines NVDA spoke in the transcripts shown. */
  linesSpoken: number;
  /** How long the runs the standing draws on held NVDA, in milliseconds. */
  nvdaMs: number;
}

const SECOND_LINE =
  "A human review, sped up: voicecap pressed NVDA's keys and moved from page to page; a person did the listening, the reading, and the deciding.";

const NO_RUN =
  "No live run counts yet: voicecap shows only completed, sealed runs with a real screen reader.";

/** What the summary knows of one page in scope. */
interface PageFacts {
  page: PageStanding;
  name: string;
  /** Its transcripts are shown. */
  transcribed: boolean;
  /** The flags of the transcripts shown; none when none are shown. */
  flags: FlagResult[];
  review: PageReview | null;
}

/**
 * A person's decision about the transcripts shown: the latest review says reviewed, issue, or
 * fixed, and the transcripts are the ones it saw. A review of other transcripts decides nothing
 * about these.
 */
function decided({ review }: PageFacts): boolean {
  if (!review?.latest) return false;
  return review.latest.status !== "unreviewed" && !review.changedSinceReview;
}

/** An issue a reviewer found that no one has recorded as fixed. */
const hasOpenIssue = ({ review }: PageFacts): boolean => review?.latest?.status === "issue";

/**
 * The summary of a site's standing. A page counts as read when its transcripts are shown, whichever
 * run they come from; one that couldn't be read in the latest run and has none from an earlier run
 * is the page that "couldn't be read after every attempt".
 */
export function summaryOf(input: SummaryInput): Summary {
  const { standing, problems, changes } = input;
  const latest = standing.latest;
  if (latest === null) return emptySummary();

  const pages = standing.pages.map((page): PageFacts => {
    const transcribed = page.shown !== null;
    return {
      page,
      name: input.name(page),
      transcribed,
      flags: transcribed ? (input.flags.get(page.key) ?? []) : [],
      review: input.review.get(page.key) ?? null,
    };
  });
  const transcribed = pages.filter((facts) => facts.transcribed);
  const flagged = transcribed.filter((facts) => facts.flags.length > 0);
  const heard = transcribed.filter((facts) => facts.review?.listened?.answer === "all");
  const reviewed = transcribed.filter(decided);
  const withIssue = pages.filter(hasOpenIssue);
  const issuesFound = pages.filter((facts) => facts.review?.issueFound === true);
  const fixed = pages.filter((facts) => facts.review?.fixed === true);
  // Flags no one has decided about, apart from the pages already counted for an issue.
  const undecided = flagged.filter((facts) => !hasOpenIssue(facts) && !decided(facts));
  const unread = pages.filter((facts) => notRead(facts) === "failed");
  const skipped = pages.filter((facts) => notRead(facts) === "skipped");

  const failureKind = ({ page }: PageFacts): string => {
    const last = problems.problems.findLast(
      (problem) => problem.run === latest.id && problem.page.key === page.key,
    );
    return last === undefined ? "" : PHRASES[last.kind];
  };
  const attention = pages.flatMap((facts) => {
    const failure = unread.includes(facts) ? failureKind(facts) : null;
    const issue = hasOpenIssue(facts) ? (facts.review?.latest?.note ?? "") : null;
    if (facts.flags.length === 0 && failure === null && issue === null) return [];
    return [
      {
        slug: facts.page.slug,
        name: facts.name,
        clauses: attentionClauses(facts.flags, failure, issue),
      },
    ];
  });

  return {
    sentence: sentenceOf({
      pages,
      transcribed,
      heard,
      flagged,
      reviewed,
      withIssue,
      issuesFound,
      undecided,
      unread,
      skipped,
      latest,
    }),
    second: SECOND_LINE,
    numbers: {
      pagesInScope: pages.length,
      transcribed: transcribed.length,
      flagged: flagged.length,
      rules: new Set(flagged.flatMap((facts) => facts.flags.map((flag) => flag.rule))).size,
      listened: heard.length,
      linesSpoken: input.linesSpoken,
      nvdaMs: input.nvdaMs,
    },
    attention,
    complete: [
      `Pages read: ${transcribed.length} of ${pages.length}.`,
      problems.line,
      problems.unexpected === 0
        ? "Unexpected errors: none."
        : `Unexpected errors: ${problems.unexpected}, which could mean a problem in voicecap itself (see Problems during the runs).`,
      ...(unread.length > 0 ? [`Couldn't be read after every attempt: ${unread.length}.`] : []),
      ...(skipped.length > 0 ? [`Skipped, not read: ${skipped.length}.`] : []),
    ],
    todo: todoOf(withIssue, unread, skipped, undecided),
    whenHow: whenHowOf(latest),
    bars: {
      results: {
        done: transcribed.length - flagged.length,
        flagged: flagged.length,
        never: pages.length - transcribed.length,
      },
      flagsByRule: flagsByRule(flagged),
      review: {
        listened: [heard.length, transcribed.length],
        reviewed: [reviewed.length, transcribed.length],
        fixed: [fixed.length, issuesFound.length],
      },
    },
    changesLine: changes?.summaryLine ?? null,
  };
}

/** What the summary says when no run counts: no page, number, panel, or bar. */
function emptySummary(): Summary {
  return {
    sentence: NO_RUN,
    second: SECOND_LINE,
    numbers: {
      pagesInScope: 0,
      transcribed: 0,
      flagged: 0,
      rules: 0,
      listened: 0,
      linesSpoken: 0,
      nvdaMs: 0,
    },
    attention: [],
    complete: [],
    todo: [],
    whenHow: [],
    bars: {
      results: { done: 0, flagged: 0, never: 0 },
      flagsByRule: [],
      review: { listened: [0, 0], reviewed: [0, 0], fixed: [0, 0] },
    },
    changesLine: null,
  };
}

/**
 * Why a page has no transcripts to show, when its record in the latest run says: its attempts all
 * failed, or voicecap skipped it after it loaded.
 */
function notRead({ transcribed, page }: PageFacts): "failed" | "skipped" | null {
  if (transcribed) return null;
  const status = page.latestFailure?.page.status;
  return status === "failed" || status === "skipped" ? status : null;
}

interface SentenceParts {
  pages: PageFacts[];
  transcribed: PageFacts[];
  /** Pages whose session's statement answered "all". */
  heard: PageFacts[];
  flagged: PageFacts[];
  /** Pages with a decision about the transcripts shown. */
  reviewed: PageFacts[];
  /** Pages whose latest review is an issue no one has fixed. */
  withIssue: PageFacts[];
  /** Pages that ever had an issue found in review. */
  issuesFound: PageFacts[];
  undecided: PageFacts[];
  /** Pages with no transcripts whose attempts all failed. */
  unread: PageFacts[];
  /** Pages with no transcripts that voicecap skipped after loading them. */
  skipped: PageFacts[];
  latest: RunJson;
}

/** The people a sentence names, and whether it also speaks of someone it has no name for. */
interface People {
  names: string[];
  unnamed: boolean;
}

/**
 * The result in one sentence, as far as the records go. It leads with the person: who listened as
 * NVDA read the pages and who reviewed what it said; failing that, who ran it. What a person hasn't
 * done is never said, only what was found.
 */
function sentenceOf(parts: SentenceParts): string {
  const {
    pages,
    transcribed,
    heard,
    flagged,
    reviewed,
    withIssue,
    issuesFound,
    undecided,
    unread,
    skipped,
  } = parts;
  const total = transcribed.length;

  const all = listeners(transcribed, "all");
  const some = listeners(transcribed, "part");
  let lead: string;
  // Who the lead names, for saying whether the same people reviewed. NVDA is the lead's subject when
  // no one is said to have listened, so the people who ran it are who "run by" names.
  let sameAs: string[];
  let personIsSubject = true;
  if (heard.length > 0) {
    lead = `${them(all)} listened as NVDA read ${
      heard.length === total ? allPages(total) : `${heard.length} of the ${pagesOf(total)}`
    }`;
    sameAs = all.unnamed ? [] : all.names;
  } else if (some.names.length > 0 || some.unnamed) {
    lead = `${them(some)} listened to part of the runs as NVDA read ${pagesOf(total)}`;
    sameAs = some.unnamed ? [] : some.names;
  } else {
    const runners = ranBy(transcribed, parts.latest);
    const read =
      total === pages.length ? allPages(pages.length) : `${total} of the ${pagesOf(pages.length)}`;
    lead = `NVDA read ${read}${runners.length > 0 ? `, run by ${names(runners)}` : ""}`;
    sameAs = runners;
    personIsSubject = false;
  }

  const reviewers = unique(
    reviewed.flatMap(({ review }) => (review?.latest ? [review.latest.reviewer] : [])),
  );
  let sentence = lead;
  if (reviewed.length > 0) {
    const reviewing =
      reviewed.length < total
        ? `reviewed ${reviewed.length} of the ${total} transcripts`
        : total === 1
          ? "reviewed the transcript"
          : "reviewed every transcript";
    if (sameAs.length > 0 && sameSet(sameAs, reviewers)) {
      sentence += personIsSubject ? `, and ${reviewing}` : `, who ${reviewing}`;
    } else {
      sentence += `, and ${names(reviewers)} ${reviewing}`;
    }
  }

  const sentences = [`${sentence}.`];
  const issues = withIssue.length;
  const flags = undecided.length;
  if (issues > 0) {
    sentences.push(
      `${issues} ${issues === 1 ? "page has" : "pages have"} an issue a screen reader user would hear, found in review.`,
    );
  }
  if (flags > 0) {
    sentences.push(
      `${flags} ${flags === 1 ? "page has" : "pages have"} flags worth a closer listen.`,
    );
  }
  // Nothing open: say what was found, as far as each page's history says. "No issues were found" is
  // said only when no page ever had an issue entry, and "every issue was fixed" only when every page
  // that did has a "fixed" entry after its last issue. An issue that was reviewed again with no fix
  // recorded is neither, so nothing is said. Pages that weren't read have no flags to speak of.
  if (issues === 0 && flags === 0 && total > 0) {
    if (issuesFound.length === 0) {
      sentences.push(
        flagged.length > 0
          ? "Every page with flags was reviewed, and no issues were found."
          : "No flags were raised, and no issues were found.",
      );
    } else if (issuesFound.every(({ review }) => review?.fixed === true)) {
      sentences.push("Every issue found in review was fixed.");
    }
  }
  if (unread.length > 0) {
    sentences.push(`${pagesOf(unread.length)} couldn't be read after every attempt.`);
  }
  if (skipped.length > 0) {
    sentences.push(
      `${skipped.length} ${skipped.length === 1 ? "page was" : "pages were"} skipped, not read.`,
    );
  }
  return sentences.join(" ");
}

/**
 * The people who ran the sessions that produced the transcripts shown, in the order of the pages
 * they produced; when none are shown, the people who ran the latest run's sessions. A session with
 * no name recorded names no one.
 */
function ranBy(transcribed: PageFacts[], latest: RunJson): string[] {
  const sessions =
    transcribed.length > 0
      ? transcribed.flatMap(({ page }) => {
          const shown = page.shown;
          return shown === null
            ? []
            : shown.run.sessions.filter((session) => session.n === shown.page.session);
        })
      : latest.sessions;
  return unique(sessions.flatMap((session) => (session.reviewer ? [session.reviewer.name] : [])));
}

/** The people who listened with `answer`, in the order of the pages their sessions produced. */
function listeners(transcribed: PageFacts[], answer: "all" | "part"): People {
  const heard = transcribed.flatMap(({ review }) =>
    review?.listened?.answer === answer ? [review.listened.name] : [],
  );
  return {
    names: unique(heard.filter((name) => name !== null)),
    unnamed: heard.includes(null),
  };
}

/** Who a sentence is about: the people it names, or the person running voicecap when it has none. */
function them({ names: list, unnamed }: People): string {
  if (list.length === 0) return "The person running voicecap";
  return names(unnamed ? [...list, "another person"] : list);
}

/** "7 pages", "1 page". */
const pagesOf = (count: number): string => (count === 1 ? "1 page" : `${count} pages`);

/** "all 7 pages", and "1 page" for one. */
const allPages = (count: number): string => (count === 1 ? "1 page" : `all ${count} pages`);

/**
 * What's still to do, as a task for each issue to fix, page to read again, page that was skipped,
 * and flagged page to decide about; or that nothing is left, when there is none of these.
 */
function todoOf(
  withIssue: PageFacts[],
  unread: PageFacts[],
  skipped: PageFacts[],
  undecided: PageFacts[],
): string[] {
  const todo: string[] = [];
  if (withIssue.length > 0) {
    const one = withIssue.length === 1;
    todo.push(
      `Fix the ${one ? "issue" : "issues"} found on ${pageList(withIssue)}, then record ${one ? "it" : "them"} as fixed.`,
    );
  }
  if (unread.length > 0) {
    todo.push(
      `Run voicecap again on ${pageList(unread)}: ${unread.length === 1 ? "it" : "they"} couldn't be read after every attempt.`,
    );
  }
  todo.push(...skippedTasks(skipped));
  if (undecided.length > 0) {
    todo.push(
      `Take a closer listen to ${pageList(undecided)}, where flags were raised, and record what you decide.`,
    );
  }
  return todo.length > 0
    ? todo
    : [
        "Nothing left: every issue found is fixed, every page was read, and every flagged page has a decision.",
      ];
}

/** The most pages a task names before it says how many more. */
const NAMED = 4;

/** Why voicecap skipped a page after loading it, in words that follow "was skipped:". */
const SKIP_REASONS: Record<SkipReason, string> = {
  "non-html-response": "the site didn't answer with an HTML page",
  "redirect-off-origin": "it redirected to another site",
  "non-html-extension": "its address isn't an HTML page",
  "off-origin": "it's on another site",
};

/**
 * A task for each page voicecap skipped: whether it belongs on the list is for a person to decide.
 * Each says why, as its record does; past `NAMED` pages, the first three and a count.
 */
function skippedTasks(skipped: PageFacts[]): string[] {
  const task = ({ name, page }: PageFacts): string => {
    const reason = page.latestFailure?.page.skip?.reason;
    // A reason this version doesn't know (a newer voicecap's) is left unsaid, as is a missing one.
    const why = reason === undefined ? undefined : SKIP_REASONS[reason];
    return `${name} was skipped${why === undefined ? "" : `: ${why}`}. Check whether it belongs on the list.`;
  };
  if (skipped.length <= NAMED) return skipped.map(task);
  const more = skipped.length - 3;
  return [
    ...skipped.slice(0, 3).map(task),
    `And ${more} more pages were skipped. Check whether they belong on the list.`,
  ];
}

/** Pages by name: "A", "A and B", "A, B, and C", and past `NAMED`, the first three and a count. */
function pageList(pages: PageFacts[]): string {
  const list = pages.map(({ name }) => name);
  if (list.length <= NAMED) return names(list);
  return names([...list.slice(0, 3), `${list.length - 3} more`]);
}

/** How many times each rule was raised on the pages with flags, most often first. */
function flagsByRule(flagged: PageFacts[]): { rule: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { flags } of flagged) {
    for (const flag of flags)
      counts.set(flag.rule, (counts.get(flag.rule) ?? 0) + (flag.count ?? 1));
  }
  return [...counts]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}

/** The date, who ran it, and what it ran on: from the latest run's sessions. */
function whenHowOf(run: RunJson): { label: string; value: string }[] {
  const first = run.sessions[0]?.startedAt ?? run.createdAt;
  const last = run.sessions.at(-1)?.endedAt ?? run.completedAt ?? first;
  const environments = run.sessions.flatMap((session) =>
    session.environment === null ? [] : [session.environment],
  );
  const version = environments[0]?.voicecap.version;
  const used = version === undefined ? "an earlier version of voicecap" : `voicecap ${version}`;
  const recorded = (values: string[]): string =>
    values.length > 0 ? names(unique(values)) : `Not recorded: this run used ${used}.`;

  // A session with no reviewer field is from before voicecap recorded who ran it; one with null
  // had no name to record.
  const runners = run.sessions.flatMap((session) =>
    session.reviewer ? [session.reviewer.name] : [],
  );
  const runBy =
    runners.length > 0
      ? names(unique(runners))
      : run.sessions.some((session) => session.reviewer === null)
        ? "Not recorded: no name was available when the run started."
        : `Not recorded: this run used ${used}.`;

  return [
    { label: "Date", value: dateRange(first, last) },
    { label: "Run by", value: runBy },
    {
      label: "Screen reader",
      value: recorded(
        environments.flatMap(({ screenReader }) =>
          screenReader === null ? [] : [`${screenReader.name} ${screenReader.version}`],
        ),
      ),
    },
    {
      label: "Browser",
      value: recorded(
        environments.flatMap(({ browser }) =>
          browser === null ? [] : [`${browser.name} ${browser.version}`],
        ),
      ),
    },
    {
      label: "Operating system",
      value: recorded(
        environments.map((environment) => environment.machine?.os.name ?? environment.os),
      ),
    },
  ];
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}
