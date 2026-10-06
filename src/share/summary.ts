/**
 * The summary: the result in one sentence that leads with the person's review, five numbers, four
 * panels, and three bars. Pure: every part is worked out from records already read.
 */
import type { FlagResult, RunJson, SkipReason } from "../model.js";
import { FLAG_KINDS, type AttentionCard, type ReadFailure } from "./attention.js";
import { attentionWords } from "./attention-words.js";
import type { Changes } from "./changes.js";
import { dateRange, names } from "./format.js";
import { PHRASES, type ProblemsSection } from "./problems.js";
import type { PageReview } from "./review.js";
import type { PageStanding, Standing } from "./standing.js";
import { ATTENTION_TEXT } from "./text.js";

export interface Summary {
  /** The result in one sentence, leading with the person's review as far as the records show it. */
  sentence: string;
  /** Fixed: what voicecap does, and what the person running it does, in the present tense. */
  second: string;
  numbers: {
    pagesInScope: number;
    /** Pages with transcripts in the standing. */
    transcribed: number;
    /** Pages whose transcripts have flags, and how many different rules raised them. */
    flagged: number;
    rules: number;
    linesSpoken: number;
    nvdaMs: number;
    /** The sessions `nvdaMs` leaves out: those with no recorded end, whose time no record gives. */
    sessionsWithoutEnd: number;
  };
  /**
   * "What needs attention": how many problems there are (a card for each) and how many different
   * pages they're on, over every card; and each card's id and title (its words' `title`), in the
   * cards' order, for the panel to name and link to its card. The panel names the first few and
   * counts the rest (`attentionPanelOf`, in words.ts).
   */
  attention: { problems: number; pages: number; cards: { id: string; title: string }[] };
  /** "How complete the test was". */
  complete: string[];
  /** "What's still to do". */
  todo: string[];
  /** "When and how". */
  whenHow: { label: string; value: string }[];
  bars: {
    /** Each page's latest result: transcribed with no flags, with flags, or never transcribed. */
    results: { done: number; flagged: number; never: number };
    /**
     * How many times each rule was raised: once for each page and pass it was raised in, whatever
     * the flag's own count (links, items, stops, or repeats, by rule), most often first.
     */
    flagsByRule: { rule: string; count: number }[];
    /** Each count out of its total: pages transcribed, or issues found. */
    review: { reviewed: [number, number]; fixed: [number, number] };
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
  /**
   * The cards of what needs attention (attention.ts), which the summary counts and names. The
   * sentence counts those that come from flags, and the panel every one.
   */
  attention: AttentionCard[];
  /** How a page is called in a sentence. */
  name: (page: { label?: string; url: string }) => string;
  /** The lines NVDA spoke in the transcripts shown. */
  linesSpoken: number;
  /** How long the runs the standing draws on held NVDA, in milliseconds. */
  nvdaMs: number;
  /** Their sessions with no recorded end, which `nvdaMs` can't count. */
  sessionsWithoutEnd: number;
}

/**
 * What voicecap does and what the person running it does, in the present tense: it describes the
 * method, so it claims no hearing or review the records may not show.
 */
const SECOND_LINE =
  "A human review, sped up: voicecap presses NVDA's keys and moves from page to page; the person running it does the reading and the deciding.";

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
  /**
   * Why the latest run couldn't read it, when it failed there: whether or not an earlier run's
   * transcripts are shown (`shownFrom`), an older read doesn't settle what the latest run couldn't
   * do.
   */
  failure: ReadFailure | null;
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

  /**
   * Why the latest run that tried a page couldn't read it (the latest, or a spot check after it), as
   * its last problem there says; null when that run read it.
   */
  const failureOf = (page: PageStanding): ReadFailure | null => {
    const failed = page.latestFailure;
    if (failed?.page.status !== "failed") return null;
    const last = problems.problems.findLast(
      (problem) => problem.run === failed.run.id && problem.page.key === page.key,
    );
    return {
      kind: last === undefined ? "" : PHRASES[last.kind],
      shownFrom: page.shown?.run.id ?? null,
    };
  };
  const pages = standing.pages.map((page): PageFacts => {
    const transcribed = page.shown !== null;
    return {
      page,
      name: input.name(page),
      transcribed,
      flags: transcribed ? (input.flags.get(page.key) ?? []) : [],
      review: input.review.get(page.key) ?? null,
      failure: failureOf(page),
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
  // An issue was found that is neither fixed nor open: the page was reviewed again, and no fix was
  // recorded.
  const toRecord = issuesFound.filter(
    (facts) => facts.review?.fixed !== true && !hasOpenIssue(facts),
  );
  // Pages with no transcripts whose latest record is a failure, or a skip after loading.
  const unread = pages.filter((facts) => !facts.transcribed && outcomeOf(facts) === "failed");
  const skipped = pages.filter((facts) => !facts.transcribed && outcomeOf(facts) === "skipped");
  // A page the latest run failed or skipped is a task whether or not an earlier run's transcripts
  // are shown: an older read doesn't settle what the latest run couldn't do.
  const readBefore = pages.flatMap(({ name, failure }) =>
    failure?.shownFrom ? [{ name, kind: failure.kind, shownFrom: failure.shownFrom }] : [],
  );
  const skippedInLatest = pages.filter((facts) => outcomeOf(facts) === "skipped");
  // The sentence's problems are the cards that come from flags (a read that stopped among them), and
  // the pages on them: counted from the cards, never from `undecided`, since a page whose read
  // stopped keeps its card after a review has decided about it.
  const flagCards = input.attention.filter((card) => FLAG_KINDS.has(card.kind));

  return {
    sentence: sentenceOf({
      pages,
      transcribed,
      heard,
      flagged,
      reviewed,
      withIssue,
      issuesFound,
      flagProblems: { cards: flagCards.length, pages: distinctPages(flagCards) },
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
      linesSpoken: input.linesSpoken,
      nvdaMs: input.nvdaMs,
      sessionsWithoutEnd: input.sessionsWithoutEnd,
    },
    // The panel's problems are every card, and the pages are those on any of them.
    attention: {
      problems: input.attention.length,
      pages: distinctPages(input.attention),
      cards: input.attention.map((card) => ({ id: card.id, title: attentionWords(card).title })),
    },
    complete: [
      `Pages read: ${transcribed.length} of ${pages.length}.`,
      problems.line,
      problems.unexpected === 0
        ? "Unexpected errors: none."
        : `Unexpected errors: ${problems.unexpected}, which could mean a problem in voicecap itself (see Problems during the runs).`,
      ...(unread.length > 0 ? [`Couldn't be read after every attempt: ${unread.length}.`] : []),
      ...(skipped.length > 0 ? [`Skipped, not read: ${skipped.length}.`] : []),
    ],
    todo: todoOf({
      withIssue,
      toRecord,
      unread,
      readBefore,
      skipped: skippedInLatest,
      undecided,
    }),
    whenHow: whenHowOf(latest),
    bars: {
      results: {
        done: transcribed.length - flagged.length,
        flagged: flagged.length,
        never: pages.length - transcribed.length,
      },
      flagsByRule: flagsByRule(flagged),
      review: {
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
      linesSpoken: 0,
      nvdaMs: 0,
      sessionsWithoutEnd: 0,
    },
    attention: { problems: 0, pages: 0, cards: [] },
    complete: [],
    todo: [],
    whenHow: [],
    bars: {
      results: { done: 0, flagged: 0, never: 0 },
      flagsByRule: [],
      review: { reviewed: [0, 0], fixed: [0, 0] },
    },
    changesLine: null,
  };
}

/**
 * What the latest run's record of a page says when it wasn't read there: its attempts all failed,
 * or voicecap skipped it after it loaded. The page may still have an earlier run's transcripts.
 */
function outcomeOf({ page }: PageFacts): "failed" | "skipped" | null {
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
  /** The problems that come from flags (cards), and how many different pages they're on. */
  flagProblems: { cards: number; pages: number };
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
 * The result in one sentence, as far as the records go. It leads with the person: who heard NVDA
 * speaking as it read the pages and who reviewed what it said; failing that, who ran it. What a
 * person hasn't done is never said, only what was found.
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
    flagProblems,
    unread,
    skipped,
  } = parts;
  const total = transcribed.length;

  const all = listeners(transcribed, "all");
  const some = listeners(transcribed, "part");
  let lead: string;
  // Who the lead names, for saying whether the same people reviewed. NVDA is the lead's subject when
  // no one is said to have heard it, so the people who ran it are who "run by" names.
  let sameAs: string[];
  let personIsSubject = true;
  if (heard.length > 0) {
    lead = `${them(all)} heard NVDA speaking as it read ${
      heard.length === total ? allPages(total) : `${heard.length} of the ${pagesOf(total)}`
    }`;
    sameAs = all.unnamed ? [] : all.names;
  } else if (some.names.length > 0 || some.unnamed) {
    lead = `${them(some)} heard NVDA speaking for part of the runs, as it read ${pagesOf(total)}`;
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
  const problems = flagProblems.cards;
  if (issues > 0) {
    sentences.push(
      `${issues} ${issues === 1 ? "page has" : "pages have"} an issue a screen reader user would hear, found in review.`,
    );
  }
  if (problems > 0) sentences.push(ATTENTION_TEXT.sentence(problems, flagProblems.pages));
  // Nothing open: say what was found, as far as each page's history says. "No issues were found" is
  // said only when no page ever had an issue entry, and "every issue was fixed" only when every page
  // that did has a "fixed" entry after its last issue. An issue that was reviewed again with no fix
  // recorded is neither, so nothing is said. Pages that weren't read have no flags to speak of.
  if (issues === 0 && problems === 0 && total > 0) {
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

/** The people who heard NVDA with `answer`, in the order of the pages their sessions produced. */
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

/** How many different pages some cards are on: a page on two of them is counted once. */
function distinctPages(cards: AttentionCard[]): number {
  return new Set(cards.flatMap((card) => card.pages.map((page) => page.slug))).size;
}

/** The pages each kind of task is about. */
interface Tasks {
  /** An issue is open: the latest review is an issue no one has fixed. */
  withIssue: PageFacts[];
  /** An issue was found, and it's neither fixed nor open: reviewed again, with no fix recorded. */
  toRecord: PageFacts[];
  /** No transcripts: every attempt at the page failed. */
  unread: PageFacts[];
  /**
   * The latest run couldn't read the page, and an earlier run's transcripts are shown: the page's
   * name, the kind of failure in words ("" when not recorded), and the run they come from.
   */
  readBefore: { name: string; kind: string; shownFrom: string }[];
  /** The latest run skipped the page after loading it, with or without older transcripts. */
  skipped: PageFacts[];
  /** Flags no one has decided about. */
  undecided: PageFacts[];
}

/**
 * What's still to do, as a task for each issue to fix or to record the fix of, page to read again
 * (none of its runs read it, or the latest couldn't), page that was skipped, and flagged page to
 * decide about; or that nothing is left. Nothing is left only when every issue found is fixed and
 * no page is open, unread, failed or skipped in the latest run, or undecided.
 */
function todoOf({ withIssue, toRecord, unread, readBefore, skipped, undecided }: Tasks): string[] {
  const todo: string[] = [];
  if (withIssue.length > 0) {
    const one = withIssue.length === 1;
    todo.push(
      `Fix the ${one ? "issue" : "issues"} found on ${pageList(withIssue)}, then record ${one ? "it" : "them"} as fixed.`,
    );
  }
  if (toRecord.length > 0) {
    const one = toRecord.length === 1;
    todo.push(
      `Record whether the ${one ? "issue" : "issues"} found on ${pageList(toRecord)} ${one ? "was" : "were"} fixed.`,
    );
  }
  if (unread.length > 0) {
    todo.push(
      `Run voicecap again on ${pageList(unread)}: ${unread.length === 1 ? "it" : "they"} couldn't be read after every attempt.`,
    );
  }
  todo.push(...readAgainTasks(readBefore), ...skippedTasks(skipped));
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
export const SKIP_REASONS: Record<SkipReason, string> = {
  "non-html-response": "the site didn't answer with an HTML page",
  "redirect-off-origin": "it redirected to another site",
  "non-html-extension": "its address isn't an HTML page",
  "off-origin": "it's on another site",
};

/**
 * A task for each of `items`, up to `NAMED` of them; past that, one for each of the first
 * `NAMED - 1`, and `rest` with how many more there are.
 */
function upToNamed<T>(items: T[], task: (item: T) => string, rest: (more: number) => string) {
  if (items.length <= NAMED) return items.map(task);
  return [...items.slice(0, NAMED - 1).map(task), rest(items.length - (NAMED - 1))];
}

/**
 * A task for each page the latest run couldn't read, whose transcripts are from an earlier run: what
 * stopped it, as its problems say, and the run the transcripts come from.
 */
function readAgainTasks(pages: Tasks["readBefore"]): string[] {
  return upToNamed(
    pages,
    ({ name, kind, shownFrom }) =>
      `${name} couldn't be read in the latest run${kind === "" ? "" : ` (${kind})`}. Its transcripts are from run ${shownFrom}. Read it again.`,
    (more) => `And ${more} more pages couldn't be read in the latest run. Read them again.`,
  );
}

/**
 * A task for each page the latest run skipped: whether it belongs on the list is for a person to
 * decide. Each says why, as its record does, and when the page's transcripts are from an earlier
 * run, that they are.
 */
function skippedTasks(skipped: PageFacts[]): string[] {
  const task = ({ name, page, transcribed }: PageFacts): string => {
    const reason = page.latestFailure?.page.skip?.reason;
    // A reason this version doesn't know (a newer voicecap's) is left unsaid, as is a missing one.
    const why = reason === undefined ? undefined : SKIP_REASONS[reason];
    const because = why === undefined ? "" : `: ${why}`;
    return transcribed
      ? `${name} was skipped in the latest run${because}. Its transcripts are from an earlier run. Check whether it belongs on the list.`
      : `${name} was skipped${because}. Check whether it belongs on the list.`;
  };
  return upToNamed(
    skipped,
    task,
    (more) => `And ${more} more pages were skipped. Check whether they belong on the list.`,
  );
}

/** Pages by name: "A", "A and B", "A, B, and C", and past `NAMED`, the first three and a count. */
function pageList(pages: PageFacts[]): string {
  const list = pages.map(({ name }) => name);
  if (list.length <= NAMED) return names(list);
  return names([...list.slice(0, NAMED - 1), `${list.length - (NAMED - 1)} more`]);
}

/**
 * How many times each rule was raised on the pages with flags, most often first: each flag once (a
 * rule raised on a page in a pass), since a flag's own count means something different for each
 * rule, and adding them up would add links to repeats.
 */
function flagsByRule(flagged: PageFacts[]): { rule: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { flags } of flagged) {
    for (const flag of flags) counts.set(flag.rule, (counts.get(flag.rule) ?? 0) + 1);
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
