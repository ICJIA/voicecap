/**
 * The words of the website's WCAG-EM page, `wcag-em.html` (./wcag-em.ts): how the pages of a large
 * site's report are chosen, for a manager or an auditor who asks "what's WCAG-EM?", in plain words
 * and in pictures the page draws from them. What it says of WCAG-EM is the W3C's: the steps and
 * their numbers, the random sample's size and its example, and when a whole product is evaluated
 * instead, from WCAG-EM 2 (W3C Group Note, 23 July 2026, https://www.w3.org/TR/WCAG-EM/). What it
 * says of voicecap is what voicecap does. Plain words: the page escapes them.
 */
import { SITE_TEXT, type Sentence } from "./text.js";

/** The W3C's pages the page links to. */
export const WCAG_EM_LINKS = {
  overview: "https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/",
  note: "https://www.w3.org/TR/WCAG-EM/",
  wcag21: "https://www.w3.org/TR/WCAG21/",
  reportTool: "https://www.w3.org/WAI/eval/report-tool/",
  wai: "https://www.w3.org/WAI/",
  titleII: "https://www.ada.gov/resources/2024-03-08-web-rule/",
};

/** One step of WCAG-EM: its number, its name, what it means in plain words, its parts, and voicecap's. */
export interface EmStep {
  name: string;
  plain: string;
  parts: readonly string[];
  here: string;
}

/** A question a reader asks, and its answer. */
export interface Question {
  q: string;
  a: Sentence;
}

export const WCAG_EM_TEXT = {
  title: `${SITE_TEXT.wcagEm} · ${SITE_TEXT.title}`,
  kicker: "the method behind a sample",
  heading: "How the pages are chosen: WCAG-EM",
  lead: [
    "When a site is too large for a screen reader to read every page, its report tests a sample of the pages, chosen by ",
    { link: "WCAG-EM", href: WCAG_EM_LINKS.overview },
    ", the method the W3C publishes for checking a whole website's accessibility. This page shows what that method is, how a sample is chosen, why it can stand for the rest of a site, and what it can't promise.",
  ] satisfies Sentence,
  onThisPage: SITE_TEXT.onThisPage,

  /** The four big numbers under the heading. */
  numbers: [
    { n: "5", k: "steps, from deciding what's tested to the report" },
    { n: "3", k: "parts of every sample: chosen pages, random pages, and complete tasks" },
    { n: "10%", k: "more pages picked at random, on top of the chosen ones" },
    { n: "2026", k: "WCAG-EM 2, the current version, published 23 July 2026" },
  ],

  parts: {
    what: {
      id: "what",
      kicker: "in one minute",
      heading: "What WCAG-EM is",
      paragraphs: [
        [
          "The ",
          { link: "World Wide Web Consortium (W3C)", href: WCAG_EM_LINKS.wai },
          " is the international body that writes the web's standards, accessibility among them. Two of its documents work together:",
        ],
      ] satisfies Sentence[],
      pair: [
        {
          tag: "the what",
          name: "WCAG",
          long: "Web Content Accessibility Guidelines",
          words:
            "The standard a website has to meet: at version 2.1, Level AA, 50 success criteria, such as every image having a text alternative and every control working from the keyboard. It's the standard the U.S. Department of Justice's 2024 ADA Title II rule sets for state and local government websites.",
          href: WCAG_EM_LINKS.wcag21,
          link: "WCAG 2.1",
        },
        {
          tag: "the how",
          name: "WCAG-EM",
          long: "WCAG Evaluation Methodology",
          words:
            "How to check a whole website against WCAG: what to decide first, how to explore the site, which pages to test, how to test them, and how to report it. It's a W3C Group Note from the Accessibility Guidelines Working Group, first published in 2014; the current version, WCAG-EM 2, came out on 23 July 2026, and speaks of any digital product, an app as well as a website.",
          href: WCAG_EM_LINKS.note,
          link: "WCAG-EM 2",
        },
      ],
      after:
        "WCAG says what a site must do; WCAG-EM says how to find out whether it does. Neither is a tool: WCAG-EM is the procedure a person follows, whatever tools they use.",
    },
    steps: {
      id: "steps",
      kicker: "the procedure",
      heading: "WCAG-EM's five steps",
      lead: "Each step, in WCAG-EM 2's own words and numbers, what it means, and how a voicecap report does it.",
      hereLabel: "In a voicecap report",
      list: [
        {
          name: "Define the evaluation scope",
          plain:
            "Decide what's being tested, against which standard, and with which browsers and screen readers.",
          parts: [
            "1.1 Define the scope of the digital product",
            "1.2 Define the conformance target",
            "1.3 Define an accessibility support baseline",
            "1.4 Define additional evaluation requirements (optional)",
          ],
          here: "The site's address and its sitemap; WCAG 2.1 AA; NVDA with Chrome on Windows, recorded in the report with every version.",
        },
        {
          name: "Explore the target digital product",
          plain:
            "Find out what the site is made of before choosing anything: its common pages, what people do on it, its kinds of page, and its technologies.",
          parts: [
            "2.1 Identify common views of the digital product",
            "2.2 Identify essential functionality of the digital product",
            "2.3 Identify the variety of sample types",
            "2.4 Identify technologies relied upon",
            "2.5 Identify other relevant samples",
          ],
          here: "The sitemap's pages grouped by address pattern (voicecap list-urls --sample), and the site's content counted kind by kind.",
        },
        {
          name: "Select a representative sample set",
          plain:
            "Choose pages that stand for the whole site, add pages picked at random, and include every page of each complete task.",
          parts: [
            "3.1 Include a structured sample set",
            "3.2 Include a randomly selected sample set",
            "3.3 Include complete processes",
          ],
          here: "A page list with the reason each page is in; voicecap --sample-of records how many pages of each kind the site has and how many are read.",
        },
        {
          name: "Evaluate the selected sample set",
          plain:
            "Test every chosen page, test each task from start to end, then compare what the random pages found with what the chosen pages found.",
          parts: [
            "4.1 Check all initial samples",
            "4.2 Check all complete processes",
            "4.3 Compare structured and random sample sets",
          ],
          here: "NVDA reads each page line by line, heading by heading, and control by control, and fills its forms; a person reads every transcript.",
        },
        {
          name: "Report the evaluation findings",
          plain:
            "Write down what was done at each step and what was found, so that someone else can check it.",
          parts: [
            "5.1 Document the outcomes of each step",
            "5.2 Record the evaluation specifics (optional)",
            "5.3 Provide an evaluation statement (optional)",
            "5.4 Provide an aggregated score (optional)",
            "5.5 Provide machine-readable reports (optional)",
          ],
          here: "The report: why it covers the pages it does, each kind of page with how many the site has and how many were read, and on each page's card why it's in.",
        },
      ] satisfies EmStep[],
    },
    sample: {
      id: "sample",
      kicker: "step 3, close up",
      heading: "What goes into a sample",
      lead: "A sample isn't a handful of pages picked by feel. Step 2 lists what the site holds; Step 3 turns that into three parts.",
      sources: {
        label: "From Step 2, every one of these is in",
        items: [
          {
            name: "Common views",
            words:
              "Pages people reach from everywhere: the home page, contact, the accessibility statement, privacy, the page a broken link lands on.",
          },
          {
            name: "Essential functionality",
            words: "What the site is for: search, forms, the listings people use to find things.",
          },
          {
            name: "Each kind of page",
            words:
              "One template's pages, such as news posts or publications, and within each kind the pages that differ most: the longest, the shortest, the newest, the oldest, one with a table, one with a video.",
          },
          {
            name: "Technologies",
            words:
              "Pages that rely on something different: an embedded map, a dashboard, a video player, a PDF.",
          },
        ],
      },
      three: {
        label: "Step 3: the three parts",
        items: [
          {
            name: "Structured sample",
            words: "The pages chosen above, with the reason each is in.",
          },
          {
            name: "Random sample",
            words:
              "More pages picked at random from the rest: 10% of the structured sample's size.",
          },
          {
            name: "Complete processes",
            words:
              "Every page of a task that takes more than one, such as a form across several screens, start to end.",
          },
        ],
      },
      bar: {
        heading: "How big is the random part?",
        caption:
          "WCAG-EM 2's own example: a structured sample of 80 pages takes 8 more at random, 10% of 80, for 88 pages in all.",
        structured: "80 structured",
        random: "8 random",
        total: "88 pages",
      },
      why: "The random pages are a check on the choice. A person chooses the structured pages, and a person can miss something; pages nobody chose, read the same way, show whether they did.",
    },
    template: {
      id: "template",
      kicker: "why a sample works",
      heading: "One template, hundreds of pages",
      lead: "A large site is mostly a few kinds of page, and every page of a kind is built from the same template: the same layout, headings, menus, links, and forms, filled with different words.",
      figure: {
        template: "1 template",
        templateWords: "a news post's layout",
        arrow: "builds every page of its kind",
        pages: "every news post",
        caption:
          "A problem in the template, such as a missing heading, an unlabeled button, or a menu the keyboard can't reach, is on every page built from it. NVDA finds it on any one of them, and fixing the template fixes it on all of them at once.",
      },
      inspector:
        "It's how a building inspector works on a block of identical apartments: a fault in the floor plan is found by inspecting a few units, not by opening all 200 doors. The units that do differ, the corner ones and the ones with a ramp, are the ones that get inspected too.",
    },
    compare: {
      id: "compare",
      kicker: "step 4.3",
      heading: "The check on the sample: structured against random",
      lead: "After both parts are tested, WCAG-EM compares them. The random pages decide whether the sample was good enough.",
      start: "Test the structured sample and the random sample",
      question: "Do the random pages show problems the structured pages didn't?",
      no: {
        answer: "No",
        words:
          "The structured sample stood for the site. The findings hold for the kinds of page it covers.",
      },
      yes: {
        answer: "Yes",
        words:
          "The choice missed something. Add pages like the ones that showed it, and test those too.",
      },
    },
    limits: {
      id: "limits",
      kicker: "honest about it",
      heading: "What a sample finds, and what it can't promise",
      finds: {
        heading: "A sample finds",
        items: [
          "Problems in a template: headings, landmarks, menus, the order the keyboard moves through a page",
          "Problems in shared parts: the header, the footer, search, the cookie banner",
          "Problems in a kind of content: how tables, embedded videos, or maps are built",
          "Problems in a task: a form that can't be filled or sent with a keyboard or a screen reader",
        ],
      },
      cannot: {
        heading: "A sample can't promise",
        items: [
          "A mistake written into one page's own words, such as a link that only says “click here”",
          "A picture with no description, added to one post by its author",
          "A heading level skipped inside one article's text",
          "A document attached to one page",
        ],
      },
      cover:
        "So the text of every page needs a check of its own. For a site with a content management system, that's done from its content, all of it, and every page found with one of these mistakes is fixed and read again with NVDA.",
    },
    voicecap: {
      id: "reports",
      kicker: "on this website",
      heading: "The reports here that are samples",
      lead: "Each of these reports covers a sample of its site. Its report says why, kind of page by kind of page, and each page's card says why that page is in.",
      none: "None of the reports on this website is a sample of its site yet: each covers every page its site lists.",
      line: (pages: string, sitePages: string): string =>
        `${pages} read, of the ${sitePages} its sitemap lists`,
      open: "See how its pages were chosen",
      meter: (pages: number, sitePages: number): string => `${pages} of ${sitePages}`,
    },
    questions: {
      id: "questions",
      kicker: "asked and answered",
      heading: "Questions people ask",
      list: [
        {
          q: "Does a sample mean only those pages have to meet the standard?",
          a: [
            "No. Every page has to meet it. The sample is how problems are found; the fixes go into the templates and the content, so they reach every page, including the ones the sample didn't hold.",
          ],
        },
        {
          q: "Wouldn't it be better to test every page?",
          a: [
            "When it's feasible, yes: WCAG-EM recommends evaluating the whole product if that's possible, and on a site of a few pages voicecap reads them all. On a site of thousands of pages it isn't: at a few minutes a page, 2,000 pages are over 100 hours of a screen reader reading, before a person reviews any of it, and most of those hours would repeat the same template.",
          ],
        },
        {
          q: "Do professional accessibility auditors work this way?",
          a: [
            "Yes. Auditors who test with a screen reader test a sample chosen by kind of page and by task, as WCAG-EM describes, and say so in their report. Going through every page of a site this size isn't how an audit is done.",
          ],
        },
        {
          q: "Does the ADA Title II rule require WCAG-EM?",
          a: [
            "The ",
            { link: "Department of Justice's rule", href: WCAG_EM_LINKS.titleII },
            " sets the standard, WCAG 2.1 AA. It doesn't name a method for testing a site; WCAG-EM is the W3C's published method for that testing, which is why these reports follow it.",
          ],
        },
        {
          q: "Who chooses the pages, and can the choice be checked?",
          a: [
            "The person running the review chooses them, step by step as above, and writes down why each page is in. The random part is drawn with a fixed seed, so the same draw can be made again. The report shows the reason on every page's card.",
          ],
        },
        {
          q: "What happens to a problem found on one page of a kind?",
          a: [
            "It's fixed in that kind's template, once, and the fixed pages are read again with NVDA. A problem in one page's own words is fixed in that page's content.",
          ],
        },
      ] satisfies Question[],
    },
    more: {
      id: "more",
      kicker: "go to the source",
      heading: "Read more from the W3C",
      cards: [
        {
          label: "overview",
          title: "WCAG-EM Overview",
          line: "The W3C's short introduction to the method, for anyone.",
          href: WCAG_EM_LINKS.overview,
        },
        {
          label: "the method",
          title: "WCAG-EM 2",
          line: "The full method: every step, and what each asks for.",
          href: WCAG_EM_LINKS.note,
        },
        {
          label: "the standard",
          title: "WCAG 2.1",
          line: "The standard itself, with every success criterion.",
          href: WCAG_EM_LINKS.wcag21,
        },
        {
          label: "a tool",
          title: "WCAG-EM Report Tool",
          line: "The W3C's tool that walks an evaluator through the five steps.",
          href: WCAG_EM_LINKS.reportTool,
        },
      ],
    },
  },
};
