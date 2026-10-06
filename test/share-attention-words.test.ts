/**
 * The words of each card in "What needs attention": what a card says in its title, where NVDA said
 * it, its likely cause, why it matters, the fix in the code and what NVDA should say then, and the
 * path forward; and the small sentences around the cards. Pure. i2i's card is the model's own, from
 * the pages of test/helpers/share-attention.ts, so the words are checked against what the model
 * really makes; every other kind is a card built here, with the subject its title needs.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import {
  attentionCards,
  FLAG_KINDS,
  type AttentionCard,
  type AttentionKind,
  type AttentionPlace,
} from "../src/share/attention.js";
import { ATTENTION_TEXT, attentionWords } from "../src/share/text.js";
import { HOME_READ_HEADER, HOME_READ_MAIN, HOME_TAB, i2iPages } from "./helpers/share-attention.js";

/** i2i's logo: the one card that the home page and 31 biography pages make. */
function i2iCard(): AttentionCard {
  const [card, ...rest] = attentionCards(i2iPages(), DEFAULT_CONFIG.flags);
  if (card === undefined || rest.length > 0) throw new Error("i2i's pages didn't make one card.");
  return card;
}

/** A page of a card: "Page A", at /a/. */
function cardPage(slug: string, detail: string | null = null): AttentionCard["pages"][number] {
  return { slug, name: `Page ${slug.toUpperCase()}`, path: `/${slug}/`, detail };
}

/** The pages "a", "b", ... "z", then "p26", "p27", ...: "a" is first, as a card's first page is. */
function pagesOf(count: number): AttentionCard["pages"] {
  return Array.from({ length: count }, (_, i) =>
    cardPage(i < 26 ? String.fromCharCode(97 + i) : `p${i}`),
  );
}

/** A place on the card's pages, with no part, no link, and no lines, unless `more` says. */
function placeOf(more: Partial<AttentionPlace> = {}): AttentionPlace {
  return { part: null, inside: null, said: [], pages: ["a"], times: 1, ...more };
}

/** A card of `kind` on page "a", saying nothing, unless `more` gives it a subject, places, or pages. */
function cardOf(kind: AttentionKind, more: Partial<AttentionCard> = {}): AttentionCard {
  return {
    id: "need-1",
    kind,
    subject: null,
    level: null,
    places: [],
    pages: pagesOf(1),
    times: 1,
    ...more,
  };
}

/** Chrome's rule, as a graphic's likely cause tells it, around the name NVDA said. */
const chromeCause = (name: string): string =>
  `Its alt text is there, and NVDA reads it: "${name}". But Chrome counts it as missing. Chrome splits an image's alt text at spaces, punctuation, and digits, then drops words of one or two letters and common words such as "logo" and "image"; with fewer than three letters left, it calls the image "Unlabeled graphic" and offers to describe it. NVDA says what Chrome reports.`;

/** One sample card for each kind, with the title, likely cause, and reason the table gives it. */
const SAMPLES: { card: AttentionCard; title: string; cause: string; why: string }[] = [
  {
    card: cardOf("graphic-generic", { subject: "Agency Seal" }),
    title:
      'The graphic "Agency Seal" is read as "Unlabeled graphic": its alt text is too generic for Chrome',
    cause: chromeCause("Agency Seal"),
    why: 'A screen reader user on Chrome hears "Unlabeled graphic" and an offer to describe the image, every time it\'s read.',
  },
  {
    card: cardOf("graphic-unnamed", { subject: "unlabeled graphic" }),
    title: 'A graphic is read only as "unlabeled graphic": likely missing alt text',
    cause:
      "Likely missing alt text: the image has no text alternative, so NVDA can only say that it's a graphic.",
    why: "A screen reader user hears that there's an image, but not what it shows.",
  },
  {
    card: cardOf("button-unnamed"),
    title: 'A button is read only as "button": likely an icon button with no name',
    cause: "Likely an icon button with no name: there are no words in it for NVDA to read.",
    why: "A screen reader user hears that there's a button, but not what it does.",
  },
  {
    card: cardOf("field-unlabeled", { subject: "combo box" }),
    title: 'A form field is read only as "combo box": likely a missing label',
    cause: "Likely a missing <label>: NVDA can't tell what the field is for.",
    why: "A screen reader user hears what kind of field it is, but not what to put in it.",
  },
  {
    card: cardOf("unnamed", { subject: "unlabeled image" }),
    title: 'Something is read as "unlabeled image": likely a control with no name',
    cause: "Likely a control with no name: NVDA has no words to read for it.",
    why: "A screen reader user hears that it's there, but not what it is.",
  },
  {
    card: cardOf("link-unnamed"),
    title:
      'A link is read only as "link": likely an image link with no alt text, or an icon link with no text',
    cause:
      "Likely an image link with no alt text, or an icon link with no text: there are no words in it for NVDA to read.",
    why: "A screen reader user hears that there's a link, but not where it goes.",
  },
  {
    card: cardOf("link-generic", { subject: "read more" }),
    title: 'Links read as "read more": link text that doesn\'t say where it goes',
    cause:
      "Link text that doesn't say where it goes: \"read more\" means little when a screen reader user lists the page's links, or tabs from link to link.",
    why: 'Screen reader users often move from link to link, and "read more" alone doesn\'t tell them where each one goes.',
  },
  {
    card: cardOf("first-heading", { level: 2 }),
    title: "The first heading is level 2, not 1: likely a missing <h1>",
    cause: "Likely a missing <h1>: the page's main title isn't marked as its level 1 heading.",
    why: "Screen reader users jump to the first heading, or list the headings, to find what the page is about.",
  },
  {
    card: cardOf("skip-link"),
    title: "Many Tab stops before the main content, and no skip link",
    cause: "Likely a missing skip link: the first Tab stop isn't a link to the main content.",
    why: "Keyboard and screen reader users go through every stop before the main content, on every page.",
  },
  {
    card: cardOf("tab-nothing"),
    title: "Tab reached nothing on the page: likely controls made of <div> or <span>",
    cause: "Likely links and buttons made of <div> or <span>, which a keyboard can't reach.",
    why: "A keyboard user can't reach the page's links or buttons.",
  },
  {
    card: cardOf("repeated", { subject: "Close, button" }),
    title: '"Close, button" is said many times in a row: likely a focus trap, or repeated content',
    cause:
      "Likely a focus trap, or the same content repeated: NVDA said the same words again and again.",
    why: "A screen reader user hears the same words over and over, and may not get past them.",
  },
  {
    card: cardOf("read-stopped"),
    title: "The reading stopped before the page's end",
    cause:
      "voicecap stopped reading at its step limit, or because the same words kept coming back.",
    why: "What comes after the stop wasn't heard, so it isn't in the transcripts.",
  },
  {
    card: cardOf("custom", { subject: "Links to PDFs" }),
    title: "Links to PDFs",
    cause: "A rule in this site's voicecap config raised it.",
    why: "The rule's own words say what it found.",
  },
  {
    card: cardOf("recorded", { subject: "unlabeled graphic" }),
    title: "What the run recorded: unlabeled graphic",
    cause:
      "This page's transcripts couldn't be read here, so this card shows what its run recorded, without NVDA's words.",
    why: "voicecap can't tell from the record alone what NVDA said, so it can't suggest a fix.",
  },
  {
    card: cardOf("unread", { pages: [cardPage("a", "another window took the screen")] }),
    title: "A page the latest run couldn't read",
    cause: "The latest run couldn't read it: the reason is beside the page.",
    why: "A page that wasn't read has no transcripts from this run, so nothing on it was heard.",
  },
  {
    card: cardOf("issue", { pages: [cardPage("a", "Logo has no name")] }),
    title: "An issue found in review: Page A",
    cause: "Logo has no name",
    why: "A person reviewing the transcripts found something a screen reader user would hear.",
  },
  {
    card: cardOf("changed"),
    title: "A page reads differently since its review",
    cause: "Its transcripts changed after it was reviewed.",
    why: "The review was of other transcripts, so it doesn't cover what NVDA says there now.",
  },
];

describe("a card's words", () => {
  it("i2i's card, word for word", () => {
    expect(attentionWords(i2iCard())).toEqual({
      title:
        'The graphic "i 2i Logo" is read as "Unlabeled graphic": its alt text is too generic for Chrome',
      count: "32 pages, 65 times",
      places: [
        {
          lead: "In the header, on 32 pages",
          quotes: [
            { pass: "Down Arrow", line: HOME_READ_HEADER },
            { pass: "Tab", line: HOME_TAB },
          ],
          unavailable: null,
        },
        {
          lead: "In the main content, on 1 page",
          quotes: [{ pass: "Down Arrow", line: HOME_READ_MAIN }],
          unavailable: null,
        },
      ],
      cause: chromeCause("i 2i Logo"),
      why: 'A screen reader user on Chrome hears "Unlabeled graphic" and an offer to describe the image, every time it\'s read.',
      fixes: [
        {
          lead: 'In the header, it\'s inside the link that also says "INSTITUTE 2 INNOVATE", so mark it decorative:',
          code: '<img src="…" alt="">',
          after: '"INSTITUTE 2 INNOVATE, link"',
        },
        {
          lead: 'In the main content, it stands on its own, so give it a name in words, not "logo" or a file name, such as the words its link says elsewhere:',
          code: '<img src="…" alt="Institute 2 Innovate">',
          after: '"graphic, Institute 2 Innovate"',
        },
      ],
      path: [
        "Fix it in the header, which every page shares: one change fixes it on all 32 pages.",
        "Run voicecap again on one page (--page /), then on every page.",
        "Share again: once no page raises it, this card is gone.",
        'Not a problem? Mark the pages "Reviewed, no issues" in voicecap review.',
      ],
    });
  });

  it("every kind has a title, a likely cause, and a reason", () => {
    // The sample has each kind once, so a kind with no words can't pass unnoticed.
    expect(SAMPLES.map(({ card }) => card.kind).sort()).toEqual(
      [...FLAG_KINDS, "unread", "issue", "changed"].sort(),
    );
    expect(SAMPLES).toHaveLength(17);

    for (const { card, title, cause, why } of SAMPLES) {
      const words = attentionWords(card);
      expect(words.title, card.kind).toBe(title);
      expect(words.cause, card.kind).toBe(cause);
      expect(words.why, card.kind).toBe(why);
      for (const said of [words.title, words.cause, words.why]) {
        expect(said.trim(), card.kind).not.toBe("");
      }
    }
  });

  it("says a first heading with no level, and a repeated silence, in words of their own", () => {
    expect(attentionWords(cardOf("first-heading")).title).toBe(
      "The first heading isn't level 1: likely a missing <h1>",
    );
    // The page has no headings, or the message gave no level: the cause and reason are the same.
    expect(attentionWords(cardOf("first-heading")).cause).toBe(
      "Likely a missing <h1>: the page's main title isn't marked as its level 1 heading.",
    );

    const silence = attentionWords(cardOf("repeated"));
    expect(silence.title).toBe(
      "Silence, many times in a row: likely a focus trap, or content NVDA can't read",
    );
    expect(silence.cause).toBe(
      "Likely a focus trap, or content NVDA has no words for: NVDA said nothing, again and again.",
    );
    expect(silence.why).toBe(
      "A screen reader user hears the same words over and over, and may not get past them.",
    );
    expect(silence.fixes).toEqual([
      {
        lead: "Check that Tab and Down Arrow move past it. If the words are repeated on purpose, hide the extra copies from screen readers:",
        code: '<div aria-hidden="true">…</div>',
        after: null,
      },
    ]);
    // A subject that is only spaces says nothing, as none does.
    expect(attentionWords(cardOf("repeated", { subject: "  " })).title).toBe(silence.title);
  });

  it("says a page with no headings, level 0, in words of its own", () => {
    const none = (pages: AttentionCard["pages"] = pagesOf(1)) =>
      attentionWords(cardOf("first-heading", { level: 0, pages, times: pages.length }));
    const one = none();

    expect(one.title).toBe(
      "NVDA found no headings: likely titles made of styled text, not heading tags",
    );
    expect(one.cause).toBe(
      "Likely titles made of styled text, not heading tags: NVDA found no headings on the page.",
    );
    expect(none(pagesOf(2)).cause).toBe(
      "Likely titles made of styled text, not heading tags: NVDA found no headings on these pages.",
    );
    expect(one.why).toBe(
      "Screen reader users jump from heading to heading to find their way around a page; with none, they have to go through all of it.",
    );
    expect(one.fixes).toEqual([
      {
        lead: "Mark the page's title and its section titles as headings:",
        code: "<h1>Grant opportunities</h1>\n<h2>How to apply</h2>",
        after: '"heading, level 1, Grant opportunities"',
      },
    ]);
    // The usual path for a flag, for one page and for many.
    expect(one.path).toEqual([
      "Fix it on the page.",
      "Run voicecap again on one page (--page /a/), then on every page.",
      "Share again: once no page raises it, this card is gone.",
      'Not a problem? Mark the page "Reviewed, no issues" in voicecap review.',
    ]);
    expect(none(pagesOf(2)).path).toEqual([
      "Fix it on each page.",
      "Run voicecap again on one page (--page /a/), then on every page.",
      "Share again: once no page raises it, this card is gone.",
      'Not a problem? Mark the pages "Reviewed, no issues" in voicecap review.',
    ]);
    expect(one.count).toBe("1 page, 1 time");
    // Level 0 is the only one worded apart: a level NVDA said is still in its title.
    expect(attentionWords(cardOf("first-heading", { level: 3 })).title).toBe(
      "The first heading is level 3, not 1: likely a missing <h1>",
    );
  });

  it("says each of an unread page, a change, and an issue for one page or for many", () => {
    const many = pagesOf(2);
    const manyUnread = attentionWords(cardOf("unread", { pages: many, times: 2 }));
    expect(manyUnread.title).toBe("Pages the latest run couldn't read");
    expect(manyUnread.cause).toBe(
      "The latest run couldn't read them: each page's reason is beside it.",
    );
    expect(manyUnread.why).toBe(
      "A page that wasn't read has no transcripts from this run, so nothing on it was heard.",
    );

    const manyChanged = attentionWords(cardOf("changed", { pages: many, times: 2 }));
    expect(manyChanged.title).toBe("Pages read differently since their review");
    expect(manyChanged.cause).toBe("Their transcripts changed after they were reviewed.");
    expect(manyChanged.why).toBe(
      "The review was of other transcripts, so it doesn't cover what NVDA says there now.",
    );

    // An issue is a card for one page; with no note, the cause says so.
    for (const detail of [null, "", "   "]) {
      expect(
        attentionWords(cardOf("issue", { pages: [cardPage("a", detail)] })).cause,
        `${detail}`,
      ).toBe("No note was recorded.");
    }
    expect(
      attentionWords(cardOf("issue", { pages: [cardPage("a", "  Logo has no name \n")] })).cause,
    ).toBe("Logo has no name");
  });

  it("says a recorded card's cause for one page, or for many", () => {
    expect(attentionWords(cardOf("recorded", { subject: "x" })).cause).toBe(
      "This page's transcripts couldn't be read here, so this card shows what its run recorded, without NVDA's words.",
    );

    const many = attentionWords(cardOf("recorded", { subject: "x", pages: pagesOf(2), times: 2 }));
    expect(many.cause).toBe(
      "These pages' transcripts couldn't be read here, so this card shows what their runs recorded, without NVDA's words.",
    );
    // Its title and its reason name no page, so they're the same for one page and for many.
    expect(many.title).toBe("What the run recorded: x");
    expect(many.why).toBe(
      "voicecap can't tell from the record alone what NVDA said, so it can't suggest a fix.",
    );
  });

  it("counts a card's pages and its times", () => {
    expect(attentionWords(cardOf("button-unnamed")).count).toBe("1 page, 1 time");
    expect(attentionWords(cardOf("button-unnamed", { pages: pagesOf(2), times: 3 })).count).toBe(
      "2 pages, 3 times",
    );
    expect(attentionWords(cardOf("button-unnamed", { pages: pagesOf(1), times: 2 })).count).toBe(
      "1 page, 2 times",
    );
    // Big counts are written as the rest of the report writes them.
    expect(
      attentionWords(cardOf("button-unnamed", { pages: pagesOf(52), times: 1204 })).count,
    ).toBe("52 pages, 1,204 times");
  });
});

describe("where NVDA said it", () => {
  it("leads each place with its page part, and the pages it's on", () => {
    const parts: [string | null, string][] = [
      ["header", "In the header, on 1 page"],
      ["main content", "In the main content, on 2 pages"],
      ["navigation", "In the navigation, on 3 pages"],
      ["footer", "In the footer, on 4 pages"],
      ["sidebar", "In a sidebar, on 5 pages"],
      ["search", "In the search, on 6 pages"],
      [null, "On 7 pages"],
    ];
    const places = parts.map(([part], i) =>
      placeOf({ part, pages: pagesOf(i + 1).map((page) => page.slug) }),
    );

    expect(
      attentionWords(cardOf("link-generic", { subject: "read more", places })).places.map(
        (place) => place.lead,
      ),
    ).toEqual(parts.map(([, lead]) => lead));
  });

  it("leads a place whose page part it has no words for by that part's own name", () => {
    // Only the six parts NVDA names are known; any other name, even one an object inherits, is said as it is.
    const places = [placeOf({ part: "aside" }), placeOf({ part: "constructor" })];

    expect(
      attentionWords(cardOf("link-generic", { subject: "read more", places })).places.map(
        (place) => place.lead,
      ),
    ).toEqual(["In the aside, on 1 page", "In the constructor, on 1 page"]);
  });

  it("names a key for each pass, and quotes each line as NVDA said it", () => {
    const said = [
      { pass: "read" as const, line: "link, Read more" },
      { pass: "headings" as const, line: "heading, level 2, Resources" },
      { pass: "tab" as const, line: "Read more, link" },
    ];
    const [place] = attentionWords(
      cardOf("link-generic", { subject: "read more", places: [placeOf({ said })] }),
    ).places;

    expect(place?.quotes).toEqual([
      { pass: "Down Arrow", line: "link, Read more" },
      { pass: "H", line: "heading, level 2, Resources" },
      { pass: "Tab", line: "Read more, link" },
    ]);
    expect(place?.unavailable).toBeNull();
  });

  it("says NVDA's words aren't available for a recorded card, and for no other", () => {
    const place = placeOf({ pages: ["a", "b"], times: 2 });
    const unavailable = (kind: AttentionKind) =>
      attentionWords(cardOf(kind, { subject: "unlabeled graphic", places: [place] })).places.map(
        (each) => each.unavailable,
      );

    expect(attentionWords(cardOf("recorded", { places: [place] })).places[0]).toEqual({
      lead: "On 2 pages",
      quotes: [],
      unavailable: "NVDA's words aren't available here: these pages' transcripts couldn't be read.",
    });
    // No other kind says it, a read that stopped with no line to quote included.
    for (const kind of FLAG_KINDS) {
      if (kind !== "recorded") expect(unavailable(kind), kind).toEqual([null]);
    }
  });

  it("says whose transcripts couldn't be read by the pages a place is on", () => {
    const unavailable = (pages: string[]) =>
      attentionWords(
        cardOf("recorded", {
          pages: pagesOf(2),
          places: [placeOf({ pages, times: pages.length })],
        }),
      ).places.map((each) => each.unavailable);

    expect(unavailable(["a"])).toEqual([
      "NVDA's words aren't available here: this page's transcripts couldn't be read.",
    ]);
    expect(unavailable(["a", "b"])).toEqual([
      "NVDA's words aren't available here: these pages' transcripts couldn't be read.",
    ]);
    // Each place says it for its own pages, whatever the card's.
    expect(
      attentionWords(
        cardOf("recorded", {
          pages: pagesOf(3),
          places: [placeOf({ pages: ["a"] }), placeOf({ part: "footer", pages: ["b", "c"] })],
        }),
      ).places.map((each) => each.unavailable),
    ).toEqual([
      "NVDA's words aren't available here: this page's transcripts couldn't be read.",
      "NVDA's words aren't available here: these pages' transcripts couldn't be read.",
    ]);
  });

  it("has no place for a page not read, an issue, or a change", () => {
    for (const kind of ["unread", "issue", "changed"] as const) {
      expect(attentionWords(cardOf(kind)).places, kind).toEqual([]);
    }
  });
});

describe("the fix in the code", () => {
  it("gives each kind its fixes", () => {
    const fixes = (card: AttentionCard) => attentionWords(card).fixes;

    expect(fixes(cardOf("graphic-unnamed", { subject: "graphic" }))).toEqual([
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
    ]);
    expect(fixes(cardOf("button-unnamed"))).toEqual([
      {
        lead: "Give it words, visible or in aria-label:",
        code: '<button type="button" aria-label="Close menu">…</button>',
        after: '"Close menu, button"',
      },
    ]);
    expect(fixes(cardOf("field-unlabeled", { subject: "edit" }))).toEqual([
      {
        lead: "Label it:",
        code: '<label for="email">Email</label>\n<input id="email" type="email">',
        after: '"Email, edit"',
      },
    ]);
    // The field's own role is what NVDA should say after the label.
    expect(fixes(cardOf("field-unlabeled", { subject: "check box" }))[0]?.after).toBe(
      '"Email, check box"',
    );
    expect(fixes(cardOf("unnamed", { subject: "unlabeled image" }))).toEqual([
      {
        lead: "Give it a name, visible or in aria-label:",
        code: '<div role="…" aria-label="What it is">…</div>',
        after: null,
      },
    ]);
    expect(fixes(cardOf("link-unnamed"))).toEqual([
      {
        lead: "Say where it goes, in the image's alt text or the link's aria-label:",
        code: '<a href="/contact"><img src="…" alt="Contact us"></a>',
        after: '"Contact us, link", at its Tab stop',
      },
    ]);
    expect(fixes(cardOf("link-generic", { subject: "click here" }))).toEqual([
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
    ]);
    expect(fixes(cardOf("first-heading", { level: 3 }))).toEqual([
      {
        lead: "Make the page's main title its <h1>:",
        code: "<h1>Grant opportunities</h1>",
        after: '"heading, level 1, Grant opportunities"',
      },
    ]);
    expect(fixes(cardOf("skip-link"))).toEqual([
      {
        lead: "Make a skip link the first stop:",
        code: '<a href="#main">Skip to main content</a>\n…\n<main id="main">',
        after: '"Skip to main content, link", at the first Tab',
      },
    ]);
    expect(fixes(cardOf("tab-nothing"))).toEqual([
      {
        lead: "Use real links and buttons:",
        code: '<a href="/apply">Apply</a>\n<button type="button">Open the menu</button>',
        after: "Each control's name and role, at each Tab",
      },
    ]);
    expect(fixes(cardOf("repeated", { subject: "Close, button" }))).toEqual([
      {
        lead: "Check that Tab and Down Arrow move past it. If the words are repeated on purpose, hide the extra copies from screen readers:",
        code: '<div aria-hidden="true">…</div>',
        after: '"Close, button", once',
      },
    ]);
  });

  it("gives a read that stopped, a site's own rule, a recorded flag, a page not read, an issue, and a change no fix", () => {
    for (const kind of [
      "read-stopped",
      "custom",
      "recorded",
      "unread",
      "issue",
      "changed",
    ] as const) {
      expect(attentionWords(cardOf(kind, { subject: "x" })).fixes, kind).toEqual([]);
    }
  });

  describe("a graphic Chrome counts as unnamed", () => {
    const fixes = (places: AttentionPlace[]) =>
      attentionWords(cardOf("graphic-generic", { subject: "i 2i Logo", places })).fixes;
    const inLink = (words: string, role: "link" | "button" = "link") => ({ words, role });

    it("marks it decorative where it's inside a link or button with words of its own", () => {
      expect(
        fixes([
          placeOf({ part: "header", inside: inLink("INSTITUTE 2 INNOVATE") }),
          placeOf({ part: "footer", inside: inLink("Menu", "button") }),
        ]),
      ).toEqual([
        {
          lead: 'In the header, it\'s inside the link that also says "INSTITUTE 2 INNOVATE", so mark it decorative:',
          code: '<img src="…" alt="">',
          after: '"INSTITUTE 2 INNOVATE, link"',
        },
        {
          lead: 'In the footer, it\'s inside the button that also says "Menu", so mark it decorative:',
          code: '<img src="…" alt="">',
          after: '"Menu, button"',
        },
      ]);
    });

    it("names it in words where it stands on its own, as the link elsewhere says it", () => {
      const [, own] = fixes([
        placeOf({ part: "header", inside: inLink("Our Home") }),
        placeOf({ part: "main content" }),
      ]);

      // Words NVDA didn't say all in capitals stay as they were said.
      expect(own).toEqual({
        lead: 'In the main content, it stands on its own, so give it a name in words, not "logo" or a file name, such as the words its link says elsewhere:',
        code: '<img src="…" alt="Our Home">',
        after: '"graphic, Our Home"',
      });
    });

    it("names the role the words came from, a button's when a button is where they are", () => {
      const lead = (role: "link" | "button") =>
        fixes([
          placeOf({ part: "header", inside: inLink("Menu", role) }),
          placeOf({ part: "main content" }),
        ])[1]?.lead;

      expect(lead("button")).toBe(
        'In the main content, it stands on its own, so give it a name in words, not "logo" or a file name, such as the words its button says elsewhere:',
      );
      expect(lead("link")).toBe(
        'In the main content, it stands on its own, so give it a name in words, not "logo" or a file name, such as the words its link says elsewhere:',
      );
    });

    it("takes the role from the first other place that has one, as it takes the words", () => {
      const [, , own] = fixes([
        placeOf({ part: "header", inside: inLink("Menu", "button") }),
        placeOf({ part: "footer", inside: inLink("Contact us") }),
        placeOf({ part: "main content" }),
      ]);

      expect(own?.lead).toBe(
        'In the main content, it stands on its own, so give it a name in words, not "logo" or a file name, such as the words its button says elsewhere:',
      );
      expect(own?.code).toBe('<img src="…" alt="Menu">');
    });

    it("makes a name title-like when NVDA said it all in capitals", () => {
      const named = (words: string) => {
        const [, own] = fixes([placeOf({ inside: inLink(words) }), placeOf({ part: "footer" })]);
        return own?.after;
      };

      expect(named("INSTITUTE 2 INNOVATE")).toBe('"graphic, Institute 2 Innovate"');
      expect(named("ANTI-CRIME UNIT")).toBe('"graphic, Anti-Crime Unit"');
      expect(named("DON'T STOP, HOME")).toBe('"graphic, Don\'t Stop, Home"');
      expect(named("ÉCOLE NORMALE")).toBe('"graphic, École Normale"');
      // One word, even in capitals, is as NVDA said it: it may be a name like ICJIA.
      expect(named("ICJIA")).toBe('"graphic, ICJIA"');
      expect(named("I2I")).toBe('"graphic, I2I"');
      expect(named("ANTI-CRIME")).toBe('"graphic, ANTI-CRIME"');
      // A number beside the word is no second word.
      expect(named("ICJIA 2026")).toBe('"graphic, ICJIA 2026"');
      expect(named("2 ICJIA")).toBe('"graphic, 2 ICJIA"');
      // Words with a lowercase letter, or with none at all, are as NVDA said them.
      expect(named("Institute 2 INNOVATE")).toBe('"graphic, Institute 2 INNOVATE"');
      expect(named("i2i home")).toBe('"graphic, i2i home"');
      expect(named("2026")).toBe('"graphic, 2026"');
    });

    it("keeps a name's quotes and ampersand from breaking the alt text in the code", () => {
      const [, own] = fixes([
        placeOf({ inside: inLink('Research & "Stats"') }),
        placeOf({ part: "footer" }),
      ]);

      expect(own?.code).toBe('<img src="…" alt="Research &amp; &quot;Stats&quot;">');
      expect(own?.after).toBe('"graphic, Research & "Stats""');
    });

    it("asks for a name in words where there's no link elsewhere to take it from", () => {
      expect(fixes([placeOf({ part: "main content" })])).toEqual([
        {
          lead: 'In the main content, it stands on its own, so give it a name in words, not "logo" or a file name:',
          code: '<img src="…" alt="What it is, in words">',
          after: '"graphic, What it is, in words"',
        },
      ]);
      // Two places, neither inside a link: each stands on its own, with no link to point to.
      expect(
        fixes([placeOf({ part: "header" }), placeOf({ part: "footer" })]).map((fix) => fix.lead),
      ).toEqual([
        'In the header, it stands on its own, so give it a name in words, not "logo" or a file name:',
        'In the footer, it stands on its own, so give it a name in words, not "logo" or a file name:',
      ]);
    });

    it("says Here for a place that names no page part", () => {
      expect(
        fixes([placeOf({ inside: inLink("Home") }), placeOf({ pages: ["b"] })]).map(
          (fix) => fix.lead,
        ),
      ).toEqual([
        'Here, it\'s inside the link that also says "Home", so mark it decorative:',
        'Here, it stands on its own, so give it a name in words, not "logo" or a file name, such as the words its link says elsewhere:',
      ]);
    });

    it("gives no fix for a card with no place", () => {
      expect(fixes([])).toEqual([]);
    });
  });

  it("makes new words each time, so a renderer can change what it's given", () => {
    const card = cardOf("tab-nothing");
    const first = attentionWords(card);
    first.fixes.length = 0;
    first.path.length = 0;

    expect(attentionWords(card).fixes).toHaveLength(1);
    expect(attentionWords(card).path).toHaveLength(4);
  });
});

describe("the path forward", () => {
  /** The path of a card of a kind that has the fix-and-run-again path, with its pages. */
  const flagPath = (more: Partial<AttentionCard> = {}) =>
    attentionWords(cardOf("link-generic", { subject: "read more", ...more })).path;

  it("is the same four steps for every kind of flag but a read that stopped and a recorded one", () => {
    const kinds = [...FLAG_KINDS].filter((kind) => kind !== "read-stopped" && kind !== "recorded");

    expect(kinds).toHaveLength(12);
    for (const kind of kinds) {
      expect(attentionWords(cardOf(kind, { subject: "x" })).path, kind).toEqual([
        "Fix it on the page.",
        "Run voicecap again on one page (--page /a/), then on every page.",
        "Share again: once no page raises it, this card is gone.",
        'Not a problem? Mark the page "Reviewed, no issues" in voicecap review.',
      ]);
    }
  });

  it("says where to run again by the first page's address, and which pages to mark", () => {
    expect(flagPath({ pages: [cardPage("b"), cardPage("a")] })).toEqual([
      "Fix it on each page.",
      "Run voicecap again on one page (--page /b/), then on every page.",
      "Share again: once no page raises it, this card is gone.",
      'Not a problem? Mark the pages "Reviewed, no issues" in voicecap review.',
    ]);
  });

  it("says one change fixes a header, a footer, or a navigation, which every page shares", () => {
    for (const part of ["header", "footer", "navigation"]) {
      expect(
        flagPath({
          pages: pagesOf(3),
          places: [placeOf({ part, pages: ["a", "b", "c"] })],
        })[0],
        part,
      ).toBe(`Fix it in the ${part}, which every page shares: one change fixes it on all 3 pages.`);
    }
    // The part's own pages are counted, not the card's: one place of two is shared.
    expect(
      flagPath({
        pages: pagesOf(5),
        places: [
          placeOf({ part: "main content", pages: ["a", "b", "c"] }),
          placeOf({ part: "footer", pages: ["d", "e"] }),
        ],
      })[0],
    ).toBe("Fix it in the footer, which every page shares: one change fixes it on all 2 pages.");
  });

  it("names the shared part on the most pages, and the first of them when pages are level", () => {
    const shared = (...places: [string, number][]) =>
      flagPath({
        pages: pagesOf(5),
        places: places.map(([part, pages]) =>
          placeOf({ part, pages: pagesOf(pages).map((page) => page.slug) }),
        ),
      })[0];

    // The one on more pages, wherever its place comes.
    expect(shared(["header", 2], ["footer", 5])).toBe(
      "Fix it in the footer, which every page shares: one change fixes it on all 5 pages.",
    );
    expect(shared(["footer", 5], ["header", 2])).toBe(
      "Fix it in the footer, which every page shares: one change fixes it on all 5 pages.",
    );
    expect(shared(["header", 3], ["navigation", 2], ["footer", 4])).toBe(
      "Fix it in the footer, which every page shares: one change fixes it on all 4 pages.",
    );
    // A part that isn't shared never wins, however many pages it's on.
    expect(shared(["main content", 5], ["header", 2])).toBe(
      "Fix it in the header, which every page shares: one change fixes it on all 2 pages.",
    );
    // Level on pages: the first place.
    expect(shared(["navigation", 3], ["header", 3], ["footer", 3])).toBe(
      "Fix it in the navigation, which every page shares: one change fixes it on all 3 pages.",
    );
    expect(shared(["footer", 3], ["header", 3])).toBe(
      "Fix it in the footer, which every page shares: one change fixes it on all 3 pages.",
    );
  });

  it("says one change fixes a page part only where it's shared and on more than one page", () => {
    // A part on one page is no part every page shares, nor is a part that isn't a template's.
    for (const part of ["header", "footer", "navigation"]) {
      expect(flagPath({ places: [placeOf({ part })] })[0], part).toBe("Fix it on the page.");
      expect(
        flagPath({ pages: pagesOf(3), places: [placeOf({ part, pages: ["a"] })] })[0],
        part,
      ).toBe("Fix it on each page.");
    }
    for (const part of ["main content", "sidebar", "search", null]) {
      expect(
        flagPath({ pages: pagesOf(3), places: [placeOf({ part, pages: ["a", "b", "c"] })] })[0],
        `${part}`,
      ).toBe("Fix it on each page.");
    }
  });

  it("has one step for a recorded flag", () => {
    expect(attentionWords(cardOf("recorded", { subject: "x" })).path).toEqual([
      "Run voicecap again on the page (--page /a/).",
    ]);
    expect(
      attentionWords(cardOf("recorded", { subject: "x", pages: [cardPage("b"), cardPage("a")] }))
        .path,
    ).toEqual(["Run voicecap again on these pages (--page /b/)."]);
  });

  it("has two steps for a read that stopped", () => {
    for (const pages of [pagesOf(1), pagesOf(2)]) {
      expect(attentionWords(cardOf("read-stopped", { pages })).path).toEqual([
        "Run the page again with --page.",
        "If it's just a very long page, raise its step limit.",
      ]);
    }
  });

  it("asks for a page not read to be run again, hands off", () => {
    expect(attentionWords(cardOf("unread")).path).toEqual([
      "Run the page again with --page, with hands off the keyboard and mouse.",
    ]);
    expect(attentionWords(cardOf("unread", { pages: pagesOf(2) })).path).toEqual([
      "Run each page again with --page, with hands off the keyboard and mouse.",
    ]);
  });

  it("has two steps for an issue", () => {
    expect(attentionWords(cardOf("issue", { pages: [cardPage("a", "x")] })).path).toEqual([
      "Fix it on the site.",
      'Run voicecap again on the page, then mark it "Fixed" in voicecap review.',
    ]);
  });

  it("asks for a change since a review to be reviewed again", () => {
    expect(attentionWords(cardOf("changed")).path).toEqual(["Review it again in voicecap review."]);
    expect(attentionWords(cardOf("changed", { pages: pagesOf(2) })).path).toEqual([
      "Review them again in voicecap review.",
    ]);
  });
});

describe("the section's own words", () => {
  it("has the section's title, the line for no problem, and the labels of a card's parts", () => {
    expect(Object.keys(ATTENTION_TEXT).sort()).toEqual([
      "gist",
      "labels",
      "more",
      "none",
      "sentence",
      "title",
    ]);
    expect(ATTENTION_TEXT.title).toBe("What needs attention");
    // The spec pins it, word for word.
    expect(ATTENTION_TEXT.none).toBe(
      "Nothing needs attention: every page was read, and every flag was fixed or checked by a person.",
    );
    expect(ATTENTION_TEXT.labels).toEqual({
      cause: "Likely cause",
      why: "Why it matters",
      fix: "The fix in the code",
      after: "What NVDA should say then",
      path: "The path forward",
      pages: "The pages",
    });
  });

  it("says the summary's sentence for one problem or many, and for one page or many", () => {
    expect(ATTENTION_TEXT.sentence(1, 32)).toBe("1 problem needs attention, on 32 pages.");
    expect(ATTENTION_TEXT.sentence(2, 1)).toBe("2 problems need attention, on 1 page.");
    expect(ATTENTION_TEXT.sentence(1, 1)).toBe("1 problem needs attention, on 1 page.");
    expect(ATTENTION_TEXT.sentence(1200, 3000)).toBe(
      "1,200 problems need attention, on 3,000 pages.",
    );
  });

  it("says how many cards the summary's panel leaves out", () => {
    expect(ATTENTION_TEXT.more(35)).toBe("and 35 more, under What needs attention");
    expect(ATTENTION_TEXT.more(1)).toBe("and 1 more, under What needs attention");
    expect(ATTENTION_TEXT.more(1204)).toBe("and 1,204 more, under What needs attention");
  });

  it("opens the section with how many problems, on how many pages, and what to do", () => {
    expect(ATTENTION_TEXT.gist(1, 32)).toBe(
      "1 problem, on 32 pages. Fix each one and run voicecap again, or check it and record that in voicecap review, until nothing is left.",
    );
    expect(ATTENTION_TEXT.gist(7, 1)).toBe(
      "7 problems, on 1 page. Fix each one and run voicecap again, or check it and record that in voicecap review, until nothing is left.",
    );
  });
});

describe("what the words never say", () => {
  /** Every string in `value`, however deep, with each function in it called with some counts. */
  function wordsIn(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "function") {
      const say = value as (...counts: number[]) => string;
      return [say(1, 32), say(2, 1), say(35, 1)];
    }
    if (Array.isArray(value)) return value.flatMap(wordsIn);
    if (typeof value === "object" && value !== null) return Object.values(value).flatMap(wordsIn);
    return [];
  }

  it("never says automated, never any form of listen, and never names a library", () => {
    const cards = [
      i2iCard(),
      ...SAMPLES.map(({ card }) => card),
      cardOf("repeated"),
      cardOf("first-heading"),
      cardOf("first-heading", { level: 0 }),
      cardOf("first-heading", { level: 0, pages: pagesOf(2) }),
      cardOf("recorded", {
        subject: "x",
        pages: pagesOf(2),
        places: [placeOf({ pages: ["a", "b"] })],
      }),
      cardOf("unread", { pages: pagesOf(2) }),
      cardOf("changed", { pages: pagesOf(2) }),
      cardOf("issue", { pages: [cardPage("a", "")] }),
    ];
    const strings = [
      ...wordsIn(ATTENTION_TEXT),
      ...cards.flatMap((card) => wordsIn(attentionWords(card))),
    ];
    // The fixed text's own checks (share-text.test.ts), which card words are held to as well: the
    // word listen is said only in the two phrases that stay, and voicecap is never called automated.
    const kept = ["the listen-through", "the one to listen to"];
    const rest = strings.map((string) =>
      kept.reduce((left, phrase) => left.replaceAll(phrase, ""), string),
    );

    // Words were read at all: the section's own, and each card's.
    expect(strings).toContain(ATTENTION_TEXT.none);
    expect(strings).toContain("Fix it on the page.");
    expect(strings.length).toBeGreaterThan(100);
    expect(rest.filter((string) => /listen|automated|guidepup/i.test(string))).toEqual([]);
  });
});
