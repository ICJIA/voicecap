/**
 * What each card of "What needs attention" says (the cards are made in ./attention.ts), as words:
 * `attentionWords`. A card's words are advice for its kind of problem, which no record changes,
 * written around what NVDA said and the pages it said it on, so they are a table with a row for each
 * kind of card (`ADVICE`), and the few choices a card makes: one page or many, the link or button a
 * graphic is inside, and the page part that many pages share. The section's own words (its heading,
 * labels, and short sentences) are in ./text.ts (`ATTENTION_TEXT`). Both renderers draw from both,
 * the page and its Word copy, so the two can't say different things. Pure.
 */
import { plural } from "../report/html.js";
import type { AttentionCard, AttentionKind, AttentionPlace } from "./attention.js";
import { count } from "./format.js";
import { HOW_TEXT } from "./text.js";

/**
 * Everything one card says, in the order it says it. Plain text, never markup: the page and the
 * Word copy escape what they draw, and set a fix's `code` in the fixed-width font, so a title can say
 * <h1>, and a fix <img src="…">.
 */
export interface AttentionWords {
  title: string;
  /** How many pages, and how many times: "32 pages, 65 times". */
  count: string;
  /** Where on the pages NVDA said it, with its words quoted, for each place; none for a card with no place. */
  places: { lead: string; quotes: { pass: string; line: string }[]; unavailable: string | null }[];
  cause: string;
  why: string;
  /** What to change, and what NVDA should say once it's changed: none for a kind with no fix in the code. */
  fixes: { lead: string; code: string; after: string | null }[];
  /** The steps to take, in order. */
  path: string[];
}

/**
 * What a place of a recorded card says in place of NVDA's words: the transcripts of its page, or of
 * its pages, couldn't be read.
 */
const UNAVAILABLE = {
  one: "NVDA's words aren't available here: this page's transcripts couldn't be read.",
  many: "NVDA's words aren't available here: these pages' transcripts couldn't be read.",
};

/** How a place's lead begins, by the page part NVDA named there. */
const PART_LEADS = new Map([
  ["header", "In the header"],
  ["main content", "In the main content"],
  ["navigation", "In the navigation"],
  ["footer", "In the footer"],
  ["sidebar", "In a sidebar"],
  ["search", "In the search"],
]);

/** The page parts a site's pages share, so that one change to one fixes every page it's on. */
const SHARED_PARTS = new Set(["header", "footer", "navigation"]);

/** One fix: what to do, the code to do it with, and what NVDA should say after it (null for no words). */
type Fix = AttentionWords["fixes"][number];

/** What a card says of its kind, besides where NVDA said it. */
interface Advice {
  title: string;
  cause: string;
  why: string;
  /** None for a kind with no fix in the code. */
  fixes?: Fix[];
  path: string[];
}

/** What NVDA named, as the card has it: nothing, for a card that names nothing. */
function named(card: AttentionCard): string {
  return card.subject ?? "";
}

/** Where on the page, as a place's lead begins ("In the header"); null when NVDA named no part. */
function whereOn(part: string | null): string | null {
  return part === null ? null : (PART_LEADS.get(part) ?? `In the ${part}`);
}

/** " (--page /about/)": the first page's address, to run voicecap on; nothing for a card with no page. */
function onePage(card: AttentionCard): string {
  const path = card.pages[0]?.path;
  return path === undefined ? "" : ` (--page ${path})`;
}

/**
 * The place on a page part that every page of a site shares (header, footer, or navigation) and
 * that is on the most pages, over more than one: its part, and how many pages. The first of them
 * when two are on as many. Null when there's none.
 */
function sharedPart(card: AttentionCard): { part: string; pages: number } | null {
  let most: { part: string; pages: number } | null = null;
  for (const { part, pages } of card.places) {
    if (part === null || !SHARED_PARTS.has(part) || pages.length < 2) continue;
    if (most === null || pages.length > most.pages) most = { part, pages: pages.length };
  }
  return most;
}

/**
 * The path forward for a flag that is a problem to fix on the site: where to fix it, run voicecap
 * again, share again, and the way out when it isn't a problem.
 */
function flagPath(card: AttentionCard): string[] {
  const many = card.pages.length > 1;
  const shared = sharedPart(card);
  const where =
    shared !== null
      ? `Fix it in the ${shared.part}, which every page shares: one change fixes it on all ${count(shared.pages)} pages.`
      : many
        ? "Fix it on each page."
        : "Fix it on the page.";
  return [
    where,
    `Run voicecap again on one page${onePage(card)}, then on every page.`,
    "Share again: once no page raises it, this card is gone.",
    `Not a problem? Mark ${many ? "the pages" : "the page"} "Reviewed, no issues" in voicecap review.`,
  ];
}

/**
 * Words as a title has them when NVDA said a phrase of them all in capitals: "INSTITUTE 2 INNOVATE"
 * is "Institute 2 Innovate". Words with a lowercase letter, or with no letters at all, are as NVDA
 * said them, and so is a single word: "ICJIA" may be a name, which a title would keep in capitals.
 * A number beside it is no second word.
 */
function titleLike(words: string): string {
  if (words === words.toLowerCase() || words !== words.toUpperCase()) return words;
  const lettered = words.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  if (lettered.length < 2) return words;
  return words
    .toLowerCase()
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_found, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
    );
}

/** A value as the text of an attribute written in double quotes, so that it can't end the attribute. */
function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/**
 * A graphic's fix at one place on its pages. Inside a link or button with words of its own, a Tab
 * stop says those words with the graphic, so the graphic is best marked decorative. Standing on its
 * own, it needs a name in words: the words of the link or button it's inside elsewhere, when it's
 * inside one there (the first place that has one), said with that role; else a place to write them.
 */
function graphicFix(card: AttentionCard, place: AttentionPlace): Fix {
  const here = whereOn(place.part) ?? "Here";
  if (place.inside !== null) {
    const { words, role } = place.inside;
    return {
      lead: `${here}, it's inside the ${role} that also says "${words}", so mark it decorative:`,
      code: '<img src="…" alt="">',
      after: `"${words}, ${role}"`,
    };
  }
  const [other] = card.places.flatMap(({ inside }) => (inside === null ? [] : [inside]));
  const name = other === undefined ? "What it is, in words" : titleLike(other.words);
  const elsewhere =
    other === undefined ? "" : `, such as the words its ${other.role} says elsewhere`;
  return {
    lead: `${here}, it stands on its own, so give it a name in words, not "logo" or a file name${elsewhere}:`,
    code: `<img src="…" alt="${attribute(name)}">`,
    after: `"graphic, ${name}"`,
  };
}

/**
 * What a first-heading card says for a page with no headings at all (level 0), which the level in
 * its title can't say: the page's titles are likely styled text, so the fix is to mark them as
 * headings.
 */
function noHeadings(card: AttentionCard): Advice {
  return {
    title: "NVDA found no headings: likely titles made of styled text, not heading tags",
    cause: `Likely titles made of styled text, not heading tags: NVDA found no headings on ${card.pages.length > 1 ? "these pages" : "the page"}.`,
    why: "Screen reader users jump from heading to heading to find their way around a page; with none, they have to go through all of it.",
    fixes: [
      {
        lead: "Mark the page's title and its section titles as headings:",
        code: "<h1>Grant opportunities</h1>\n<h2>How to apply</h2>",
        after: '"heading, level 1, Grant opportunities"',
      },
    ],
    path: flagPath(card),
  };
}

/**
 * What each kind of card says besides where NVDA said it: its title, likely cause, and why it
 * matters, its fixes in the code, and its path forward. Each is made from the card, since a title
 * names what NVDA said, and a card on many pages says its words in the plural.
 */
const ADVICE: Record<AttentionKind, (card: AttentionCard) => Advice> = {
  "graphic-generic": (card) => ({
    title: `The graphic "${named(card)}" is read as "Unlabeled graphic": its alt text is too generic for Chrome`,
    cause: `Its alt text is there, and NVDA reads it: "${named(card)}". But Chrome counts it as missing. Chrome splits an image's alt text at spaces, punctuation, and digits, then drops words of one or two letters and common words such as "logo" and "image"; with fewer than three letters left, it calls the image "Unlabeled graphic" and offers to describe it. NVDA says what Chrome reports.`,
    why: `A screen reader user on Chrome hears "Unlabeled graphic" and an offer to describe the image, every time it's read.`,
    fixes: card.places.map((place) => graphicFix(card, place)),
    path: flagPath(card),
  }),
  "graphic-unnamed": (card) => ({
    title: `A graphic is read only as "${named(card)}": likely missing alt text`,
    cause:
      "Likely missing alt text: the image has no text alternative, so NVDA can only say that it's a graphic.",
    why: "A screen reader user hears that there's an image, but not what it shows.",
    fixes: [
      {
        lead: "Say what it shows:",
        code: '<img src="…" alt="What it shows, in words">',
        after: '"graphic, what it shows"',
      },
      {
        lead: "Or, when it's decorative, or inside a link or button that already says what it is, mark it decorative:",
        code: '<img src="…" alt="">',
        after: "Nothing, for the image itself",
      },
    ],
    path: flagPath(card),
  }),
  "button-unnamed": (card) => ({
    title: 'A button is read only as "button": likely an icon button with no name',
    cause: "Likely an icon button with no name: there are no words in it for NVDA to read.",
    why: "A screen reader user hears that there's a button, but not what it does.",
    fixes: [
      {
        lead: "Give it words, visible or in aria-label:",
        code: '<button type="button" aria-label="Close menu">…</button>',
        after: '"Close menu, button"',
      },
    ],
    path: flagPath(card),
  }),
  "field-unlabeled": (card) => ({
    title: `A form field is read only as "${named(card)}": likely a missing label`,
    cause: "Likely a missing <label>: NVDA can't tell what the field is for.",
    why: "A screen reader user hears what kind of field it is, but not what to put in it.",
    fixes: [
      {
        lead: "Label it:",
        code: '<label for="email">Email</label>\n<input id="email" type="email">',
        after: `"Email, ${named(card)}"`,
      },
    ],
    path: flagPath(card),
  }),
  unnamed: (card) => ({
    title: `Something is read as "${named(card)}": likely a control with no name`,
    cause: "Likely a control with no name: NVDA has no words to read for it.",
    why: "A screen reader user hears that it's there, but not what it is.",
    fixes: [
      {
        lead: "Give it a name, visible or in aria-label:",
        code: '<div role="…" aria-label="What it is">…</div>',
        after: null,
      },
    ],
    path: flagPath(card),
  }),
  "link-unnamed": (card) => ({
    title:
      'A link is read only as "link": likely an image link with no alt text, or an icon link with no text',
    cause:
      "Likely an image link with no alt text, or an icon link with no text: there are no words in it for NVDA to read.",
    why: "A screen reader user hears that there's a link, but not where it goes.",
    fixes: [
      {
        lead: "Say where it goes, in the image's alt text or the link's aria-label:",
        code: '<a href="/contact"><img src="…" alt="Contact us"></a>',
        after: '"Contact us, link", at its Tab stop',
      },
    ],
    path: flagPath(card),
  }),
  "link-generic": (card) => ({
    title: `Links read as "${named(card)}": link text that doesn't say where it goes`,
    cause: `Link text that doesn't say where it goes: "${named(card)}" means little when a screen reader user lists the page's links, or tabs from link to link.`,
    why: `Screen reader users often move from link to link, and "${named(card)}" alone doesn't tell them where each one goes.`,
    fixes: [
      {
        lead: "Say where it goes:",
        code: '<a href="/grants">Read more about the 2026 grants</a>',
        after: '"Read more about the 2026 grants, link"',
      },
      {
        lead: "Or keep the short words, and add the rest for screen readers:",
        code: '<a href="/grants">Read more<span class="visually-hidden"> about the 2026 grants</span></a>',
        after: '"Read more about the 2026 grants, link"',
      },
    ],
    path: flagPath(card),
  }),
  "first-heading": (card) =>
    card.level === 0
      ? noHeadings(card)
      : {
          title:
            card.level === null
              ? "The first heading isn't level 1: likely a missing <h1>"
              : `The first heading is level ${card.level}, not 1: likely a missing <h1>`,
          cause:
            "Likely a missing <h1>: the page's main title isn't marked as its level 1 heading.",
          why: "Screen reader users jump to the first heading, or list the headings, to find what the page is about.",
          fixes: [
            {
              lead: "Make the page's main title its <h1>:",
              code: "<h1>Grant opportunities</h1>",
              after: '"heading, level 1, Grant opportunities"',
            },
          ],
          path: flagPath(card),
        },
  "skip-link": (card) => ({
    title: "Many Tab stops before the main content, and no skip link",
    cause: "Likely a missing skip link: the first Tab stop isn't a link to the main content.",
    why: "Keyboard and screen reader users go through every stop before the main content, on every page.",
    fixes: [
      {
        lead: "Make a skip link the first stop:",
        code: '<a href="#main">Skip to main content</a>\n…\n<main id="main">',
        after: '"Skip to main content, link", at the first Tab',
      },
    ],
    path: flagPath(card),
  }),
  "tab-nothing": (card) => ({
    title: "Tab reached nothing on the page: likely controls made of <div> or <span>",
    cause: "Likely links and buttons made of <div> or <span>, which a keyboard can't reach.",
    why: "A keyboard user can't reach the page's links or buttons.",
    fixes: [
      {
        lead: "Use real links and buttons:",
        code: '<a href="/apply">Apply</a>\n<button type="button">Open the menu</button>',
        after: "Each control's name and role, at each Tab",
      },
    ],
    path: flagPath(card),
  }),
  repeated: (card) => {
    // A repeated stretch of silence has no words to quote.
    const phrase = named(card).trim() === "" ? null : named(card);
    return {
      title:
        phrase === null
          ? "Silence, many times in a row: likely a focus trap, or content NVDA can't read"
          : `"${phrase}" is said many times in a row: likely a focus trap, or repeated content`,
      cause:
        phrase === null
          ? "Likely a focus trap, or content NVDA has no words for: NVDA said nothing, again and again."
          : "Likely a focus trap, or the same content repeated: NVDA said the same words again and again.",
      why: "A screen reader user hears the same words over and over, and may not get past them.",
      fixes: [
        {
          lead: "Check that Tab and Down Arrow move past it. If the words are repeated on purpose, hide the extra copies from screen readers:",
          code: '<div aria-hidden="true">…</div>',
          after: phrase === null ? null : `"${phrase}", once`,
        },
      ],
      path: flagPath(card),
    };
  },
  "read-stopped": () => ({
    title: "The reading stopped before the page's end",
    cause:
      "voicecap stopped reading at its step limit, or because the same words kept coming back.",
    why: "What comes after the stop wasn't heard, so it isn't in the transcripts.",
    path: [
      "Run the page again with --page.",
      "If it's just a very long page, raise its step limit.",
    ],
  }),
  custom: (card) => ({
    title: named(card),
    cause: "A rule in this site's voicecap config raised it.",
    why: "The rule's own words say what it found.",
    path: flagPath(card),
  }),
  recorded: (card) => {
    const many = card.pages.length > 1;
    return {
      title: `What the run recorded: ${named(card)}`,
      cause: many
        ? "These pages' transcripts couldn't be read here, so this card shows what their runs recorded, without NVDA's words."
        : "This page's transcripts couldn't be read here, so this card shows what its run recorded, without NVDA's words.",
      why: "voicecap can't tell from the record alone what NVDA said, so it can't suggest a fix.",
      path: [`Run voicecap again on ${many ? "these pages" : "the page"}${onePage(card)}.`],
    };
  },
  unread: (card) => {
    const many = card.pages.length > 1;
    return {
      title: many ? "Pages the latest run couldn't read" : "A page the latest run couldn't read",
      cause: many
        ? "The latest run couldn't read them: each page's reason is beside it."
        : "The latest run couldn't read it: the reason is beside the page.",
      why: "A page that wasn't read has no transcripts from this run, so nothing on it was heard.",
      path: [
        `Run ${many ? "each page" : "the page"} again with --page, with hands off the keyboard and mouse.`,
      ],
    };
  },
  issue: (card) => {
    const [page] = card.pages;
    const note = page?.detail?.trim() ?? "";
    return {
      title:
        page === undefined ? "An issue found in review" : `An issue found in review: ${page.name}`,
      cause: note === "" ? "No note was recorded." : note,
      why: "A person reviewing the transcripts found something a screen reader user would hear.",
      path: [
        "Fix it on the site.",
        'Run voicecap again on the page, then mark it "Fixed" in voicecap review.',
      ],
    };
  },
  changed: (card) => {
    const many = card.pages.length > 1;
    return {
      title: many
        ? "Pages read differently since their review"
        : "A page reads differently since its review",
      cause: many
        ? "Their transcripts changed after they were reviewed."
        : "Its transcripts changed after it was reviewed.",
      why: "The review was of other transcripts, so it doesn't cover what NVDA says there now.",
      path: [`Review ${many ? "them" : "it"} again in voicecap review.`],
    };
  },
};

/**
 * What one card of "What needs attention" says: its title, how many pages and times, where on the
 * pages NVDA said it (the page part, and its lines for each pass, as NVDA said them), its likely
 * cause, why it matters, the fix in the code and what NVDA should say then, and the path forward.
 * A fix is the usual one for the case NVDA's words show, and the person reviewing decides whether
 * it fits. It comes from what NVDA said, never from the page's code.
 */
export function attentionWords(card: AttentionCard): AttentionWords {
  const { title, cause, why, fixes = [], path } = ADVICE[card.kind](card);
  return {
    title,
    count: `${plural(card.pages.length, "page")}, ${plural(card.times, "time")}`,
    places: card.places.map((place) => {
      const lead = whereOn(place.part);
      const on = plural(place.pages.length, "page");
      return {
        lead: lead === null ? `On ${on}` : `${lead}, on ${on}`,
        quotes: place.said.map(({ pass, line }) => ({ pass: HOW_TEXT.ways[pass].key, line })),
        unavailable:
          card.kind !== "recorded"
            ? null
            : place.pages.length > 1
              ? UNAVAILABLE.many
              : UNAVAILABLE.one,
      };
    }),
    cause,
    why,
    fixes,
    path,
  };
}
