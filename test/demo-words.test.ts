import { describe, expect, it } from "vitest";

import {
  auditIntro,
  cannotAuditYet,
  CHECKING_INTRO,
  couldNotOpen,
  demoCommand,
  demoFlagCheck,
  failedInReport,
  failedInTranscripts,
  flagsSummary,
  homeExcerpt,
  ownSite,
  pauseBefore,
  reportIntro,
  stepHeading,
  STOPPED_RUN_NEXT,
  stoppingAudit,
  TOUR_COMMAND,
  transcriptsIntro,
  welcome,
  WHERE_THE_TOUR_RUNS,
} from "../src/demo/words.js";
import type { FlagResult, PageRecord } from "../src/model.js";
import { renderChecks } from "../src/readiness/render.js";

const ORIGIN = "http://127.0.0.1:4848";

/** A page of a finished run, as run.json records it. */
function page(pagePath: string, overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    url: `${ORIGIN}${pagePath}`,
    key: `${ORIGIN}${pagePath}`,
    slug: pagePath === "/" ? "home" : pagePath.replaceAll("/", ""),
    status: "done",
    attempts: 1,
    passes: {},
    files: {},
    flags: [],
    errors: [],
    ...overrides,
  };
}

function flag(rule: string, pass: FlagResult["pass"]): FlagResult {
  return { rule, pass, message: `${rule} in the ${pass} pass.` };
}

/** The demo's seven pages as a run on Windows flags them: /common-mistakes/ only, three rules. */
function demoPages(): PageRecord[] {
  return [
    page("/"),
    page("/before-you-start/"),
    page("/how-a-run-works/"),
    page("/reading-transcripts/"),
    page("/the-report/"),
    page("/ask-a-question/"),
    page("/common-mistakes/", {
      flags: [
        flag("generic-link-text", "read"),
        flag("generic-link-text", "tab"),
        flag("unlabeled", "read"),
        flag("unlabeled", "tab"),
        flag("headings", "headings"),
      ],
    }),
  ];
}

describe("the tour's words, as the spec's example on a ready Windows PC has them", () => {
  it("welcomes, with the screen reader and the timings", () => {
    expect(welcome({ screenReader: "NVDA", canAudit: true, os: "win32" })).toBe(
      [
        "voicecap drives a real screen reader through a website's pages and saves what it says, so you",
        "can hear what a screen reader user hears. This tour runs it against a small demo site on this",
        "computer, using NVDA. It takes about 9 minutes. In step 4, NVDA speaks and takes over the",
        "keyboard for about 7 minutes.",
      ].join("\n"),
    );
  });

  it("names the steps, and asks at each pause", () => {
    expect(stepHeading(1)).toBe("Step 1 of 7 · Welcome");
    expect(stepHeading(2)).toBe("Step 2 of 7 · Checking this computer");
    expect(stepHeading(7)).toBe("Step 7 of 7 · Your own site");
    expect(pauseBefore(2, true)).toBe(
      "Press Enter for step 2 (checking this computer), or Ctrl+C to stop here",
    );
    expect(pauseBefore(3, true)).toBe(
      "Press Enter for step 3 (the 20-second live test), or Ctrl+C to stop here",
    );
    expect(pauseBefore(4, true)).toBe(
      "Press Enter for step 4 (auditing the demo site, hands off for about 7 minutes), or Ctrl+C to stop here",
    );
    expect(pauseBefore(5, true)).toBe(
      "Press Enter for step 5 (the transcripts), or Ctrl+C to stop here",
    );
    expect(pauseBefore(6, true)).toBe(
      "Press Enter for step 6 (the report), or Ctrl+C to stop here",
    );
    expect(pauseBefore(7, true)).toBe(
      "Press Enter for step 7 (your own site), or Ctrl+C to stop here",
    );
  });

  it("says what step 2 checks, and the command that does it on its own", () => {
    expect(CHECKING_INTRO).toBe(
      [
        "Before voicecap touches a screen reader, it checks this computer can run one. On its own,",
        "that's: npx @icjia/voicecap preflight",
      ].join("\n"),
    );
  });

  it("shows step 4's command whole, and when it works on its own", () => {
    expect(demoCommand(ORIGIN)).toBe(
      "npx @icjia/voicecap --site http://127.0.0.1:4848 --sitemap sitemap.xml --out voicecap-demo --fresh",
    );
    expect(auditIntro(ORIGIN, "NVDA")).toBe(
      [
        "The demo site is running at http://127.0.0.1:4848. voicecap is now running:",
        "  npx @icjia/voicecap --site http://127.0.0.1:4848 --sitemap sitemap.xml --out voicecap-demo --fresh",
        "On its own, that command works only while the demo site is running.",
        "The tour uses voicecap's own settings, not a voicecap.config file in this folder.",
        "For about 7 minutes, NVDA speaks and takes over the keyboard: keep your hands off. To stop",
        "early, click this terminal window first, then press Ctrl+C.",
      ].join("\n"),
    );
  });

  it("says at once that the audit is stopping, since its shutdown takes a while", () => {
    expect(stoppingAudit("NVDA")).toBe(
      "Stopping: shutting down NVDA and the browser. This can take a minute.",
    );
  });

  it("says what to do after the audit stopped on failed pages in a row", () => {
    expect(TOUR_COMMAND).toBe("npx @icjia/voicecap demo");
    expect(STOPPED_RUN_NEXT).toBe(
      "Run npx @icjia/voicecap doctor to check this computer, then npx @icjia/voicecap demo again.",
    );
  });

  it("says where the transcripts are, and quotes the home page's", () => {
    expect(transcriptsIntro("voicecap-demo/127.0.0.1_4848/2026-09-29/1405", "NVDA")).toBe(
      [
        "Saved in voicecap-demo/127.0.0.1_4848/2026-09-29/1405/pages/, one folder per page, each with",
        "read.txt, headings.txt, and tab.txt: what NVDA said in each pass.",
      ].join("\n"),
    );
    const lines = [
      "[to bottom] content info landmark, This demo site comes with voicecap, for trying it out.",
      "[to top] same page, link, Skip to main content",
      "banner landmark, voicecap demo",
      "Tour, navigation landmark, list, with 1 item, link, Next: Before you start",
      "main landmark, heading, level 1, Welcome to the voicecap demo",
    ];
    expect(homeExcerpt("NVDA", lines)).toBe(
      [
        "What NVDA said on the home page (read.txt, the first 5 lines after its header):",
        ...lines.map((line) => `  ${line}`),
        "The lines marked [to bottom] and [to top] are voicecap finding the page's last and first lines.",
        "Then it reads down, a line at a time.",
      ].join("\n"),
    );
  });

  it("says what the report shows, and where the flags are", () => {
    expect(reportIntro("voicecap-demo/127.0.0.1_4848/report.html")).toBe(
      [
        "voicecap-demo/127.0.0.1_4848/report.html shows every page, what each pass captured, and flags",
        "that point to pages worth a closer listen.",
      ].join("\n"),
    );
    expect(flagsSummary(demoPages())).toBe(
      "Flags: 3 on /common-mistakes/ (generic-link-text, unlabeled, headings), none on the other pages.",
    );
  });

  it("gives the report's whole path, on one line, when it can't open it", () => {
    const report = "C:\\Users\\Pat Reviewer\\voicecap-demo\\127.0.0.1_4848\\report.html";
    expect(couldNotOpen(report)).toBe(`Couldn't open it. Open ${report} in your browser.`);
  });

  it("ends with the reader's own site, a tip, and the demo's files", () => {
    expect(ownSite({ screenReader: "NVDA", canAudit: true, os: "win32" })).toBe(
      [
        "To set up a run on your own site: npx @icjia/voicecap init",
        "Tips: turn on Do Not Disturb, so notifications don't interrupt NVDA. To stop a run, click the",
        "terminal window first (the browser is in front), then press Ctrl+C.",
        "The demo's files are in voicecap-demo/. They're safe to delete.",
      ].join("\n"),
    );
  });
});

describe("the tour's words where it can't audit yet (a Mac)", () => {
  it("says up front that a Windows PC runs the full tour", () => {
    expect(welcome({ screenReader: "VoiceOver", canAudit: false, os: "darwin" })).toBe(
      [
        "voicecap drives a real screen reader through a website's pages and saves what it says, so you",
        "can hear what a screen reader user hears. This tour runs it against a small demo site on this",
        "computer.",
        "",
        "For now, a Windows PC runs the full tour. On this Mac, the tour checks the Mac and runs the",
        "VoiceOver live test (steps 1–3). The audit, the transcripts, and the report (steps 4–6) come",
        "with voicecap's VoiceOver driver, in a later release.",
      ].join("\n"),
    );
  });

  it("adds its WARN line to the checks", () => {
    const check = demoFlagCheck("darwin");
    expect(check.status).toBe("WARN");
    expect(renderChecks([check])).toBe(
      "Checks\n  WARN  The full demo runs on a Windows PC for now: on this Mac, the tour stops after the live test",
    );
  });

  it("asks before step 4 with no hands-off warning, and explains step 4 with its command whole", () => {
    expect(pauseBefore(4, false)).toBe(
      "Press Enter for step 4 (auditing the demo site), or Ctrl+C to stop here",
    );
    expect(cannotAuditYet("VoiceOver")).toBe(
      [
        "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.",
        "On a Windows PC, npx @icjia/voicecap demo runs this step and the next two: NVDA reads the seven",
        "demo pages, voicecap saves the transcripts, and builds the report.",
      ].join("\n"),
    );
  });

  it("ends with the Mac's next steps", () => {
    expect(ownSite({ screenReader: "VoiceOver", canAudit: false, os: "darwin" })).toBe(
      [
        "To keep this Mac ready for VoiceOver: npx @icjia/voicecap setup",
        "To check it again: npx @icjia/voicecap doctor",
        "To set up a run on your own site: npx @icjia/voicecap init",
        "On this Mac, init composes the command for you to run on a Windows PC.",
      ].join("\n"),
    );
  });
});

describe("the tour's words on Linux", () => {
  it("welcomes with no screen reader named, and no Windows note", () => {
    expect(welcome({ screenReader: null, canAudit: false, os: "linux" })).toBe(
      [
        "voicecap drives a real screen reader through a website's pages and saves what it says, so you",
        "can hear what a screen reader user hears. This tour runs it against a small demo site on this",
        "computer.",
      ].join("\n"),
    );
  });

  it("ends step 2 with where the tour runs, on one line, since this computer can't become ready", () => {
    expect(WHERE_THE_TOUR_RUNS).toBe(
      "The tour runs on a Windows PC, or on a Mac for the checks: run npx @icjia/voicecap demo there.",
    );
    expect(WHERE_THE_TOUR_RUNS.length).toBeLessThanOrEqual(96);
  });
});

describe("the tour's words about a run's results", () => {
  it("says when there's no read.txt to quote, and leaves out the markers' note without markers", () => {
    expect(homeExcerpt("NVDA", null)).toBe("There's no read.txt for the home page to show here.");
    expect(homeExcerpt("NVDA", [])).toBe("There's no read.txt for the home page to show here.");
    expect(homeExcerpt("NVDA", ["banner landmark, voicecap demo"])).toBe(
      "What NVDA said on the home page (read.txt, the first line after its header):\n  banner landmark, voicecap demo",
    );
  });

  it("counts the other pages that finished, never a failed one, as having no flags", () => {
    const pages = demoPages();
    pages[1] = page("/before-you-start/", { status: "failed", errors: ["NVDA stopped"] });
    expect(flagsSummary(pages)).toBe(
      "Flags: 3 on /common-mistakes/ (generic-link-text, unlabeled, headings), none on the other pages.",
    );
    expect(flagsSummary([page("/"), pages[6]!])).toBe(
      "Flags: 3 on /common-mistakes/ (generic-link-text, unlabeled, headings), none on the other page.",
    );
    expect(flagsSummary([pages[6]!])).toBe(
      "Flags: 3 on /common-mistakes/ (generic-link-text, unlabeled, headings).",
    );
    expect(flagsSummary([page("/"), page("/the-report/")])).toBe("Flags: none.");
  });

  it("lists every flagged page", () => {
    const pages = [
      page("/", { flags: [flag("headings", "headings")] }),
      page("/the-report/"),
      page("/common-mistakes/", { flags: [flag("unlabeled", "tab")] }),
    ];
    expect(flagsSummary(pages)).toBe(
      "Flags: 1 on / (headings), 1 on /common-mistakes/ (unlabeled), none on the other page.",
    );
  });

  it("points out the pages that failed, in steps 5 and 6", () => {
    const one = [page("/"), page("/the-report/", { status: "failed" })];
    expect(failedInTranscripts(one)).toBe(
      "1 page failed, so its folder may be missing transcripts: /the-report/.",
    );
    expect(failedInReport(one)).toBe("The report shows why 1 page failed: /the-report/.");
    const two = [page("/", { status: "failed" }), page("/the-report/", { status: "failed" })];
    expect(failedInTranscripts(two)).toBe(
      "2 pages failed, so their folders may be missing transcripts: /, /the-report/.",
    );
    expect(failedInReport(two)).toBe("The report shows why 2 pages failed: /, /the-report/.");
    expect(failedInTranscripts(demoPages())).toBeNull();
    expect(failedInReport(demoPages())).toBeNull();
  });
});
