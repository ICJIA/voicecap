/**
 * What needs attention, as a card for each problem: the model groups the pages' flags, the pages
 * the latest run couldn't read, reads that stopped, open issues, and pages changed since their
 * review into cards, each from NVDA's own words where the page has them. Pure: the pages are built
 * in helpers/share-attention.ts, with flags computed by the default rules, and the model's own
 * cards come from runs built in memory and the demo runs of 29 September 2026.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { evaluateFlags, type FlagRules, type PagePasses } from "../src/flags/evaluate.js";
import type { FlagResult, ReviewEntry } from "../src/model.js";
import {
  attentionCards,
  FLAG_KINDS,
  graphicName,
  insideOf,
  speechItems,
  type AttentionCard,
  type AttentionPage,
} from "../src/share/attention.js";
import { buildShareModel } from "../src/share/model.js";
import type { PageReview } from "../src/share/review.js";
import {
  BIO_READ,
  BIO_TAB,
  HOME_READ_HEADER,
  HOME_READ_MAIN,
  HOME_TAB,
  i2iPages,
  pageFrom,
  pageOf,
  passesOf,
  reviewed,
} from "./helpers/share-attention.js";
import { shareRun } from "./helpers/share-data.js";
import { demoModel, inputOf, storeOf } from "./helpers/share-model.js";

const rules = DEFAULT_CONFIG.flags;

/** Each card's kind and subject, in the cards' order. */
const kindsOf = (cards: AttentionCard[]) => cards.map((card) => [card.kind, card.subject]);

describe("NVDA's speech, item by item", () => {
  it("splits NVDA's speech into items as the rules do, keeping its capitals", () => {
    expect(speechItems(HOME_TAB)).toEqual([
      "banner landmark",
      "i 2i Logo",
      "To get missing image descriptions",
      "open the context menu",
      "Unlabeled graphic",
      "INSTITUTE 2 INNOVATE",
      "same page",
      "link",
      "current page",
    ]);
    expect(speechItems("  Close,\n button. ")).toEqual(["Close", "button"]);
  });

  it("graphicName reads each order", () => {
    const names: [string, string | null][] = [
      [HOME_READ_HEADER, "i 2i Logo"],
      [HOME_TAB, "i 2i Logo"],
      [BIO_READ, "i 2i Logo"],
      [BIO_TAB, "i 2i Logo"],
      // A name with no hint from Chrome after it.
      [HOME_READ_MAIN, "i 2i logo"],
      // NVDA's British spelling.
      ["Unlabelled graphic, Photo", "Photo"],
      // Chrome's hint after a graphic that has no name at all.
      ["unlabeled graphic. To get missing image descriptions, open the context menu.", null],
      ["unlabeled graphic", null],
      ["graphic", null],
      // What can follow a graphic and is never its name: a link, where a link goes, a landmark, a
      // state, a button.
      ["Unlabeled graphic, link", null],
      ["Unlabeled graphic, same page, link", null],
      ["Unlabeled graphic, main landmark", null],
      ["Unlabeled graphic, clickable", null],
      ["Unlabeled graphic, button", null],
      // The graphic is the item NVDA calls unlabeled, not a link's words that say "graphic".
      ["Graphic design, link, Unlabeled graphic, Photo", "Photo"],
      // Chrome's hint after what is never a name, at a Tab stop: the graphic has no name, and the
      // link's words after it aren't one.
      [
        "banner landmark, To get missing image descriptions, open the context menu., Unlabeled graphic, INSTITUTE 2 INNOVATE, link",
        null,
      ],
      [
        "To get missing image descriptions, open the context menu., Unlabeled graphic, Home, link",
        null,
      ],
    ];

    for (const [spoken, name] of names) expect(graphicName(spoken), spoken).toBe(name);
  });

  it("insideOf finds the link's own words", () => {
    for (const line of [HOME_TAB, BIO_TAB]) {
      expect(insideOf(line, "i 2i Logo"), line).toEqual({
        words: "INSTITUTE 2 INNOVATE",
        role: "link",
      });
    }
    // A graphic that is all its link says: the link has no words of its own.
    expect(insideOf("Unlabeled graphic, i 2i Logo, link", "i 2i Logo")).toBeNull();
    // A button's own words, without its state.
    expect(
      insideOf(
        "i 2i Logo. To get missing image descriptions, open the context menu., Unlabeled graphic, Menu, button, collapsed",
        "i 2i Logo",
      ),
    ).toEqual({ words: "Menu", role: "button" });
    // No link or button: the graphic stands on its own.
    expect(insideOf(HOME_READ_MAIN, "i 2i logo")).toBeNull();
    // A link whose own words say "graphic": they're its words, and the graphic is the item NVDA
    // calls unlabeled.
    expect(
      insideOf(
        "Graphic design, Photo. To get missing image descriptions, open the context menu., Unlabeled graphic, link",
        "Photo",
      ),
    ).toEqual({ words: "Graphic design", role: "link" });
    // A graphic with no name at all, in a link with words of its own.
    expect(
      insideOf(
        "To get missing image descriptions, open the context menu., Unlabeled graphic, Home, link",
        null,
      ),
    ).toEqual({ words: "Home", role: "link" });
  });
});

describe("what needs attention, as a card for each problem", () => {
  it("i2i's logo is one card on 32 pages, 65 times", () => {
    const pages = i2iPages();
    const slugs = pages.map(({ card }) => card.slug);
    const cards = attentionCards(pages, rules);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "need-1",
      kind: "graphic-generic",
      subject: "i 2i Logo",
      level: null,
      times: 65,
    });
    expect(cards[0]?.pages).toHaveLength(32);
    expect(cards[0]?.pages.map((page) => page.slug)).toEqual(slugs);
    expect(cards[0]?.pages.slice(0, 2)).toEqual([
      { slug: "home", name: "Home", path: "/", detail: null },
      { slug: "bio-1", name: "Biography 1", path: "/biographies/bio-1/", detail: null },
    ]);
    expect(cards[0]?.places).toEqual([
      {
        part: "header",
        inside: { words: "INSTITUTE 2 INNOVATE", role: "link" },
        said: [
          { pass: "read", line: HOME_READ_HEADER },
          { pass: "tab", line: HOME_TAB },
        ],
        pages: slugs,
        times: 64,
      },
      {
        part: "main content",
        inside: null,
        said: [{ pass: "read", line: HOME_READ_MAIN }],
        pages: ["home"],
        times: 1,
      },
    ]);
  });

  it("a graphic with no name is missing alt text", () => {
    expect(
      attentionCards([pageOf("team", ["Our team", "graphic", "Contact us"], [])], rules),
    ).toEqual([
      {
        id: "need-1",
        kind: "graphic-unnamed",
        subject: "graphic",
        level: null,
        places: [
          {
            part: null,
            inside: null,
            said: [{ pass: "read", line: "graphic" }],
            pages: ["team"],
            times: 1,
          },
        ],
        pages: [{ slug: "team", name: "Page team", path: "/team/", detail: null }],
        times: 1,
      },
    ]);

    // At a Tab stop: Chrome's hint is all the graphic's name, inside a link with words of its own.
    const home =
      "To get missing image descriptions, open the context menu., Unlabeled graphic, Home, link";
    expect(attentionCards([pageOf("about", [], [home])], rules)).toEqual([
      {
        id: "need-1",
        kind: "graphic-unnamed",
        subject: "unlabeled graphic",
        level: null,
        places: [
          {
            part: null,
            inside: { words: "Home", role: "link" },
            said: [{ pass: "tab", line: home }],
            pages: ["about"],
            times: 1,
          },
        ],
        pages: [{ slug: "about", name: "Page about", path: "/about/", detail: null }],
        times: 1,
      },
    ]);
  });

  it("a review settles a page's flags", () => {
    const logo = (review: PageReview) => pageOf("home", [HOME_READ_HEADER], [HOME_TAB], review);

    expect(attentionCards([logo(reviewed("reviewed"))], rules)).toEqual([]);
    expect(attentionCards([logo(reviewed("fixed"))], rules)).toEqual([]);
    // An entry that takes a review back settles nothing.
    expect(kindsOf(attentionCards([logo(reviewed("unreviewed"))], rules))).toEqual([
      ["graphic-generic", "i 2i Logo"],
    ]);

    // An issue found takes the page's flags into the issue, with its note.
    expect(attentionCards([logo(reviewed("issue", { note: "Logo has no name" }))], rules)).toEqual([
      {
        id: "need-1",
        kind: "issue",
        subject: null,
        level: null,
        places: [],
        pages: [{ slug: "home", name: "Home", path: "/", detail: "Logo has no name" }],
        times: 1,
      },
    ]);
    expect(attentionCards([logo(reviewed("issue"))], rules)[0]?.pages[0]?.detail).toBe("");

    // A review of other transcripts settles nothing: the page is on the changed card, and on its
    // flags' card. An issue found in them stays an issue.
    const changed = attentionCards([logo(reviewed("reviewed", { changed: true }))], rules);
    expect(changed.map((card) => [card.kind, card.pages.map((page) => page.slug)])).toEqual([
      ["graphic-generic", ["home"]],
      ["changed", ["home"]],
    ]);
    expect(changed[1]).toEqual({
      id: "need-2",
      kind: "changed",
      subject: null,
      level: null,
      places: [],
      pages: [{ slug: "home", name: "Home", path: "/", detail: null }],
      times: 1,
    });
    const issue = reviewed("issue", { note: "Logo has no name", changed: true });
    expect(kindsOf(attentionCards([logo(issue)], rules))).toEqual([
      ["issue", null],
      ["changed", null],
    ]);

    // Each issue is a card of its own, with its own note.
    const issues = attentionCards(
      [
        logo(reviewed("issue", { note: "Logo has no name" })),
        pageOf(
          "team",
          ["Our team", "graphic"],
          [],
          reviewed("issue", { note: "Photo has no text" }),
        ),
      ],
      rules,
    );
    expect(issues.map((card) => [card.id, card.kind, card.pages])).toEqual([
      ["need-1", "issue", [{ slug: "home", name: "Home", path: "/", detail: "Logo has no name" }]],
      [
        "need-2",
        "issue",
        [{ slug: "team", name: "Page team", path: "/team/", detail: "Photo has no text" }],
      ],
    ]);
  });

  it("keeps a read that stopped on its card whatever the review says, until a run reads it all", () => {
    const stopped = (review: PageReview) =>
      pageFrom("archive", passesOf({ read: ["Archive", "2019"] }, "step-cap"), {
        card: { readStopped: "step-cap" },
        review,
      });
    const card: AttentionCard = {
      id: "need-1",
      kind: "read-stopped",
      subject: null,
      level: null,
      places: [
        {
          part: null,
          inside: null,
          said: [{ pass: "read", line: "2019" }],
          pages: ["archive"],
          times: 1,
        },
      ],
      pages: [{ slug: "archive", name: "Page archive", path: "/archive/", detail: null }],
      times: 1,
    };

    expect(stopped(reviewed("reviewed")).card.flags.map((flag) => flag.rule)).toEqual([
      "read-not-finished",
    ]);
    expect(attentionCards([stopped(reviewed("reviewed"))], rules)).toEqual([card]);
    expect(attentionCards([stopped(reviewed("fixed"))], rules)).toEqual([card]);
    // An issue found is a card of its own, beside the read that stopped.
    const issue = attentionCards([stopped(reviewed("issue", { note: "Ends mid-list" }))], rules);
    expect(issue.map((each) => [each.kind, each.pages.map((page) => page.detail)])).toEqual([
      ["read-stopped", [null]],
      ["issue", ["Ends mid-list"]],
    ]);
  });

  it("pages not read, and reads that stopped", () => {
    const failed = pageFrom("contact", null, {
      card: { status: "failed", failure: "another window took the screen" },
    });
    const never = pageFrom("apply", null, {
      card: { status: "never", failure: "It couldn't be read, and its record doesn't say why." },
    });
    // A page voicecap skipped, and one no run has tried, aren't pages a run couldn't read.
    const skipped = pageFrom("annual-report", null, {
      card: { status: "skipped", failure: "voicecap skipped it: its address isn't an HTML page." },
    });
    const untried = pageFrom("later", null, { card: { status: "never" } });
    const stopped = pageFrom(
      "archive",
      passesOf({ read: ["Archive", "2019", "2018"] }, "step-cap"),
      {
        card: { readStopped: "step-cap" },
      },
    );

    expect(stopped.card.flags.map((flag) => flag.rule)).toEqual(["read-not-finished"]);
    expect(attentionCards([failed, never, skipped, untried, stopped], rules)).toEqual([
      {
        id: "need-1",
        kind: "unread",
        subject: null,
        level: null,
        places: [],
        pages: [
          {
            slug: "contact",
            name: "Page contact",
            path: "/contact/",
            detail: "another window took the screen",
          },
          {
            slug: "apply",
            name: "Page apply",
            path: "/apply/",
            detail: "It couldn't be read, and its record doesn't say why.",
          },
        ],
        times: 2,
      },
      {
        id: "need-2",
        kind: "read-stopped",
        subject: null,
        level: null,
        places: [
          {
            part: null,
            inside: null,
            said: [{ pass: "read", line: "2018" }],
            pages: ["archive"],
            times: 1,
          },
        ],
        pages: [{ slug: "archive", name: "Page archive", path: "/archive/", detail: null }],
        times: 1,
      },
    ]);
  });

  it("puts a read that stopped on its card once, whether its flag or its record says so", () => {
    // Flags as recorded: the page's record says its read stopped, and so does its flag.
    const flag: FlagResult = {
      rule: "read-not-finished",
      pass: "read",
      message:
        "The read pass was stopped by the repeat safety net instead of reaching the end of the page.",
    };
    const recorded = pageFrom("events", null, {
      flags: [flag],
      card: { readStopped: "repeat-limit" },
    });
    // The rule is off, so only the page's record says so.
    const off = { ...rules, readNotFinished: { enabled: false } };
    const unflagged = pageFrom("archive", passesOf({ read: ["Archive", "2019"] }, "step-cap"), {
      rules: off,
      card: { readStopped: "step-cap" },
    });

    expect(unflagged.card.flags).toEqual([]);
    expect(attentionCards([recorded, unflagged], off)).toEqual([
      {
        id: "need-1",
        kind: "read-stopped",
        subject: null,
        level: null,
        places: [{ part: null, inside: null, said: [], pages: ["events", "archive"], times: 2 }],
        pages: [
          { slug: "events", name: "Page events", path: "/events/", detail: null },
          { slug: "archive", name: "Page archive", path: "/archive/", detail: null },
        ],
        times: 2,
      },
    ]);
  });

  it("each rule's kind", () => {
    const one = (page: AttentionPage, flagRules = rules) => attentionCards([page], flagRules);
    const readMore = ["link, Read more", "Our news", "link, Read more"];

    // Generic link text on two pages: one card, named by what the links say.
    const links = attentionCards(
      [pageOf("news", readMore, []), pageOf("events", readMore, [])],
      rules,
    );
    expect(links.map((card) => [card.kind, card.subject, card.pages.length, card.times])).toEqual([
      ["link-generic", "read more", 2, 4],
    ]);
    // A link with no name.
    expect(kindsOf(one(pageOf("a", [], ["link", "main landmark, link"])))).toEqual([
      ["link-unnamed", null],
    ]);
    // A button with no name, and form fields with no label.
    expect(kindsOf(one(pageOf("a", ["Search", "button"], [])))).toEqual([["button-unnamed", null]]);
    expect(kindsOf(one(pageOf("a", [], ["edit"])))).toEqual([["field-unlabeled", "edit"]]);
    expect(kindsOf(one(pageOf("a", [], ["radio button, not checked"])))).toEqual([
      ["field-unlabeled", "radio button"],
    ]);
    // Anything else NVDA calls unlabeled.
    expect(kindsOf(one(pageOf("a", ["Unlabeled image"], [])))).toEqual([
      ["unnamed", "unlabeled image"],
    ]);

    // The first heading, with the level NVDA said; none for a page with no headings.
    const level2 = pageFrom(
      "a",
      passesOf({ headings: ["heading, level 2, Resources", "heading, level 3, Grants"] }),
    );
    expect(level2.card.flags.map((flag) => flag.message)).toEqual([
      "The first heading is level 2, not level 1.",
    ]);
    expect(one(level2)).toEqual([
      {
        id: "need-1",
        kind: "first-heading",
        subject: null,
        level: 2,
        places: [
          {
            part: null,
            inside: null,
            said: [{ pass: "headings", line: "heading, level 2, Resources" }],
            pages: ["a"],
            times: 1,
          },
        ],
        pages: [{ slug: "a", name: "Page a", path: "/a/", detail: null }],
        times: 1,
      },
    ]);
    const none = one(pageFrom("a", passesOf({ headings: [] })));
    expect(none.map((card) => [card.kind, card.level, card.places[0]?.said])).toEqual([
      ["first-heading", null, []],
    ]);

    // Many Tab stops before the main content, and no skip link: its first stop is quoted.
    const nav = Array.from({ length: 11 }, (_, i) => `Nav ${i + 1}, link`);
    expect(
      one(pageOf("a", [], nav)).map((card) => [
        card.kind,
        card.subject,
        card.times,
        card.places[0]?.said,
      ]),
    ).toEqual([["skip-link", null, 11, [{ pass: "tab", line: "Nav 1, link" }]]]);
    // Tab reached nothing.
    expect(kindsOf(one(pageFrom("a", passesOf({ read: ["Welcome"], tab: [] }))))).toEqual([
      ["tab-nothing", null],
    ]);
    // The same words said again and again.
    const trap = one(
      pageOf(
        "a",
        [],
        Array.from({ length: 5 }, () => "Close, button"),
      ),
    );
    expect(trap.map((card) => [card.kind, card.subject, card.times])).toEqual([
      ["repeated", "Close, button", 5],
    ]);

    // A rule of the site's own, named by its description.
    const pdf: FlagRules = {
      ...rules,
      custom: [
        {
          id: "pdf-links",
          description: "Links to PDFs",
          passes: ["read"],
          pattern: "\\bpdf\\b",
          minCount: 1,
        },
      ],
    };
    const report = pageFrom("a", passesOf({ read: ["link, Annual report (PDF)", "Footer"] }), {
      rules: pdf,
    });
    expect(one(report, pdf).map((card) => [card.kind, card.subject, card.places[0]?.said])).toEqual(
      [["custom", "Links to PDFs", [{ pass: "read", line: "link, Annual report (PDF)" }]]],
    );
  });

  it("makes one card of a site's own rule, named by its description, however often it matched", () => {
    const pdf: FlagRules = {
      ...rules,
      custom: [
        {
          id: "pdf-links",
          description: "Links to PDFs",
          passes: ["read", "tab"],
          pattern: "\\bpdf\\b",
          minCount: 1,
        },
      ],
    };
    // Once in the read pass and twice at Tab stops on one page, twice in the read pass on another.
    const report = pageFrom(
      "report",
      passesOf({
        read: ["link, Annual report (PDF)", "Footer"],
        tab: ["Annual report (PDF), link", "Budget (PDF), link"],
      }),
      { rules: pdf },
    );
    const budget = pageFrom(
      "budget",
      passesOf({ read: ["link, Budget (PDF)", "link, Plan (PDF)", "Footer"] }),
      { rules: pdf },
    );

    expect([...report.card.flags, ...budget.card.flags].map((flag) => flag.message)).toEqual([
      "Links to PDFs (1 match in the read pass).",
      "Links to PDFs (2 matches in the tab pass).",
      "Links to PDFs (2 matches in the read pass).",
    ]);
    expect(attentionCards([report, budget], pdf)).toEqual([
      {
        id: "need-1",
        kind: "custom",
        subject: "Links to PDFs",
        level: null,
        places: [
          {
            part: null,
            inside: null,
            said: [
              { pass: "read", line: "link, Annual report (PDF)" },
              { pass: "tab", line: "Annual report (PDF), link" },
            ],
            pages: ["report", "budget"],
            times: 5,
          },
        ],
        pages: [
          { slug: "report", name: "Page report", path: "/report/", detail: null },
          { slug: "budget", name: "Page budget", path: "/budget/", detail: null },
        ],
        times: 5,
      },
    ]);
    // A rule the config no longer has is named by its message, without its final period.
    expect(kindsOf(attentionCards([budget], rules))).toEqual([
      ["custom", "Links to PDFs (2 matches in the read pass)"],
    ]);
  });

  it("takes a card's lines from the passes that raised its flags, and no others", () => {
    // Two generic links in the read pass raise a flag; one at a Tab stop is too few to raise one.
    const page = pageOf(
      "news",
      ["link, Read more", "Our news", "link, Read more"],
      ["Read more, link"],
    );

    expect(page.card.flags.map((flag) => [flag.rule, flag.pass])).toEqual([
      ["generic-link-text", "read"],
    ]);
    expect(
      attentionCards([page], rules).map((card) => [
        card.kind,
        card.subject,
        card.times,
        card.places[0]?.said,
      ]),
    ).toEqual([["link-generic", "read more", 2, [{ pass: "read", line: "link, Read more" }]]]);
  });

  it("first headings at different levels are different cards", () => {
    const first = (slug: string, level: number) =>
      pageFrom(slug, passesOf({ headings: [`heading, level ${level}, Welcome`] }));
    const cards = attentionCards([first("a", 2), first("b", 3), first("c", 2)], rules);

    expect(
      cards.map((card) => [card.kind, card.level, card.pages.map((page) => page.slug)]),
    ).toEqual([
      ["first-heading", 2, ["a", "c"]],
      ["first-heading", 3, ["b"]],
    ]);
  });

  it("cards come most pages first", () => {
    const readMore = ["link, Read more", "Our news", "link, Read more"];
    const pages = [
      pageOf("a", ["Search", "button"], []),
      pageOf("b", readMore, []),
      pageOf("c", readMore, []),
      pageOf("d", ["Our team", "graphic"], []),
      pageOf("e", ["link, Click here", "Our news", "link, Click here"], []),
      pageOf("f", ["link, Learn more", "Our news", "link, Learn more"], []),
    ];
    const cards = attentionCards(pages, rules);

    expect(
      cards.map((card) => [card.id, card.kind, card.subject, card.pages.map((page) => page.slug)]),
    ).toEqual([
      ["need-1", "link-generic", "read more", ["b", "c"]],
      // Ties go in the kinds' order: the graphic before the button, though the button's page is first.
      ["need-2", "graphic-unnamed", "graphic", ["d"]],
      ["need-3", "button-unnamed", null, ["a"]],
      // Then by their first page.
      ["need-4", "link-generic", "click here", ["e"]],
      ["need-5", "link-generic", "learn more", ["f"]],
    ]);
  });

  it("counts every kind as a flag's but a page not read, an issue, and a change", () => {
    expect([...FLAG_KINDS].sort()).toEqual(
      [
        "graphic-generic",
        "graphic-unnamed",
        "button-unnamed",
        "field-unlabeled",
        "unnamed",
        "link-unnamed",
        "link-generic",
        "first-heading",
        "skip-link",
        "tab-nothing",
        "repeated",
        "read-stopped",
        "custom",
        "recorded",
      ].sort(),
    );
  });

  it("flags as recorded make recorded cards", () => {
    const found: FlagResult = {
      rule: "unlabeled",
      pass: "read",
      count: 2,
      found: [{ text: "unlabeled graphic", count: 2 }],
      message: 'Unlabeled or poorly labeled items in the read pass: "unlabeled graphic" ×2.',
    };
    expect(attentionCards([pageFrom("home", null, { flags: [found] })], rules)).toEqual([
      {
        id: "need-1",
        kind: "recorded",
        subject: "unlabeled graphic",
        level: null,
        places: [{ part: null, inside: null, said: [], pages: ["home"], times: 2 }],
        pages: [{ slug: "home", name: "Home", path: "/", detail: null }],
        times: 2,
      },
    ]);

    // Each item found is its own card, however many passes found it.
    const tab: FlagResult = {
      rule: "unlabeled",
      pass: "tab",
      count: 2,
      found: [
        { text: "button", count: 1 },
        { text: "unlabeled graphic", count: 1 },
      ],
      message:
        'Unlabeled or poorly labeled items in the tab pass: "button" ×1, "unlabeled graphic" ×1.',
    };
    expect(
      attentionCards([pageFrom("home", null, { flags: [found, tab] })], rules).map((card) => [
        card.kind,
        card.subject,
        card.times,
      ]),
    ).toEqual([
      ["recorded", "unlabeled graphic", 3],
      ["recorded", "button", 1],
    ]);

    // A record from before voicecap kept what a flag found: a card for each rule, named by its
    // message.
    const old: FlagResult[] = [
      {
        rule: "generic-link-text",
        pass: "read",
        count: 3,
        message: 'Generic link text announced 3 times in the read pass: "click here" ×3.',
      },
      { rule: "headings", pass: "headings", message: "The first heading is level 2, not level 1." },
    ];
    expect(
      attentionCards([pageFrom("home", null, { flags: old })], rules).map((card) => [
        card.kind,
        card.subject,
        card.times,
        card.places[0]?.said,
      ]),
    ).toEqual([
      ["recorded", 'Generic link text announced 3 times in the read pass: "click here" ×3', 3, []],
      ["recorded", "The first heading is level 2, not level 1", 1, []],
    ]);
  });

  it("keeps a flag whose lines aren't here as recorded, so no flag is lost", () => {
    // The page's transcripts here are its read pass's alone, and its flag is the Tab pass's.
    const flag: FlagResult = {
      rule: "unlabeled",
      pass: "tab",
      count: 1,
      found: [{ text: "button", count: 1 }],
      message: 'Unlabeled or poorly labeled items in the tab pass: "button" ×1.',
    };
    const page = pageFrom("a", passesOf({ read: ["Welcome"] }), { flags: [flag] });

    expect(
      attentionCards([page], rules).map((card) => [
        card.kind,
        card.subject,
        card.times,
        card.places[0]?.said,
      ]),
    ).toEqual([["recorded", "button", 1, []]]);
  });
});

describe("the model's cards", () => {
  it("are the demo's, from NVDA's own words, with the page the latest run couldn't read", async () => {
    const model = await demoModel();
    const common = "common-mistakes-db8c98dbfa";
    const how = "how-a-run-works-fd116f9328";

    expect(
      model.attention.map((card) => [
        card.id,
        card.kind,
        card.subject,
        card.level,
        card.pages.map((page) => page.slug),
        card.times,
      ]),
    ).toEqual([
      ["need-1", "button-unnamed", null, null, [common], 2],
      ["need-2", "field-unlabeled", "edit", null, [common], 1],
      ["need-3", "link-generic", "click here", null, [common], 6],
      ["need-4", "first-heading", null, 2, [common], 1],
      ["need-5", "unread", null, null, [how], 1],
    ]);
    expect(model.attention[1]?.places).toEqual([
      {
        part: "main content",
        inside: null,
        said: [{ pass: "tab", line: "main landmark. edit, blank" }],
        pages: [common],
        times: 1,
      },
    ]);
    expect(model.attention[2]?.places).toEqual([
      {
        part: null,
        inside: null,
        said: [
          { pass: "read", line: "To see how a run works,, link, click here, dot" },
          { pass: "tab", line: "click here, link" },
        ],
        pages: [common],
        times: 6,
      },
    ]);
    const failure = model.pages.find((card) => card.slug === how)?.failure;
    expect(failure).toEqual(expect.any(String));
    expect(model.attention[4]?.pages[0]?.detail).toBe(failure);
  });

  it("take each page's review, and leave a page whose flags are as recorded without NVDA's words", () => {
    const lines = { read: [BIO_READ, "Footer"], tab: [BIO_TAB] };
    const store = storeOf(() => lines);
    // The flags the loader computes from these transcripts, with the default rules.
    const passes: PagePasses = {};
    for (const pass of ["read", "tab"] as const) {
      passes[pass] = { steps: store.steps("", "", pass) ?? [], stopReason: "end-reached" };
    }
    const flags = evaluateFlags(passes, rules);
    const run = shareRun({
      id: "2026-09-26_1405",
      pages: ["/", "/team/", "/contact/"].map((path) => ({ path, passes: lines, flags })),
    });
    const [, team, contact] = run.pages;
    if (team === undefined || contact === undefined) throw new Error("The run lost a page.");
    // An issue found in the transcripts shown.
    const issue: ReviewEntry = {
      status: "issue",
      reviewer: "Pat Lee",
      at: "2026-09-27T10:00:00-05:00",
      note: "Logo has no name",
      run: run.id,
      url: contact.url,
      files: {},
      content: Object.fromEntries(
        Object.entries(contact.passes).map(([pass, summary]) => [pass, summary.contentSha256]),
      ),
    };
    const model = buildShareModel(
      inputOf([run], {
        transcripts: store,
        flagsAsRecorded: [{ run: run.id, slug: team.slug }],
        reviews: { schemaVersion: 1, pages: { [contact.key]: [issue] } },
      }),
    );

    expect(flags.map((flag) => [flag.rule, flag.pass])).toEqual([
      ["unlabeled", "read"],
      ["unlabeled", "tab"],
    ]);
    expect(
      model.attention.map((card) => [
        card.kind,
        card.subject,
        card.pages.map((page) => page.path),
        card.times,
      ]),
    ).toEqual([
      ["graphic-generic", "i 2i Logo", ["/"], 2],
      ["recorded", "unlabeled graphic", ["/team/"], 2],
      ["issue", null, ["/contact/"], 1],
    ]);
    expect(model.attention[0]?.places[0]).toMatchObject({
      part: "header",
      inside: { words: "INSTITUTE 2 INNOVATE", role: "link" },
    });
    expect(model.attention[1]?.places[0]?.said).toEqual([]);
    expect(model.attention[2]?.pages[0]?.detail).toBe("Logo has no name");
  });
});
