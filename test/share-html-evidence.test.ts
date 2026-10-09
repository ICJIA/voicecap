/**
 * The shareable page's "What these results cover", "The evidence behind these results", "How voicecap
 * came to be", and its footer. The demo runs of 29 September 2026 (voicecap 0.4.1, in
 * test/fixtures/share/) are the real case: two runs from before voicecap recorded most of the
 * evidence, with 21 transcripts for the page to check. Runs built in memory, with their transcripts
 * held in memory too, cover what the demo has none of: a transcript that can't be read, a run that
 * ran over days, and text that must be escaped. The tests are on the markup: it is the mockup's, so
 * its classes and its order are the contract.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { gestureOf } from "../src/drivers/guidepup/nvda-log.js";
import type { PassName, RunEvent, RunJson } from "../src/model.js";
import { esc, plural } from "../src/report/html.js";
import { CHECK_SCRIPT, checkDataJson, type CheckData } from "../src/share/check.js";
import { longDate, sizeWords } from "../src/share/format.js";
import {
  renderCoverage,
  renderEvidence,
  renderFooter,
  renderStory,
} from "../src/share/html/evidence.js";
import { renderSharePage } from "../src/share/html/document.js";
import { loadShareInput, type ShareInput, type TranscriptStore } from "../src/share/load.js";
import {
  buildShareModel,
  type NvdaLogChecked,
  type RunEvidence,
  type ShareModel,
} from "../src/share/model.js";
import { ABOUT, STORY, TIMELINE, WORTH_KNOWING } from "../src/share/text.js";
import type { SessionTimeline } from "../src/share/timeline.js";
import { walkthroughJson, walkthroughOf } from "../src/share/walkthrough.js";
import { inRun } from "../src/share/words.js";
import { TINY_RECORD } from "./helpers/jpeg.js";
import { FIRST_COPY, keptLogsRun, nvdaFixtureSite } from "./helpers/nvda-log.js";
import { shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { demoRun } from "./helpers/share-fixture.js";
import {
  attributes,
  decode,
  foldsIn,
  listsOf,
  rowsOf,
  scrollBoxes,
  summariesIn,
  tableOf,
  termsOf,
  textOf,
} from "./helpers/share-html.js";
import {
  DEMO_ROOT,
  demoModel,
  downloadOf,
  inputOf,
  LINES,
  LOG_HASH,
  loggedModel,
  loggedRun,
  resumedLoggedRun,
  storeOf,
  TRANSCRIPTS,
  withOwnFiles,
  withStepLimit,
} from "./helpers/share-model.js";

const GITHUB = "https://github.com/ICJIA/voicecap";

/** What the demo runs, from voicecap 0.4.1, say of what they didn't record. */
const NOT_RECORDED = "Not recorded: this run used voicecap 0.4.1.";

/** A model with no run that counts: the only run was a replay. */
function noRunModel(): ShareModel {
  return buildShareModel(
    inputOf([shareRun({ id: "2026-09-26_1405", replayed: true, pages: [{ path: "/" }] })]),
  );
}

/** One run of the pages given, with every transcript they list readable. */
function modelOf(pages: SharePageSpec[], overrides: Partial<ShareInput> = {}): ShareModel {
  return buildShareModel(
    inputOf([shareRun({ id: "r1", pages })], { transcripts: storeOf(), ...overrides }),
  );
}

/** Transcripts with the ones `gone` says can't be read left out. */
function storeWithout(gone: (slug: string, pass: PassName) => boolean): TranscriptStore {
  const all = storeOf();
  return {
    txt: (run, slug, pass) => (gone(slug, pass) ? null : all.txt(run, slug, pass)),
    steps: (run, slug, pass) => all.steps(run, slug, pass),
  };
}

/** Transcripts of a page that can't be read, by its path and the pass. */
type Unreadable = [path: string, pass: PassName][];

/** The three transcripts of Home and About that the tests say can't be read. */
const THREE_UNREADABLE: Unreadable = [
  ["/", "read"],
  ["/", "tab"],
  ["/about/", "headings"],
];

/** A run of two pages, Home and About, whose transcripts `gone` names can't be read. */
function unreadableModel(gone: Unreadable): ShareModel {
  const run = shareRun({
    id: "r1",
    pages: [
      { path: "/", label: "Home", files: TRANSCRIPTS, passes: LINES },
      { path: "/about/", label: "About", files: TRANSCRIPTS, passes: LINES },
    ],
  });
  const slugOf = (path: string) =>
    run.pages.find((page) => new URL(page.url).pathname === path)?.slug ?? "";
  const keys = new Set(gone.map(([path, pass]) => `${slugOf(path)}|${pass}`));
  return buildShareModel(
    inputOf([run], { transcripts: storeWithout((slug, pass) => keys.has(`${slug}|${pass}`)) }),
  );
}

/** The model with `count` runs in its evidence: its first run's under ids of their own. */
function withRuns(model: ShareModel, count: number): ShareModel {
  const [first] = model.evidence;
  if (first === undefined) throw new Error("The model has no run.");
  return {
    ...model,
    evidence: Array.from({ length: count }, (_, index) => ({
      ...first,
      run: { ...first.run, id: `r${index + 1}` },
    })),
  };
}

/** The data block of the check, parsed back. */
function dataOf(html: string): CheckData {
  const found = /<script type="application\/json" id="fp-data">(.*?)<\/script>/s.exec(html);
  if (found === null) throw new Error("No data block");
  return JSON.parse(found[1] ?? "") as CheckData;
}

/** The markup without the check's data, which holds the records and transcripts as recorded. */
function withoutData(html: string): string {
  return html.replace(/<script type="application\/json" id="fp-data">.*?<\/script>/s, "");
}

/** Each run's fold, from its opening tag to its closing one. */
function runFolds(html: string): string[] {
  return foldsIn(html)
    .filter((fold) => fold.includes(' id="run-'))
    .map((fold) => fold.split("</details>")[0] ?? "");
}

/** A part of a run's fold: from its heading to the next. */
function partOf(fold: string, title: string): string {
  const found = fold.split("<h3>").find((part) => part.startsWith(title));
  if (found === undefined) throw new Error(`No part called ${title}`);
  return found;
}

/**
 * A run's walkthrough part, whole: from its box's opening tag to its closing tag. It is the last
 * part of the fold, so the fold's own closing tag, which a run's fold ends with, is left off.
 */
function walkthroughPartOf(fold: string): string {
  const start = fold.indexOf("<div><h3>Walkthrough file ");
  if (start === -1) throw new Error("The fold has no walkthrough part.");
  return fold.slice(start, fold.lastIndexOf("</div>"));
}

/** A model of one run whose read pass's step limit is over what a walkthrough file allows. */
function overTheLimitModel(): ShareModel {
  const run = shareRun({ id: "r1", pages: [{ path: "/" }] });
  return buildShareModel(inputOf([withStepLimit(run, 100_001)]));
}

describe("renderCoverage", () => {
  it("has two panels, Covered and Technical limits, with the model's lines", async () => {
    const model = await demoModel();
    const html = renderCoverage(model);

    expect(html).toMatch(
      /^<section aria-labelledby="lim-h">\s*<h2 id="lim-h">What these results cover<\/h2>/,
    );
    expect(html).toMatch(/<\/section>$/);
    expect([...html.matchAll(/<h3>(.*?)<\/h3>/g)].map((found) => found[1])).toEqual([
      "Covered",
      "Technical limits",
    ]);
    expect(html).toContain('<div class="limits"><div><h3>Covered</h3><ul><li>');
    expect(listsOf(html)).toEqual([model.coverage.covered, model.coverage.limits]);
    // The demo's own: the sitemap, the three passes, and the Chrome that updated between the runs.
    expect(model.coverage.covered[0]).toBe(
      "7 pages from the sitemap http://127.0.0.1:4848/sitemap.xml.",
    );
    expect(listsOf(html)[1]?.at(-1)).toContain("Chrome 153.0.8010.53 → Chrome 154.0.8037.58");
  });

  it("links the line on problems to where they're explained", async () => {
    const html = renderCoverage(await demoModel());

    expect(html).toContain(
      '<li>Every problem during the runs is explained under <a href="#prob-h">Problems during the runs</a>.</li>',
    );
    expect(attributes(html, "href")).toEqual(["#prob-h"]);
  });

  it("links nothing in a line the model words otherwise, even one that names that section", async () => {
    const html = renderCoverage({
      ...(await demoModel()),
      coverage: {
        // A page list that happens to be named for it, and a line that only resembles the model's.
        covered: [
          "1 page from the page list kept under Problems during the runs.",
          "Every problem is explained under Problems during the runs.",
        ],
        limits: ["Problems during the runs"],
      },
    });

    expect(listsOf(html)).toEqual([
      [
        "1 page from the page list kept under Problems during the runs.",
        "Every problem is explained under Problems during the runs.",
      ],
      ["Problems during the runs"],
    ]);
    expect(html).not.toContain("<a ");
  });

  it("says no live run counts yet when none does, without an empty panel", () => {
    const html = renderCoverage(noRunModel());

    expect(html).toContain('<h2 id="lim-h">What these results cover</h2>');
    expect(textOf(html)).toContain("No live run counts yet, so these results cover no pages.");
    expect(html.match(/<h3>/g)).toHaveLength(1);
    expect(html).not.toContain("<ul></ul>");
  });

  it("escapes what the model says, and sets no style attribute", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const html = renderCoverage({
      ...(await demoModel()),
      coverage: { covered: [hostile], limits: ["<b>Chrome</b> & more"] },
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;b&gt;Chrome&lt;/b&gt; &amp; more");
    expect(html).not.toMatch(/\sstyle=/);
  });
});

describe("renderEvidence", () => {
  describe("for the demo runs of 29 September 2026", () => {
    it("opens with how many runs there are, that each completed and was sealed, and the flag rules' fingerprint", async () => {
      const model = await demoModel();
      const html = renderEvidence(model);

      expect(html).toMatch(
        /^<section aria-labelledby="ev-h">\s*<h2 id="ev-h">The evidence behind these results<\/h2>/,
      );
      expect(html).toMatch(/<\/section>$/);
      expect(model.flagRulesSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(html).toContain(
        `<p class="gist"><b>2 runs, both completed and sealed.</b> The flags were computed with the current flag rules, fingerprint <code>${model.flagRulesSha256}</code>.</p>`,
      );
    });

    // The demo's runs read a copy at http://127.0.0.1:4848, on the tester's computer; its canonical
    // address is the demo's, on the website. The line says it read a copy, and never where.
    it("says the runs read a copy, and names no address", async () => {
      const model = await demoModel(DEMO_ROOT);
      const html = renderEvidence(model);
      const at = (text: string) => html.indexOf(text);
      const note =
        '<p class="gist">These runs read a copy of the site on the computer that ran them.</p>';

      expect(model.header.readFrom).toBe("local");
      expect(html).toContain(note);
      // Right under the line that opens the section, before the check.
      expect(at('<p class="gist"><b>2 runs')).toBeGreaterThan(-1);
      expect(at(note)).toBeGreaterThan(at('<p class="gist"><b>2 runs'));
      expect(at(note)).toBeLessThan(at('<div class="fp-check">'));
      expect(textOf(note)).toBe(
        "These runs read a copy of the site on the computer that ran them.",
      );

      // A copy anywhere else is said so too, with no more of an address.
      const elsewhere = renderEvidence({
        ...model,
        header: { ...model.header, readFrom: "elsewhere" },
      });
      expect(elsewhere).toContain(
        '<p class="gist">These runs read a copy of the site at another address.</p>',
      );
      expect(elsewhere).not.toContain("on the computer that ran them");
    });

    it("says nothing of a copy when the runs read the site itself, or no canonical address names it", async () => {
      const model = await demoModel(DEMO_ROOT);
      const same = renderEvidence({ ...model, header: { ...model.header, readFrom: "same" } });

      expect(same).not.toContain("These runs read a copy");
      // The demo with no canonical address is named by the address its runs read: no copy to say.
      expect(renderEvidence(await demoModel())).not.toContain("These runs read a copy");
      // With no run to show, there are no "these runs".
      expect(renderEvidence({ ...model, evidence: [] })).not.toContain("These runs read a copy");
    });

    it("says which pages' flags aren't the current rules', when any are as recorded", async () => {
      const model = await demoModel();
      const marked = {
        ...model,
        pages: model.pages.map((card, index) =>
          index === 1 ? { ...card, flagsAsRecorded: true } : card,
        ),
      };

      expect(renderEvidence(marked)).toContain(
        `The flags were computed with the current flag rules, fingerprint <code>${model.flagRulesSha256}</code>, except on 1 page marked “Flags as recorded”, whose transcripts couldn&#39;t all be read here: its flags are as its run recorded them.</p>`,
      );
    });

    it.each([
      [1, "1 run, completed and sealed."],
      [2, "2 runs, both completed and sealed."],
      [3, "3 runs, all completed and sealed."],
    ])("says it as it reads for %i run(s)", async (count, said) => {
      const html = renderEvidence(withRuns(await demoModel(), count));

      expect(html).toContain(`<b>${said}</b>`);
      expect(runFolds(html)).toHaveLength(count);
    });

    it("explains what a fingerprint is, word for word", async () => {
      const html = renderEvidence(await demoModel());

      expect(html).toContain(
        `<p class="fp-what"><b>What&#39;s a fingerprint?</b> A fingerprint (SHA-256) is a code computed from a file&#39;s exact contents: change one character, and it changes completely. voicecap took one of every file as it wrote it, so a matching fingerprint shows the file hasn&#39;t changed since.</p>`,
      );
    });

    it("says the page carries the sealed records exactly as voicecap wrote them", async () => {
      const html = renderEvidence(await demoModel());

      expect(textOf(withoutData(html))).toContain(
        "This page carries the sealed records exactly as voicecap wrote them, so the check can recompute their seals.",
      );
    });

    it("has a fold for each run, the latest first, each closed", async () => {
      const html = renderEvidence(await demoModel());

      expect(attributes(html, "id").filter((id) => id.startsWith("run-"))).toEqual([
        "run-2026-09-29_1402",
        "run-2026-09-29_1315",
      ]);
      expect(summariesIn(html).slice(1)).toEqual([
        "Run 2026-09-29_1402 29 September 2026, 14:02 to 14:09 completed sealed",
        "Run 2026-09-29_1315 29 September 2026, 13:15 to 13:21 completed sealed",
      ]);
      expect(html).toContain(
        '<summary><span class="what">Run 2026-09-29_1402</span> <span class="sub">29 September 2026, 14:02 to 14:09</span> <span class="chips"><span class="chip c-ok">completed</span> <span class="chip c-ok">sealed</span></span></summary>',
      );
      expect(html).not.toMatch(/<details[^>]* open/);
      // In the box the mockup gives its folds, with the mockup's wider gap inside each.
      expect(html).toContain('<div class="folds"><details class="fold" id="run-2026-09-29_1402">');
      expect(html).toContain('<div class="inside run-inside">');
    });
  });

  describe("the fingerprint check", () => {
    it("renders every element the check's script looks for", async () => {
      const html = renderEvidence(await demoModel());
      const wanted = [...CHECK_SCRIPT.matchAll(/getElementById\("([^"]+)"\)/g)].map(([, id]) => id);

      expect(wanted.sort()).toEqual([
        "fp-count",
        "fp-data",
        "fp-demo",
        "fp-list",
        "fp-result",
        "fp-rows",
        "fp-run",
      ]);
      for (const id of wanted) expect(attributes(html, "id")).toContain(id);
      expect(CHECK_SCRIPT).toContain('querySelectorAll(".fp-noscript")');
      expect(html).toContain("fp-noscript");
      // No id is on the page twice.
      const ids = attributes(html, "id");
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("starts with both buttons hidden, for the script to show", async () => {
      const html = renderEvidence(await demoModel());

      expect(html).toContain(
        '<button type="button" id="fp-run" class="fp-button" hidden>Check the fingerprints</button>',
      );
      expect(html).toContain(
        '<button type="button" id="fp-demo" class="fp-demo" hidden>Show a change being caught</button>',
      );
    });

    it("has a live region for the result, and a hidden fold for the list of every file checked", async () => {
      const html = renderEvidence(await demoModel());

      expect(html).toContain('<p id="fp-result" class="fp-result" role="status"></p>');
      expect(html).toContain(
        '<details class="fold" id="fp-list" hidden><summary><span class="what">Every file checked</span> <span class="sub" id="fp-count"></span></summary>',
      );
      expect(html).toContain('<tbody id="fp-rows"></tbody>');
      const [list = ""] = foldsIn(html).filter((fold) => fold.includes('id="fp-list"'));
      expect(rowsOf(tableOf(list, "plain"))).toEqual(["File | Recorded fingerprint | Result"]);
      expect(scrollBoxes(list)).toEqual([
        '<div class="scroll" tabindex="0" role="region" aria-label="Files checked, table">',
      ]);
    });

    it("says what the check proves beside its result, and names the two stronger checks", async () => {
      const model = await demoModel();
      const html = renderEvidence(model);

      expect(model.evidence[0]?.verify).toBe("npx @icjia/voicecap verify");
      expect(textOf(withoutData(html))).toContain(
        "What the check proves: this page is consistent with itself, so the transcripts shown are exactly the ones the sealed records list. It can't prove the page itself wasn't changed, since whoever changed it could change the fingerprints too.",
      );
      expect(html).toContain("<code>Get-FileHash &lt;file&gt;</code> in PowerShell");
      expect(html).toContain("<code>shasum -a 256 &lt;file&gt;</code> on a Mac");
      expect(html).toContain("<code>npx @icjia/voicecap verify</code> on the transcripts folder");
    });

    it("says where the sender's own fingerprint comes from: voicecap share prints it, for the email that sends the file", async () => {
      const model = await demoModel();
      const verify = model.evidence[0]?.verify;

      expect(verify).toBe("npx @icjia/voicecap verify");
      // The whole paragraph, as the page writes it: what the check proves, then what's stronger.
      expect(renderEvidence(model)).toContain(
        `<p class="sub fp-limit"><b>What the check proves:</b> this page is consistent with itself, so the transcripts shown are exactly the ones the sealed records list. It can&#39;t prove the page itself wasn&#39;t changed, since whoever changed it could change the fingerprints too. For that, compare this file&#39;s own fingerprint with the one its sender recorded: <code>voicecap share</code> prints it, ready for the email that sends the file, and <code>Get-FileHash &lt;file&gt;</code> in PowerShell, or <code>shasum -a 256 &lt;file&gt;</code> on a Mac, shows it for the file you received. Or run <code>${verify}</code> on the transcripts folder.</p>`,
      );
    });

    it("says how to check without scripts, in a line the script hides and nothing else does", async () => {
      const html = renderEvidence(await demoModel());

      expect(html).toContain(
        '<p class="fp-result fp-noscript">To check the fingerprints without scripts, use those two commands.</p>',
      );
      // It shows unless the script gives it the hidden attribute: no attribute or style hides it.
      expect(html).not.toMatch(/<p[^>]*fp-noscript[^>]*(hidden|style)/);
    });

    it("puts the parts of the check in the order a reader goes through them", async () => {
      const html = renderEvidence(await demoModel());
      const order = [
        "What&#39;s a fingerprint?",
        'id="fp-run"',
        'id="fp-result"',
        'id="fp-list"',
        "What the check proves:",
        "fp-noscript",
        'id="fp-data"',
        'id="run-2026-09-29_1402"',
      ].map((part) => html.indexOf(part));

      expect(order.every((at) => at > -1)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it("carries what the check checks, exactly as the model has it", async () => {
      const model = await demoModel();
      const html = renderEvidence(model);

      expect(model.check.files).toHaveLength(21);
      expect(dataOf(html)).toEqual(model.check);
      expect(html).toContain(
        `<script type="application/json" id="fp-data">${checkDataJson(model.check)}</script>`,
      );
    });

    it("keeps a transcript's </script> and <!-- from ending or opening anything in the data block", async () => {
      const model = await demoModel();
      const [first, ...rest] = model.check.files;
      if (first === undefined) throw new Error("The demo has transcripts.");
      const text = `${first.text}\n</script><script>alert(1)</script><!-- <b>bold</b>`;
      const patched = { ...model, check: { ...model.check, files: [{ ...first, text }, ...rest] } };
      const html = renderEvidence(patched);

      // The data block's own end is the page's only one.
      expect(html.match(/<\/script>/g)).toHaveLength(1);
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<!--");
      expect(dataOf(html)).toEqual(patched.check);
    });
  });

  describe("a transcript that couldn't be read", () => {
    it("is named beside the check, so its count never reads as complete", () => {
      const model = unreadableModel(THREE_UNREADABLE);
      const html = renderEvidence(model);

      // Six transcripts are listed, and the check has the three that could be read.
      expect(model.check.files).toHaveLength(3);
      expect(html).toContain(
        "<b>3 transcripts couldn&#39;t be read, so the check leaves them out:</b> Home (read.txt and tab.txt); About (headings.txt).",
      );
      // After the result it sits beside, and before the list that appears with it.
      expect(html.indexOf('id="fp-result"')).toBeLessThan(html.indexOf("transcripts couldn&#39;t"));
      expect(html.indexOf("transcripts couldn&#39;t")).toBeLessThan(html.indexOf('id="fp-list"'));
    });

    it("says it of one transcript in the singular", () => {
      expect(textOf(renderEvidence(unreadableModel([["/about/", "headings"]])))).toContain(
        "1 transcript couldn't be read, so the check leaves it out: About (headings.txt).",
      );
    });

    it("says nothing of the kind when every transcript could be read", async () => {
      const text = textOf(withoutData(renderEvidence(await demoModel())));

      // The check is there, with 21 transcripts for it, and no transcript is missing from it.
      expect(text).toContain("What the check proves");
      expect(text).not.toContain("couldn't be read");
    });
  });

  describe("each run's fold", () => {
    it("holds five parts, in the mockup's order and then the walkthrough file, each named for its run", async () => {
      const html = renderEvidence(await demoModel());

      for (const [index, run] of ["2026-09-29_1402", "2026-09-29_1315"].entries()) {
        const fold = runFolds(html)[index] ?? "";
        expect(
          [...fold.matchAll(/<h3>(.*?)<\/h3>/gs)].map((found) => textOf(found[1] ?? "")),
        ).toEqual([
          `Minute by minute in run ${run}`,
          `NVDA's own log, checked against the transcripts in run ${run}`,
          `Test environment in run ${run}`,
          `Fingerprints (SHA-256) in run ${run}`,
          `Walkthrough file in run ${run}`,
        ]);
      }
    });

    it("lists the run's facts as the model has them", async () => {
      const model = await demoModel();
      const folds = runFolds(renderEvidence(model));

      expect(folds).toHaveLength(model.evidence.length);
      for (const [index, each] of model.evidence.entries()) {
        const fold = folds[index] ?? "";
        expect(termsOf(fold)).toEqual(each.facts.map(({ label, value }) => [label, value]));
        expect(fold).toContain('<dl class="facts"><div><dt>Started</dt>');
      }
      expect(termsOf(folds[0] ?? "")).toContainEqual(["Pages", "6 transcribed and 1 failed"]);
    });

    it("says what the run didn't record under the two parts it has no record for", async () => {
      const folds = runFolds(renderEvidence(await demoModel()));

      expect(folds).toHaveLength(2);
      for (const fold of folds) {
        expect(
          [...fold.matchAll(/<p class="not-recorded">(.*?)<\/p>/g)].map((found) => found[1]),
        ).toEqual([NOT_RECORDED, NOT_RECORDED]);
        expect(fold).toMatch(
          /<h3>Minute by minute <span class="sr">in run [^<]*<\/span><\/h3><p class="not-recorded">Not recorded: this run used voicecap 0\.4\.1\.<\/p>/,
        );
        expect(fold).toMatch(
          /<h3>NVDA&#39;s own log, checked against the transcripts <span class="sr">in run [^<]*<\/span><\/h3><p class="not-recorded">Not recorded: this run used voicecap 0\.4\.1\.<\/p>/,
        );
      }
    });

    it("shows the test environment as a table, a row for each the model has", async () => {
      const model = await demoModel();
      const folds = runFolds(renderEvidence(model));

      for (const [index, each] of model.evidence.entries()) {
        const part = partOf(folds[index] ?? "", "Test environment");
        expect(rowsOf(tableOf(part, "plain"))).toEqual([
          "What | What the run recorded",
          ...each.environment.map(({ label, value }) => `${label} | ${value}`),
        ]);
        expect(part).toContain(
          `<caption class="sr">Test environment of run ${each.run.id}</caption>`,
        );
        // A row's name is its header, and a part this run didn't record says so in its words.
        expect(part).toContain(
          '<tr><th scope="row">Operating system</th><td>Windows 11 Pro 25H2 (10.0.26200)</td></tr>',
        );
        expect(part).toContain(`<tr><th scope="row">Processor</th><td>${NOT_RECORDED}</td></tr>`);
      }
    });

    it("shows every file the run's record lists, with its size and fingerprint, and the command that checks them", async () => {
      const model = await demoModel();
      const folds = runFolds(renderEvidence(model));

      for (const [index, each] of model.evidence.entries()) {
        const part = partOf(folds[index] ?? "", "Fingerprints (SHA-256)");
        expect(each.fingerprints.length).toBeGreaterThan(0);
        expect(rowsOf(tableOf(part, "plain"))).toEqual([
          "Page | File | Size | SHA-256",
          ...each.fingerprints.map(
            ({ page, file, bytes, sha256 }) =>
              `${page} | ${file} | ${plural(bytes, "byte")} | ${sha256}`,
          ),
        ]);
        const [first] = each.fingerprints;
        expect(part).toContain(`<td><code>${first?.sha256}</code></td>`);
        expect(part).toContain(
          `<div class="verify"><span>To check these against the recorded files, anyone with the transcripts folder runs:</span><pre>${each.verify}</pre></div>`,
        );
        expect(part).toContain(`<caption class="sr">Fingerprints of run ${each.run.id}</caption>`);
      }
    });

    it("lists a page's screenshot among the files the run's record lists, after the page's transcripts, with its size and fingerprint", () => {
      const model = modelOf([
        { path: "/", files: ["read.txt"], screenshot: TINY_RECORD },
        { path: "/b", screenshot: { error: "timed out", takenAt: TINY_RECORD.takenAt } },
      ]);
      const [fold = ""] = runFolds(renderEvidence(model));
      const part = partOf(fold, "Fingerprints (SHA-256)");

      // A record of why there's none lists no file.
      expect(rowsOf(tableOf(part, "plain"))).toEqual([
        "Page | File | Size | SHA-256",
        `/ | read.txt | 1 byte | ${"0".repeat(64)}`,
        `/ | screenshot.jpg | ${plural(TINY_RECORD.bytes, "byte")} | ${TINY_RECORD.sha256}`,
      ]);
    });

    it("lists the run's own files first, its event log as the run's, with its size and fingerprint", () => {
      const run = withOwnFiles(
        shareRun({ id: "r1", pages: [{ path: "/", files: ["read.txt"] }] }),
        { "events.jsonl": LOG_HASH },
      );
      const [fold = ""] = runFolds(renderEvidence(buildShareModel(inputOf([run]))));
      const part = partOf(fold, "Fingerprints (SHA-256)");

      expect(rowsOf(tableOf(part, "plain"))).toEqual([
        "Page | File | Size | SHA-256",
        `The run | events.jsonl | ${plural(LOG_HASH.bytes, "byte")} | ${LOG_HASH.sha256}`,
        `/ | read.txt | 1 byte | ${"0".repeat(64)}`,
      ]);
      expect(part).toContain(`<td><code>${LOG_HASH.sha256}</code></td>`);
    });

    it("shows the run's own files, never that its record lists none, when no page lists one", () => {
      const run = withOwnFiles(
        shareRun({
          id: "r1",
          voicecapVersion: "0.11.0",
          pages: [{ path: "/", status: "skipped" }],
        }),
        { "events.jsonl": LOG_HASH },
      );
      const [fold = ""] = runFolds(renderEvidence(buildShareModel(inputOf([run]))));
      const part = partOf(fold, "Fingerprints (SHA-256)");

      expect(rowsOf(tableOf(part, "plain"))).toEqual([
        "Page | File | Size | SHA-256",
        `The run | events.jsonl | ${plural(LOG_HASH.bytes, "byte")} | ${LOG_HASH.sha256}`,
      ]);
      expect(textOf(part)).not.toContain("lists no files");
    });

    it("puts each table in a box that a keyboard can reach and scroll, named for its run", async () => {
      const html = renderEvidence(await demoModel());

      expect(scrollBoxes(html)).toHaveLength(5);
      for (const box of scrollBoxes(html)) expect(box).toContain('tabindex="0" role="region"');
      // No two have the same name, so a screen reader can tell them apart.
      expect(scrollBoxes(html).flatMap((box) => attributes(box, "aria-label"))).toEqual([
        "Files checked, table",
        "Test environment, run 2026-09-29_1402, table",
        "Fingerprints, run 2026-09-29_1402, table",
        "Test environment, run 2026-09-29_1315, table",
        "Fingerprints, run 2026-09-29_1315, table",
      ]);
    });

    it("says so, instead of showing an empty table, when the run's record lists no file", () => {
      const html = renderEvidence(modelOf([{ path: "/" }]));
      const [fold = ""] = runFolds(html);
      const part = partOf(fold, "Fingerprints (SHA-256)");

      expect(textOf(part)).toContain("This run's record lists no files.");
      expect(part).not.toContain("<table");
      expect(part).toContain('<div class="verify">');
    });

    describe("its walkthrough file", () => {
      it("is offered as a download the page carries: the run's file, byte for byte, with the command that repeats the run after it", async () => {
        const model = await demoModel();
        const folds = runFolds(renderEvidence(model));
        const prefix = "data:application/json;base64,";

        expect(folds).toHaveLength(2);
        for (const [index, each] of model.evidence.entries()) {
          const fold = folds[index] ?? "";
          const file = downloadOf(each);
          const links = fold.match(/<a\b[^>]*\bdownload=[^>]*>/g) ?? [];
          const [address = ""] = attributes(links[0] ?? "", "href");
          const record = demoRun(each.run.id.endsWith("1402") ? "1402" : "1315");
          const written = Buffer.from(walkthroughJson(walkthroughOf(record)), "utf8");

          // One download in the run's fold, named for the file, whose address carries it.
          expect(links, each.run.id).toHaveLength(1);
          expect(attributes(links[0] ?? "", "download"), each.run.id).toEqual([file.fileName]);
          expect(address.startsWith(prefix), each.run.id).toBe(true);
          const carried = Buffer.from(address.slice(prefix.length), "base64");
          expect(carried.toString("utf8"), each.run.id).toBe(written.toString("utf8"));
          expect(carried.equals(written), each.run.id).toBe(true);
          // The command that repeats the run follows the download.
          expect(fold.indexOf(file.repeat), each.run.id).toBeGreaterThan(fold.indexOf("</a>"));
        }
      });

      it("is set out in order: the lead, the download with its size, the command in a box, and what a repeat can't promise", async () => {
        const model = await demoModel();
        const folds = runFolds(renderEvidence(model));

        for (const [index, each] of model.evidence.entries()) {
          const file = downloadOf(each);
          // Without the file itself, which is base64.
          const bare = walkthroughPartOf(folds[index] ?? "").replace(
            /(href="data:application\/json;base64,)[A-Za-z0-9+/=]*/,
            "$1…",
          );

          // The demo's files are about 3.6 KB, which the page says in whole KB.
          expect(sizeWords(file.bytes)).toBe("4 KB");
          expect(bare, each.run.id).toBe(
            `<div><h3>Walkthrough file <span class="sr">in run ${each.run.id}</span></h3>` +
              "<p>To repeat this run exactly, with the same pages in the same order and the same passes and limits, download its walkthrough file, then run:</p>" +
              `<p><a download="${file.fileName}" href="data:application/json;base64,…" aria-label="Download the walkthrough file (4 KB) in run ${each.run.id}">Download the walkthrough file (4 KB)</a></p>` +
              `<div class="verify"><pre>${file.repeat}</pre></div>` +
              "<p>A repeat reads the same pages the same way, but can&#39;t promise the same words: a changed site, or a newer screen reader or browser, changes what&#39;s said. After a repeat, voicecap says page by page whether each sounds the same.</p></div>",
          );
        }
      });

      it("names each run's download by its run, so the two links that read alike are told apart", async () => {
        const model = await demoModel();
        const links = runFolds(renderEvidence(model)).map(
          (fold) => /<a\b[^>]*\bdownload=[^>]*>.*?<\/a>/s.exec(fold)?.[0] ?? "",
        );
        const named = links.map((link) => ({
          words: textOf(link),
          name: decode(attributes(link, "aria-label")[0] ?? ""),
        }));

        // The two links say the same words, and are named for the two runs.
        expect(named.map(({ words }) => words)).toEqual([
          "Download the walkthrough file (4 KB)",
          "Download the walkthrough file (4 KB)",
        ]);
        expect(new Set(named.map(({ name }) => name)).size).toBe(2);
        for (const [index, each] of model.evidence.entries()) {
          const { words = "", name = "" } = named[index] ?? {};
          // The words first, then the run, as the page's other named links are (a person who says
          // a link's words to a voice control finds it), and the run as a heading of the part says it.
          expect(name.startsWith(words), each.run.id).toBe(true);
          expect(name, each.run.id).toBe(`${words} ${inRun(each.run.id)}`);
        }
      });

      it("names the file and the command for the site and the run, as the model has them", async () => {
        const model = await demoModel();
        const html = renderEvidence(model);

        expect(attributes(html, "download")).toEqual([
          "127.0.0.1_4848_2026-09-29_1402_walkthrough.json",
          "127.0.0.1_4848_2026-09-29_1315_walkthrough.json",
        ]);
        expect(
          [...html.matchAll(/<pre>(npx @icjia\/voicecap --walkthrough [^<]*)<\/pre>/g)].map(
            (found) => found[1],
          ),
        ).toEqual([
          "npx @icjia/voicecap --walkthrough 127.0.0.1_4848_2026-09-29_1402_walkthrough.json",
          "npx @icjia/voicecap --walkthrough 127.0.0.1_4848_2026-09-29_1315_walkthrough.json",
        ]);
      });

      it("says the download's size in words, as a size is said, with no count of bytes", async () => {
        const model = await demoModel();
        const [first, ...rest] = model.evidence;
        if (first === undefined) throw new Error("The demo has runs.");

        for (const [bytes, size] of [
          [1, "1 KB"],
          [317_440, "310 KB"],
          [1_234_567, "1.2 MB"],
        ] as const) {
          const patched = { ...first, walkthrough: { ...downloadOf(first), bytes } };
          const html = renderEvidence({ ...model, evidence: [patched, ...rest] });

          expect(html).toContain(`>Download the walkthrough file (${size})</a>`);
        }
        expect(renderEvidence(model)).not.toMatch(/Download the walkthrough file \([^)]*bytes?\)/);
      });

      it("says why there is no file, in place of the download and the command, for a run that can't have one", () => {
        const html = renderEvidence(overTheLimitModel());
        const [fold = ""] = runFolds(html);

        // The part is there, so every run has five; it says why it has no file, and nothing else.
        expect(walkthroughPartOf(fold)).toBe(
          '<div><h3>Walkthrough file <span class="sr">in run r1</span></h3>' +
            "<p>This run&#39;s walkthrough file can&#39;t be made: its settings.stepCaps.read: must be a whole number from 1 to 100,000.</p></div>",
        );
        expect(fold.match(/<h3>/g)).toHaveLength(5);
        expect(html).not.toContain("download=");
        expect(html).not.toContain("data:application/json");
        expect(html).not.toContain("--walkthrough");
        expect(textOf(html)).not.toContain("To repeat this run exactly");
      });

      it("offers the file to the run that has one, and says why not for the run that hasn't, side by side", async () => {
        const model = await demoModel();
        const [first, second] = model.evidence;
        if (first === undefined || second === undefined) throw new Error("The demo has two runs.");
        const reason = "its original.run isn't a run id.";
        const html = renderEvidence({
          ...model,
          evidence: [{ ...first, walkthrough: { problem: reason } }, second],
        });
        const [broken = "", fine = ""] = runFolds(html);

        expect(textOf(walkthroughPartOf(broken))).toContain(
          `This run's walkthrough file can't be made: ${reason}`,
        );
        expect(attributes(broken, "download")).toEqual([]);
        expect(attributes(fine, "download")).toEqual([downloadOf(second).fileName]);
      });

      it("escapes what the model supplies of it: the file's name, the commands, the run, and the reason", async () => {
        const model = await demoModel();
        const [first, second, ...rest] = model.evidence;
        if (first === undefined || second === undefined) throw new Error("The demo has two runs.");
        const hostile = '<img src=x onerror="alert(1)">';
        const html = renderEvidence({
          ...model,
          evidence: [
            {
              ...first,
              run: { ...first.run, id: '7" onfocus="alert(1)' },
              walkthrough: {
                ...downloadOf(first),
                fileName: 'x" onclick="alert(1)',
                base64: 'AAAA" onmouseover="alert(1)',
                repeat: hostile,
              },
            },
            { ...second, walkthrough: { problem: hostile } },
            ...rest,
          ],
        });

        expect(html).not.toContain("<img");
        expect(html).toContain(
          '<a download="x&quot; onclick=&quot;alert(1)" href="data:application/json;base64,AAAA&quot; onmouseover=&quot;alert(1)" aria-label="Download the walkthrough file (4 KB) in run 7&quot; onfocus=&quot;alert(1)">',
        );
        // The link has the three attributes it was given, and none made of the hostile words: every
        // quote in its tag is one of those attributes' own.
        const [tag = ""] = html.match(/<a\b[^>]*\bdownload=[^>]*>/g) ?? [];
        expect([...tag.matchAll(/\s([a-z-]+)="/g)].map(([, name]) => name)).toEqual([
          "download",
          "href",
          "aria-label",
        ]);
        expect(html).toContain(`<div class="verify"><pre>${esc(hostile)}</pre></div>`);
        expect(html).toContain(
          `<p>This run&#39;s walkthrough file can&#39;t be made: ${esc(hostile)}</p>`,
        );
      });
    });

    it("takes only the run's id and dates from its record, never its other fields", async () => {
      const model = await demoModel();
      const [first, ...rest] = model.evidence;
      if (first === undefined) throw new Error("The demo has runs.");
      const marked = {
        ...first,
        run: {
          ...first.run,
          id: "2026-09-29_9999",
          name: "MARKER-NAME",
          seal: "MARKER-SEAL",
          site: "http://MARKER-SITE/",
          completedAt: "2026-10-02T08:30:00-05:00",
          settings: {
            ...first.run.settings,
            replayFrom: "MARKER-FROM",
            source: {
              kind: "pages" as const,
              file: "C:/Users/MARKER-HOME/pages.csv",
              sha256: "MARKER",
            },
          },
        },
      };
      const html = renderEvidence({ ...model, evidence: [marked, ...rest] });

      // What the page shows of the record is its id, and the days it ran over.
      expect(attributes(html, "id")).toContain("run-2026-09-29_9999");
      expect(summariesIn(html)[1]).toBe(
        "Run 2026-09-29_9999 29 September 2026, 14:02 to 2 October 2026, 08:30 completed sealed",
      );
      // Nothing else of it: the data block carries the model's own records, which hold none of these.
      expect(html).not.toContain("MARKER");
      // Its walkthrough file is the model's own, named for the run the model says it is.
      expect(attributes(html, "download")[0]).toBe(downloadOf(first).fileName);
      expect(html).not.toContain("_9999_walkthrough.json");
    });
  });

  describe("a run's event log, minute by minute and to the millisecond", () => {
    const RUN = "2026-09-26_1402";

    /** The logged run's fold: everything from its opening tag, its folds of events with it. */
    function loggedFold(model = loggedModel()): string {
      const html = renderEvidence(model);
      return html.slice(html.indexOf('<details class="fold" id="run-'));
    }

    /** The logged run's timelines, as the model has them. */
    function timelinesOf(model: ShareModel): SessionTimeline[] {
      const timeline = model.evidence[0]?.timeline;
      if (!Array.isArray(timeline)) throw new Error("The run has no timeline.");
      return timeline;
    }

    /** The element whose id is `id`, as text. */
    function textById(html: string, id: string): string {
      const found = new RegExp(`<([a-z0-9]+)\\b[^>]*\\sid="${id}"[^>]*>(.*?)</\\1>`, "s").exec(
        html,
      );
      if (found === null) throw new Error(`Nothing has the id ${id}`);
      return textOf(found[2] ?? "");
    }

    it("draws a chart of each session: an image named by its summary, in a box a keyboard can reach and scroll", () => {
      const model = loggedModel();
      const fold = loggedFold(model);
      const charts = [...fold.matchAll(/(<div class="scroll"[^>]*>)(<svg [^>]*>)/g)].map(
        ([, box = "", svg = ""]) => ({ box, svg }),
      );

      expect(charts).toHaveLength(2);
      for (const [index, { box, svg }] of charts.entries()) {
        const session = index + 1;
        expect(attributes(svg, "class")).toEqual(["timeline"]);
        expect(attributes(svg, "role")).toEqual(["img"]);
        expect(attributes(svg, "aria-labelledby")).toEqual([
          `tl-${RUN}-${session}-title tl-${RUN}-${session}-sum`,
        ]);
        expect(textById(fold, `tl-${RUN}-${session}-title`)).toBe(
          `Minute by minute, run ${RUN}, session ${session}`,
        );
        // Its summary is a paragraph above it, whose words are the model's.
        expect(textById(fold, `tl-${RUN}-${session}-sum`)).toBe(
          timelinesOf(model)[index]?.summary.join(" "),
        );
        expect(fold.indexOf(`id="tl-${RUN}-${session}-sum"`)).toBeLessThan(fold.indexOf(svg));
        expect(box).toBe(
          `<div class="scroll" tabindex="0" role="region" aria-label="Minute by minute, run ${RUN}, session ${session}, chart">`,
        );
      }
      expect(textById(fold, `tl-${RUN}-1-sum`)).toBe(
        "voicecap held the NVDA lock from 14:02 to 14:06. voicecap's NVDA ran as process 65720, then 54568. The computer's own NVDA was shut down at 14:02 and started again at 14:06. 2 pages ran in order; page 2 failed at 14:04.",
      );
    });

    it("names each session by its number and its day, when the run has more than one", () => {
      const fold = loggedFold();

      expect([...fold.matchAll(/<h4>(.*?)<\/h4>/g)].map(([, said]) => said)).toEqual([
        "Session 1, 26 September 2026",
        "Session 2, 28 September 2026",
      ]);
    });

    it("names a run's only session by its run alone", () => {
      const { run, log } = loggedRun();
      // A run of one session: the logged run as its first session left it.
      const single = { ...run, sessions: run.sessions.slice(0, 1) };
      const first = log.events.filter((event) => event.at.startsWith("2026-09-26"));
      const fold = loggedFold(
        loggedModel({
          runs: [single],
          records: [single],
          events: new Map([[run.id, { events: first, unreadable: 0 }]]),
        }),
      );

      expect(fold).not.toContain("<h4>");
      expect(scrollBoxes(fold)[0]).toContain(`aria-label="Minute by minute, run ${RUN}, chart"`);
      expect(textById(fold, `tl-${RUN}-1-title`)).toBe(`Minute by minute, run ${RUN}`);
    });

    it("names a run's only logged session by its number when it isn't the first, as for a run begun before voicecap kept the log", () => {
      const { run, log } = loggedRun();
      const second = log.events.filter((event) => event.at.startsWith("2026-09-28"));
      const fold = loggedFold(
        loggedModel({ events: new Map([[run.id, { events: second, unreadable: 0 }]]) }),
      );

      expect([...fold.matchAll(/<h4>(.*?)<\/h4>/g)].map(([, said]) => said)).toEqual([
        "Session 2, 28 September 2026",
      ]);
      expect(scrollBoxes(fold)[0]).toContain(
        `aria-label="Minute by minute, run ${RUN}, session 2, chart"`,
      );
    });

    it("says, in its place, that a session the log doesn't cover isn't recorded, and why: a run begun on 0.10.0 and finished on 0.11.0", () => {
      const { run, log } = resumedLoggedRun("0.10.0");
      const fold = loggedFold(
        buildShareModel(
          inputOf([run], { transcripts: storeOf(), events: new Map([[run.id, log]]) }),
        ),
      );
      const part = partOf(fold, "Minute by minute");
      const said = '<p class="not-recorded">Session 1: not recorded: it used voicecap 0.10.0.</p>';

      expect(part).toContain(`<div class="t-session">${said}</div>`);
      expect(part.indexOf(said)).toBeLessThan(
        part.indexOf("<h4>Session 2, 28 September 2026</h4>"),
      );
      expect(part.match(/<svg /g)).toHaveLength(1);
      expect(termsOf(fold)).toContainEqual([
        "NVDA restarts",
        "None in session 2. Session 1: not recorded: it used voicecap 0.10.0.",
      ]);
    });

    it("names the session the log covers when another isn't, as for a run finished with an older voicecap", () => {
      const { run, log } = loggedRun();
      const sessions = run.sessions.map((session) =>
        session.n === 2 && session.environment !== null
          ? {
              ...session,
              environment: {
                ...session.environment,
                voicecap: { ...session.environment.voicecap, version: "0.10.0" },
              },
            }
          : session,
      );
      const first = log.events.filter((event) => event.at.startsWith("2026-09-26"));
      const fold = loggedFold(
        buildShareModel(
          inputOf([{ ...run, sessions }], {
            transcripts: storeOf(),
            events: new Map([[run.id, { events: first, unreadable: 0 }]]),
          }),
        ),
      );
      const part = partOf(fold, "Minute by minute");

      expect([...part.matchAll(/<h4>(.*?)<\/h4>/g)].map(([, said]) => said)).toEqual([
        "Session 1, 26 September 2026",
      ]);
      expect(scrollBoxes(part)[0]).toContain(
        `aria-label="Minute by minute, run ${RUN}, session 1, chart"`,
      );
      expect(part.indexOf("<h4>Session 1")).toBeLessThan(
        part.indexOf("Session 2: not recorded: it used voicecap 0.10.0."),
      );
    });

    it("folds a table of every event of each session, a row for each, marked with its kind", () => {
      const model = loggedModel();
      const fold = loggedFold(model);
      const logs = fold.split('<details class="log">').slice(1);

      expect(logs).toHaveLength(2);
      for (const [index, timeline] of timelinesOf(model).entries()) {
        const log = logs[index]?.split("</details>")[0] ?? "";
        const session = index + 1;
        expect(log).toMatch(
          new RegExp(
            `^<summary>Every event, to the millisecond \\(${timeline.rows.length}\\)</summary>`,
          ),
        );
        expect(log).toContain(
          `<div class="events" tabindex="0" role="region" aria-label="Every event, run ${RUN}, session ${session}, table">`,
        );
        expect(rowsOf(log)).toEqual([
          "Time | Event",
          ...timeline.rows.map(({ time, text }) => `${time.slice(11, 23)} | ${text}`),
        ]);
        expect([...log.matchAll(/<tr class="([^"]*)">/g)].map(([, kind]) => kind)).toEqual(
          timeline.rows.map(({ kind }) => `ev-${kind}`),
        );
      }
      // The first session's 26 events and the second's 12, each closed.
      expect(summariesIn(fold).filter((line) => line.startsWith("Every event"))).toEqual([
        "Every event, to the millisecond (26)",
        "Every event, to the millisecond (12)",
      ]);
      expect(fold).not.toMatch(/<details class="log" open/);
    });

    it("says how many lines of the log couldn't be read, under the last table", () => {
      const { run, log } = loggedRun();
      const fold = loggedFold(
        loggedModel({ events: new Map([[run.id, { ...log, unreadable: 3 }]]) }),
      );

      expect(fold).toContain("<p>3 lines of the event log couldn&#39;t be read.</p>");
      expect(fold.indexOf("couldn&#39;t be read")).toBeGreaterThan(
        fold.lastIndexOf('<details class="log">'),
      );
      expect(loggedFold()).not.toContain("couldn&#39;t be read");
    });

    it("counts NVDA's restarts in the run's facts, with why each was", () => {
      const model = loggedModel();

      expect(termsOf(loggedFold(model))).toContainEqual([
        "NVDA restarts",
        "1: to try Apply again (attempt 2 of 5)",
      ]);
    });

    it("says what the event log can't show of a run of 0.11.0 whose log isn't there to read", () => {
      const { run } = loggedRun();
      const listed = { ...run, files: { "events.jsonl": { sha256: "e".repeat(64), bytes: 10 } } };
      const timelineOf = (record: RunJson) =>
        partOf(
          runFolds(renderEvidence(buildShareModel(inputOf([record])))).at(0) ?? "",
          "Minute by minute",
        );

      // Its record lists a log, which the page couldn't read as it was recorded.
      expect(timelineOf(listed)).toContain(
        '<p class="not-recorded">Not shown: the event log isn&#39;t as the run recorded it; voicecap verify names it.</p>',
      );
      // Its record lists none.
      expect(timelineOf(run)).toContain(
        '<p class="not-recorded">Not recorded: this run&#39;s record lists no event log.</p>',
      );
      expect(renderEvidence(buildShareModel(inputOf([run])))).not.toContain('class="timeline"');
    });

    it("escapes what an event says: a type it doesn't know, and a program's name", () => {
      const { run, log } = loggedRun();
      const hostile = '<img src=x onerror="alert(1)">';
      const events: RunEvent[] = log.events.map((event) =>
        event.type === "foreground-lost" ? { ...event, program: hostile } : event,
      );
      const last = events.at(-1)?.at ?? "";
      events.push({ at: last, type: hostile } as unknown as RunEvent);
      const fold = loggedFold(
        loggedModel({ events: new Map([[run.id, { events, unreadable: 0 }]]) }),
      );

      expect(fold).not.toContain("<img");
      expect(fold).toContain(`<td>Another window came to the front: ${esc(hostile)}</td>`);
      expect(fold).toContain(`<td>${esc(hostile)}</td>`);
    });

    it("leaves the demo's runs, from 0.4.1, as they were: no chart, no table", async () => {
      const html = renderEvidence(await demoModel());

      expect(html).not.toContain('class="timeline"');
      expect(html).not.toContain('class="log"');
      expect(html).not.toContain('class="events"');
    });
  });

  describe("a run's NVDA log, checked against the transcripts", () => {
    /** The heading of the part, as the markup spells it. */
    const TITLE = "NVDA&#39;s own log, checked against the transcripts";

    /** The model of the real run of 6 October 2026, as a voicecap that keeps NVDA's log could have made it. */
    async function fixtureModel(
      options: Parameters<typeof nvdaFixtureSite>[0] = {},
    ): Promise<ShareModel> {
      const { siteDir } = await nvdaFixtureSite(options);
      return buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf }));
    }

    /** The model with the check its first run shows replaced. */
    function showing(model: ShareModel, nvdaLog: RunEvidence["nvdaLog"]): ShareModel {
      const [first, ...rest] = model.evidence;
      if (first === undefined) throw new Error("The model has no run.");
      return { ...model, evidence: [{ ...first, nvdaLog }, ...rest] };
    }

    /** A check of 12 steps, all agreed, with 3 lines of speech outside them, and what a test changes. */
    function checked(overrides: Partial<NvdaLogChecked> = {}): NvdaLogChecked {
      return {
        transcriptLines: 12,
        logLines: 12,
        agree: 12,
        onlyInLog: [],
        onlyInTranscripts: [],
        outside: 3,
        notChecked: [],
        ...overrides,
      };
    }

    /**
     * The NVDA-log part of the first run's fold, from its heading to the next part's (a run's
     * timeline has folds inside it, so the fold isn't cut at its first closing tag).
     */
    function partOfModel(model: ShareModel): string {
      const html = renderEvidence(model);
      const start = html.indexOf(`<div><h3>${TITLE}`);
      if (start === -1) throw new Error("The evidence has no NVDA-log part.");
      return html.slice(start, html.indexOf("<div><h3>", start + 1));
    }

    /** The tiles of a part: each one's number and what it counts. */
    const tilesOf = (part: string): [string, string][] =>
      [...part.matchAll(/<div class="big">(.*?)<\/div><div class="sub">(.*?)<\/div>/g)].map(
        ([, big = "", label = ""]): [string, string] => [textOf(big), textOf(label)],
      );

    /** The lines of each list of a part, as their words. */
    const listsOfPart = (part: string): string[][] =>
      [...part.matchAll(/<ul class="diffs">(.*?)<\/ul>/gs)].map(([, list = ""]) =>
        [...list.matchAll(/<li class="place">(.*?)<\/li>/gs)].map(([, item = ""]) => textOf(item)),
      );

    /** The headings inside a part. */
    const headingsOfPart = (part: string): string[] =>
      [...part.matchAll(/<h4>(.*?)<\/h4>/g)].map(([, heading = ""]) => textOf(heading));

    const OUTSIDE =
      "(while pages loaded, before the run, or in attempts that were thrown out) aren't compared or shown.";
    /** The same, for a run some of whose steps weren't checked: their speech is among it. */
    const OUTSIDE_SOME =
      "(while pages loaded, before the run, in attempts that were thrown out, or in steps that weren't checked) aren't compared or shown.";

    /**
     * The part's words in the order it says them: each tile's number and what it counts, then each
     * paragraph, list heading, and line of a list.
     */
    const wordsInOrder = (part: string): string[] =>
      [
        ...part.matchAll(
          /<div class="big">(.*?)<\/div><div class="sub">(.*?)<\/div>|<p[^>]*>(.*?)<\/p>|<h4>(.*?)<\/h4>|<li class="place">(.*?)<\/li>/gs,
        ),
      ].map(([, big, label, paragraph, heading, item]) =>
        textOf(big === undefined ? (paragraph ?? heading ?? item ?? "") : `${big} ${label}`),
      );

    it("shows the real run: three tiles with the counts, that every line agrees, and the speech left out", async () => {
      const part = partOfModel(await fixtureModel());

      expect(tilesOf(part)).toEqual([
        ["204", "lines in voicecap's transcripts for this run"],
        ["204", "lines NVDA's own log has for those steps"],
        ["204", "agree"],
      ]);
      expect(part).toContain('<div class="cross">');
      expect(part).toContain('<p class="prob-verdict"><b>Every line agrees.</b></p>');
      expect(textOf(part)).toContain(`177 lines NVDA spoke outside voicecap's steps ${OUTSIDE}`);
      // Nothing to list, and nothing unchecked.
      expect(headingsOfPart(part)).toEqual([]);
      expect(part).not.toContain('class="diffs"');
      expect(textOf(part)).not.toContain("checked:");
    });

    it("lists a line that differs under each heading, with its page, pass, step, and words", async () => {
      const model = showing(
        await fixtureModel(),
        checked({
          transcriptLines: 204,
          logLines: 204,
          agree: 202,
          onlyInLog: [{ page: "/about/", pass: "read", step: 12, text: "Read the guides." }],
          onlyInTranscripts: [
            { page: "/about/", pass: "read", step: 12, text: "Read the guide." },
            { page: "Home", pass: "tab", step: 3, text: "Skip to main content, link" },
          ],
        }),
      );
      const part = partOfModel(model);

      expect(tilesOf(part)).toEqual([
        ["204", "lines in voicecap's transcripts for this run"],
        ["204", "lines NVDA's own log has for those steps"],
        ["202", "agree"],
      ]);
      expect(headingsOfPart(part)).toEqual([
        "Said in NVDA's own log, not in the transcripts",
        "In the transcripts, not in NVDA's own log",
      ]);
      expect(listsOfPart(part)).toEqual([
        ["/about/, Read pass, step 12: “Read the guides.”"],
        [
          "/about/, Read pass, step 12: “Read the guide.”",
          "Home, Tab pass, step 3: “Skip to main content, link”",
        ],
      ]);
      // Lines that differ, so it doesn't say they all agree.
      expect(textOf(part)).not.toContain("Every line agrees.");
    });

    it("gives a list its heading only when it has a line", () => {
      const only = (key: "onlyInLog" | "onlyInTranscripts") =>
        partOfModel(
          showing(
            modelOf([{ path: "/" }]),
            checked({ agree: 11, [key]: [{ page: "/", pass: "tab", step: 1, text: "x" }] }),
          ),
        );

      expect(headingsOfPart(only("onlyInLog"))).toEqual([
        "Said in NVDA's own log, not in the transcripts",
      ]);
      expect(headingsOfPart(only("onlyInTranscripts"))).toEqual([
        "In the transcripts, not in NVDA's own log",
      ]);
    });

    it("says in the singular what is one", () => {
      const part = partOfModel(
        showing(
          modelOf([{ path: "/" }]),
          checked({ transcriptLines: 1, logLines: 1, agree: 1, outside: 1 }),
        ),
      );

      expect(tilesOf(part)).toEqual([
        ["1", "line in voicecap's transcripts for this run"],
        ["1", "line NVDA's own log has for those steps"],
        ["1", "agrees"],
      ]);
      expect(textOf(part)).toContain(
        `1 line NVDA spoke outside voicecap's steps ${OUTSIDE.replace("aren't", "isn't")}`,
      );
    });

    it("says how many steps had no words when the transcripts have more lines than the log", () => {
      const part = partOfModel(
        showing(modelOf([{ path: "/" }]), checked({ transcriptLines: 14, logLines: 12 })),
      );

      expect(tilesOf(part).map(([big]) => big)).toEqual(["14", "12", "12"]);
      expect(part).toContain(
        '<p class="prob-verdict"><b>Every line agrees.</b> 2 steps had no words in the transcripts or in NVDA&#39;s own log.</p>',
      );
    });

    it("says how many steps weren't checked, and why, for each group, straight under the tiles, which count only what was checked", () => {
      const part = partOfModel(
        showing(
          modelOf([{ path: "/" }]),
          checked({
            transcriptLines: 16,
            logLines: 16,
            agree: 16,
            notChecked: [
              {
                steps: 8,
                from: "2026-09-26T14:04:45.729-05:00",
                why: "reason",
                detail: "NVDA's log wasn't there.",
              },
              { steps: 1, from: null, why: "unread", detail: null },
            ],
          }),
        ),
      );

      // Before what the check found, so it never reads as speaking for the steps it didn't check.
      expect(wordsInOrder(part)).toEqual([
        "16 lines in voicecap's transcripts that were checked",
        "16 lines NVDA's own log has for those steps",
        "16 agree",
        "8 steps from the NVDA session that started 26 September 2026, 14:04 weren't checked: NVDA's log wasn't there.",
        "1 step wasn't checked: the transcripts' steps couldn't be read here.",
        "Every line that was checked agrees.",
        `3 lines NVDA spoke outside voicecap's steps ${OUTSIDE_SOME}`,
      ]);
      expect(part).toContain(
        '<p class="prob-verdict"><b>Every line that was checked agrees.</b></p>',
      );
      expect(textOf(part)).not.toContain("Every line agrees.");
      expect(textOf(part)).not.toContain("for this run");
    });

    it("says what it checked of a run whose NVDA sessions were checked in part, the groups that weren't with why, then the lines that differ", () => {
      const kept = keptLogsRun();
      // NVDA said "Grant" for "Grants" in the first session (Home); the second session kept no copy,
      // and its log says why; the third's stop has no event of its copy, so the log names none.
      const copies = new Map(kept.copies).set(
        FIRST_COPY,
        (kept.copies.get(FIRST_COPY) ?? "").replaceAll("'Grants'", "'Grant'"),
      );
      const events = kept.log.events.flatMap((event): RunEvent[] => {
        if (event.type !== "screen-reader-log") return [event];
        if (event.file === "nvda-log/1-2.txt") {
          return [{ ...event, file: null, reason: "NVDA's log wasn't there." }];
        }
        return event.file === "nvda-log/2-1.txt" ? [] : [event];
      });
      const model = buildShareModel(
        inputOf([kept.run], {
          transcripts: kept.transcripts,
          events: new Map([[kept.run.id, { events, unreadable: 0 }]]),
          nvdaLogs: new Map([[kept.run.id, copies]]),
        }),
      );

      expect(wordsInOrder(partOfModel(model))).toEqual([
        "8 lines in voicecap's transcripts that were checked",
        "8 lines NVDA's own log has for those steps",
        "6 agree",
        "8 steps from the NVDA session that started 26 September 2026, 14:04 weren't checked: NVDA's log wasn't there.",
        "8 steps from the NVDA session that started 28 September 2026, 09:00 weren't checked: voicecap kept no copy of NVDA's log for that session.",
        "Said in NVDA's own log, not in the transcripts",
        "Home, Read pass, step 2: “heading, level 1, Grant”",
        "Home, Headings pass, step 1: “heading, level 1, Grant”",
        "In the transcripts, not in NVDA's own log",
        "Home, Read pass, step 2: “heading, level 1, Grants”",
        "Home, Headings pass, step 1: “heading, level 1, Grants”",
        `9 lines NVDA spoke outside voicecap's steps ${OUTSIDE_SOME}`,
      ]);
    });

    it("says what stands in its place as a run says every part it didn't record", async () => {
      for (const words of [
        "Not recorded: this run kept no copy of NVDA's log.",
        "Not recorded: this check is NVDA's only, since VoiceOver keeps no log of what it says.",
        "Not shown: NVDA's log isn't as the run recorded it; voicecap verify names it.",
      ]) {
        const part = partOfModel(showing(await fixtureModel(), { notRecorded: words }));

        expect(part).toContain(`<p class="not-recorded">${esc(words)}</p>`);
        expect(part).not.toContain('class="cross"');
      }
      // A run whose record lists no copy, and whose event log names none, kept none.
      const unlisted = await fixtureModel({
        unlisted: true,
        change: (parts) => {
          parts.events = parts.events.filter((line) => !line.includes('"screen-reader-log"'));
        },
      });
      expect(partOfModel(unlisted)).toContain(
        '<p class="not-recorded">Not recorded: this run kept no copy of NVDA&#39;s log.</p>',
      );
      // One whose event log names a copy that its record doesn't list: the record has no line of it.
      expect(partOfModel(await fixtureModel({ unlisted: true }))).toContain(
        '<p class="not-recorded">Not shown: the run&#39;s record doesn&#39;t list the copy of NVDA&#39;s log that its event log names.</p>',
      );
    });

    it("says a copy the record lists, which the page didn't read, isn't as recorded, and that the record doesn't list one it doesn't", () => {
      const kept = keptLogsRun();
      const modelWith = (run: RunJson) =>
        buildShareModel(
          inputOf([run], {
            transcripts: kept.transcripts,
            events: new Map([[run.id, kept.log]]),
            nvdaLogs: new Map(),
          }),
        );

      // Listed: missing or changed on disk, which voicecap verify names.
      expect(partOfModel(modelWith(kept.run))).toContain(
        `<p class="not-recorded">${esc("Not shown: NVDA's log isn't as the run recorded it; voicecap verify names it.")}</p>`,
      );
      // Not listed: verify, which goes by the record, never looks for it, so the page says only that.
      const unlisted = partOfModel(modelWith(withOwnFiles(kept.run, { "events.jsonl": LOG_HASH })));
      expect(unlisted).toContain(
        `<p class="not-recorded">${esc("Not shown: the run's record doesn't list the copy of NVDA's log that its event log names.")}</p>`,
      );
      expect(unlisted).not.toContain("verify names");
    });

    it("says, of a page made without NVDA's keys, that this page was made without them", () => {
      const kept = keptLogsRun();
      const model = buildShareModel(
        inputOf([kept.run], {
          transcripts: kept.transcripts,
          events: new Map([[kept.run.id, kept.log]]),
          nvdaLogs: new Map([[kept.run.id, kept.copies]]),
          gestureOf: null,
        }),
      );
      const part = partOfModel(model);

      expect(part).toContain(
        `<p class="not-recorded">${esc("Not shown: this page was made without the keys voicecap presses for each step, which the check needs.")}</p>`,
      );
      expect(part).not.toContain('class="cross"');
    });

    it("escapes the words of a line, and of why steps weren't checked, and sets no style", () => {
      const hostile = '<b>bold</b> & "quoted" <script>alert(1)</script>';
      const html = renderEvidence(
        showing(
          modelOf([{ path: "/" }]),
          checked({
            agree: 11,
            onlyInLog: [{ page: "<i>page</i>", pass: "read", step: 1, text: hostile }],
            onlyInTranscripts: [{ page: "<i>page</i>", pass: "read", step: 1, text: hostile }],
            // The reason a run's event log gives, in its own words.
            notChecked: [
              { steps: 2, from: null, why: "reason", detail: "<img src=x onerror=alert(1)>" },
            ],
          }),
        ),
      );
      const part = html.slice(html.indexOf(TITLE));

      expect(part).toContain(`<code>“${esc(hostile)}”</code>`);
      expect(part).toContain("&lt;i&gt;page&lt;/i&gt;, Read pass, step 1:");
      expect(part).toContain(
        "<p>2 steps weren&#39;t checked: &lt;img src=x onerror=alert(1)&gt;.</p>",
      );
      expect(part).not.toContain("<script>alert");
      expect(part).not.toContain("<i>page</i>");
      expect(part).not.toContain("<img src=x");
      expect(html).not.toMatch(/\sstyle=/);
    });

    it("shows nothing NVDA said outside the steps, anywhere on the page", async () => {
      const html = renderSharePage(await fixtureModel(), { fontCss: "" });

      // Said before the run began, and as pages opened and closed: counted, never shown.
      for (const outside of [
        "Calculator",
        "Connected as controlled computer",
        "Display is 0",
        "voicecap check lzquyq",
        "Skipping certificate verification",
      ]) {
        expect(html, outside).not.toContain(outside);
      }
      expect(textOf(withoutData(html))).toContain("177 lines NVDA spoke outside voicecap's steps");
    });

    it("sets its headings one level under the part's, so the details set them to h5 and none goes below h6", async () => {
      const model = showing(
        await fixtureModel(),
        checked({ agree: 11, onlyInLog: [{ page: "/", pass: "read", step: 1, text: "x" }] }),
      );
      const html = renderSharePage(model, { fontCss: "" });
      const part = html.slice(html.indexOf(`<h4>${TITLE}`));

      // The part's own heading is an h4 on the page, and its list's an h5.
      expect(part.startsWith("<h4>NVDA&#39;s own log, checked against the transcripts")).toBe(true);
      expect(part).toContain("<h5>Said in NVDA&#39;s own log, not in the transcripts</h5>");
      expect(html).not.toMatch(/<h6[\s>]/);
    });
  });

  describe("the runs it left out", () => {
    it("lists them last, as a list", async () => {
      const model = await demoModel();
      const html = renderEvidence(model);

      expect(model.leftOut.map(({ text }) => text)).toEqual([
        "2026-09-29_1415: interrupted after 1 of 7 pages",
        "2026-09-29_1419: interrupted after 2 of 7 pages",
      ]);
      // The only list in the section.
      expect(listsOf(html)).toEqual([model.leftOut.map(({ text }) => text)]);
      expect(html).toContain("<h3>Runs left out</h3>");
      expect(html.indexOf("<h3>Runs left out</h3>")).toBeGreaterThan(
        html.lastIndexOf("</details>"),
      );
      expect(textOf(withoutData(html))).toContain(
        "These runs aren't counted in any result on this page. A run counts only when it completed, was sealed, and wasn't a replay.",
      );
    });

    it("has no list when every run counted", () => {
      const html = renderEvidence(modelOf([{ path: "/" }]));

      expect(runFolds(html)).toHaveLength(1);
      expect(html).not.toContain("Runs left out");
      expect(listsOf(html)).toEqual([]);
    });
  });

  describe("with no run that counts", () => {
    it("says so, keeps the heading, and lists what it left out, with nothing to check", () => {
      const html = renderEvidence(noRunModel());

      expect(html).toContain('<h2 id="ev-h">The evidence behind these results</h2>');
      expect(textOf(html)).toContain("No live run counts yet. There is no evidence to show.");
      expect(listsOf(html)).toEqual([
        ["2026-09-26_1405: replayed, so it never counts as a live result"],
      ]);
      expect(foldsIn(html)).toEqual([]);
      expect(attributes(html, "id")).toEqual(["ev-h"]);
      expect(html).not.toContain("<script");
    });
  });

  it("escapes what a record or the model supplies", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const run = shareRun({
      id: "r1",
      sessions: [{ reviewer: hostile, environment: { browser: { name: hostile, version: "1" } } }],
      pages: [
        { path: "/", label: hostile, files: TRANSCRIPTS, passes: LINES },
        { path: "/search?a=1&b=2", files: TRANSCRIPTS, passes: LINES },
      ],
    });
    const replay = shareRun({
      id: "<b>old</b>",
      createdAt: "2026-09-25T10:00:00-05:00",
      replayed: true,
      pages: [{ path: "/" }],
    });
    const model = buildShareModel(
      inputOf([replay, run], { transcripts: storeWithout((_, pass) => pass === "tab") }),
    );
    const [first] = model.evidence;
    if (first === undefined) throw new Error("The model has a run.");
    const verify = 'npx verify --site "http://x/?a=1&b=2"';
    const html = withoutData(
      renderEvidence({
        ...model,
        flagRulesSha256: "<i>f</i>",
        evidence: [
          {
            ...first,
            verify,
            facts: [...first.facts, { label: "<i>L</i>", value: "<em>V</em>" }],
            environment: [...first.environment, { label: "<u>E</u>", value: "<s>V</s>" }],
          },
        ],
      }),
    );

    for (const markup of ["<img", "<b>old", "<i>", "<em>", "<u>", "<s>"]) {
      expect(html).not.toContain(markup);
    }
    // In the facts and the environment, from the record and from the model's rows.
    expect(html).toContain(`<div><dt>Run by</dt><dd>${esc(hostile)}</dd></div>`);
    expect(html).toContain(
      "<div><dt>&lt;i&gt;L&lt;/i&gt;</dt><dd>&lt;em&gt;V&lt;/em&gt;</dd></div>",
    );
    expect(html).toContain(`<tr><th scope="row">Browser</th><td>${esc(`${hostile} 1`)}</td></tr>`);
    expect(html).toContain(
      '<tr><th scope="row">&lt;u&gt;E&lt;/u&gt;</th><td>&lt;s&gt;V&lt;/s&gt;</td></tr>',
    );
    // A fingerprint's page, the note on what couldn't be read, and the list of what was left out.
    expect(html).toContain("<td>/search?a=1&amp;b=2</td>");
    expect(html).toContain(`${esc(hostile)} (tab.txt)`);
    expect(html).toContain("<li>&lt;b&gt;old&lt;/b&gt;: replayed, so it never counts");
    expect(html).toContain("<code>&lt;i&gt;f&lt;/i&gt;</code>");
    // The command that checks the originals, beside the check and in the run's fold.
    const escaped = "npx verify --site &quot;http://x/?a=1&amp;b=2&quot;";
    expect(html.split(escaped)).toHaveLength(3);
    expect(html).not.toContain(verify);
  });

  it("sets no style attribute, and holds no heading in a summary line or section heading in a fold", async () => {
    for (const model of [
      await demoModel(),
      unreadableModel(THREE_UNREADABLE),
      modelOf([{ path: "/" }]),
      noRunModel(),
      loggedModel(),
    ]) {
      const html = withoutData(renderEvidence(model));

      expect(html).not.toMatch(/\sstyle=/);
      for (const summary of html.match(/<summary>.*?<\/summary>/gs) ?? []) {
        expect(summary).not.toMatch(/<h[1-6]/);
      }
      // A fold's own parts start at level 3, and the section's heading is outside every fold.
      for (const fold of foldsIn(html)) expect(fold).not.toMatch(/<h[12][ >]/);
      expect(html.match(/<h2/g)).toHaveLength(1);
    }
  });
});

describe("renderStory", () => {
  it("opens with how voicecap began, in the open, before the paragraph that cites the study", async () => {
    const story = renderStory(await demoModel());

    expect(story.indexOf(esc(STORY.began))).toBeGreaterThan(story.indexOf('id="story-h"'));
    expect(story.indexOf(esc(STORY.began))).toBeLessThan(story.indexOf(esc(STORY.deque.title)));
    // A paragraph of its own, ahead of the first fold, so no one has to open anything to read it.
    expect(story).toContain(`<p class="gist">${esc(STORY.began)}</p>`);
    expect(story.indexOf(esc(STORY.began))).toBeLessThan(story.indexOf("<details"));
  });

  it("then says why voicecap exists, with the Deque study's title linked where the text quotes it", async () => {
    const html = renderStory(await demoModel());
    const [began = "", why = ""] = [...html.matchAll(/<p class="gist">(.*?)<\/p>/gs)].map(
      (found) => found[1] ?? "",
    );

    expect(html).toMatch(
      /^<section aria-labelledby="story-h">\s*<h2 id="story-h">How voicecap came to be<\/h2>\s*<p class="gist">/,
    );
    // How it began is the first paragraph, with no link in it.
    expect(textOf(began, "")).toBe(STORY.began);
    expect(attributes(began, "href")).toEqual([]);
    // The words are the fixed text's own, and the link is in them, not after them.
    expect(textOf(why, "")).toBe(STORY.why);
    expect(why).toContain(`“<a href="${STORY.deque.url}">${STORY.deque.title}</a>”`);
    expect(attributes(why, "href")).toEqual([STORY.deque.url]);
    // It's the page's only link here.
    expect(attributes(html, "href")).toEqual([STORY.deque.url]);
  });

  it("folds the rest of the story, and the cards worth knowing, each behind a line that says what's inside", async () => {
    const html = renderStory(await demoModel());

    expect(summariesIn(html)).toEqual([
      "The rest of the story the usual answer, and voicecap's",
      `A few things worth knowing ${WORTH_KNOWING.length} points`,
    ]);
    expect(html).not.toMatch(/<details[^>]* open/);
    const [rest = "", worth = ""] = foldsIn(html);
    expect(rest).toContain(`<p>${esc(STORY.usual)}</p><p>${esc(STORY.answer)}</p>`);
    expect(
      [...worth.matchAll(/<div><h3>(.*?)<\/h3><p>(.*?)<\/p><\/div>/gs)].map((found) => [
        textOf(found[1] ?? ""),
        textOf(found[2] ?? ""),
      ]),
    ).toEqual(WORTH_KNOWING.map(({ title, text }) => [title, text]));
    expect(worth).toContain('<div class="worth">');
  });

  it("tells the story in order: why, the rest, the timeline, and what's worth knowing", async () => {
    const html = renderStory(await demoModel());
    const order = [
      STORY.deque.url,
      "The rest of the story",
      '<table class="tracks">',
      "A few things worth knowing",
    ].map((part) => html.indexOf(part));

    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  describe("the timeline", () => {
    it("is a table with two tracks, a Windows PC with NVDA and a Mac with VoiceOver", async () => {
      const table = tableOf(renderStory(await demoModel()), "tracks");

      expect(table).toContain(
        "<caption>From the first line of code to today, on a Windows PC and on a Mac</caption>",
      );
      expect(table).toContain(
        '<thead><tr><th scope="col">When</th><th scope="col"><span class="plat pc">Windows PC</span>, with NVDA</th><th scope="col"><span class="plat mac">Mac</span>, with VoiceOver</th></tr></thead>',
      );
    });

    it("has a row for each entry, with its cells inserted as written", async () => {
      const table = tableOf(renderStory(await demoModel()), "tracks");
      const [, body = ""] = table.split("<tbody>");

      expect(body.match(/<tr>/g)).toHaveLength(TIMELINE.length);
      for (const { both, pc, mac } of TIMELINE) {
        for (const cell of [both, pc, mac]) if (cell !== null) expect(body).toContain(cell);
      }
      // The bold and code of a cell are markup, not text.
      expect(body).toContain("<b>0.1.0</b>");
      expect(body).toContain("<code>voicecap verify</code>");
    });

    it("spans both tracks for what was for both, and leaves a track with nothing empty", async () => {
      const body = tableOf(renderStory(await demoModel()), "tracks");
      const both = TIMELINE.filter((row) => row.both !== null);

      expect(body.match(/<td colspan="2" class="both/g)).toHaveLength(both.length);
      for (const { both: cell } of both) expect(body).toContain(`>${cell}</td>`);
      // One track to a cell: the Windows PC's, and the Mac's.
      expect(body.match(/<td class="pc/g)).toHaveLength(
        TIMELINE.filter((row) => row.pc !== null).length,
      );
      expect(body.match(/<td class="mac/g)).toHaveLength(
        TIMELINE.filter((row) => row.mac !== null).length,
      );
      expect(body).toContain('<td class="none"></td>');
    });

    it("gives each day a row header, and one date to two entries of one day", async () => {
      const table = tableOf(renderStory(await demoModel()), "tracks");
      const days = TIMELINE.flatMap((row, index) =>
        row.date !== null && TIMELINE[index - 1]?.date === row.date ? [] : [row],
      );

      expect(table.match(/<th scope="row"/g)).toHaveLength(days.length);
      const shared = [];
      for (const { date } of days) {
        if (date === null) continue;
        const entries = TIMELINE.filter((row) => row.date === date).length;
        expect(table).toContain(
          `<th scope="row"${entries > 1 ? ` rowspan="${entries}"` : ""}><time datetime="${date}">`,
        );
        // Its date is on the page once, however many entries it heads.
        expect(table.match(new RegExp(`datetime="${date}"`, "g"))).toHaveLength(1);
        if (entries > 1) shared.push(date);
      }
      // The real timeline has such a day (28 September), so this joins some rows.
      expect(shared, "the timeline has no day with two entries to join").not.toEqual([]);
    });

    it("writes the year on the first date, and again only when it changes", async () => {
      const table = tableOf(renderStory(await demoModel()), "tracks");

      expect(table).toContain(`<time datetime="2026-09-25">${longDate("2026-09-25T00:00")}</time>`);
      expect(table).toContain('<time datetime="2026-09-26">26 September</time>');
      expect(table).toContain('<time datetime="2026-09-30">30 September</time>');
    });

    it("marks what isn't done yet as Next, never with a date", async () => {
      const table = tableOf(renderStory(await demoModel()), "tracks");
      const last = TIMELINE.at(-1);
      const [row = ""] = table.split("<tr>").slice(-1);

      expect(last?.date).toBeNull();
      expect(row).toContain('<th scope="row">Next</th>');
      expect(row).not.toContain("<time");
      // Each of its cells is marked, whichever tracks it has, unless there's nothing in it.
      const classes = [...row.matchAll(/<td [^>]*class="([^"]*)"/g)].map((cell) => cell[1] ?? "");
      expect(classes.length).toBeGreaterThan(0);
      for (const name of classes) expect(name.includes("none") || name.includes("next")).toBe(true);
    });

    it("sits in a box that a keyboard can reach and scroll, and a screen reader names", async () => {
      expect(scrollBoxes(renderStory(await demoModel()))).toEqual([
        '<div class="scroll" tabindex="0" role="region" aria-label="voicecap&#39;s timeline, table">',
      ]);
    });
  });

  it("sets no style attribute, and holds no heading in a summary line or section heading in a fold", async () => {
    const html = renderStory(await demoModel());

    expect(html).not.toMatch(/\sstyle=/);
    for (const summary of html.match(/<summary>.*?<\/summary>/gs) ?? []) {
      expect(summary).not.toMatch(/<h[1-6]/);
    }
    for (const fold of foldsIn(html)) expect(fold).not.toMatch(/<h[12][ >]/);
    expect(html.match(/<h2/g)).toHaveLength(1);
  });
});

describe("renderFooter", () => {
  it("says what voicecap is, with its link, when the page was made, how its times are given, and what file it is", async () => {
    const model = await demoModel();
    const html = renderFooter(model);

    expect(html).toMatch(/^<footer>[\s\S]*<\/footer>$/);
    expect(textOf(html)).toContain(`${ABOUT} github.com/ICJIA/voicecap`);
    expect(attributes(html, "href")).toEqual([GITHUB]);
    expect(html).toContain(`<a href="${GITHUB}">github.com/ICJIA/voicecap</a>`);
    // The demo's runs were recorded in Chicago, on daylight time: its times are as they were.
    expect(textOf(html)).toContain(
      "Generated on 30 September 2026 at 09:00 (UTC−05:00). Times are as each run recorded them (UTC−05:00).",
    );
    // Both files by name, the page first, each in the fixed-width font.
    expect(textOf(html, "")).toContain("This file: current.html. Its Word copy: current.docx.");
    expect(html).toContain(
      '<span>This file: <span class="mono">current.html</span>. Its Word copy: <span class="mono">current.docx</span>.</span>',
    );
  });

  it("names the file and its Word copy as the model has them, the day and time the page was made, and each offset its runs used", async () => {
    const html = renderFooter({
      ...(await demoModel()),
      footer: {
        generatedAt: "2026-12-01T17:45:00-06:00",
        fileName: "127.0.0.1_4848_2026-12-01.html",
        wordName: "127.0.0.1_4848_2026-12-01.docx",
        offsets: ["UTC−05:00", "UTC−06:00"],
      },
    });

    expect(html).toContain(
      'This file: <span class="mono">127.0.0.1_4848_2026-12-01.html</span>. Its Word copy: <span class="mono">127.0.0.1_4848_2026-12-01.docx</span>.',
    );
    expect(textOf(html)).toContain(
      "Generated on 1 December 2026 at 17:45 (UTC−06:00). Times are as each run recorded them (UTC−05:00 and UTC−06:00).",
    );
  });

  it("says nothing of the runs' times when no run counts", async () => {
    const html = renderFooter({
      ...(await demoModel()),
      footer: {
        generatedAt: "2026-12-01T17:45:00+01:00",
        fileName: "x.html",
        wordName: "x.docx",
        offsets: [],
      },
    });

    expect(textOf(html)).toContain("Generated on 1 December 2026 at 17:45 (UTC+01:00).");
    expect(textOf(html)).not.toContain("Times are");
  });

  it("escapes both files' names and the offsets, and sets no style attribute", async () => {
    const html = renderFooter({
      ...(await demoModel()),
      footer: {
        generatedAt: "2026-12-01T17:45:00-06:00",
        fileName: "<b>x</b>.html",
        wordName: "<u>w</u>.docx",
        offsets: ["<i>Zone</i>"],
      },
    });

    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<u>w</u>");
    expect(html).not.toContain("<i>Zone</i>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;.html");
    expect(html).toContain("&lt;i&gt;Zone&lt;/i&gt;");
    // Both names stay in the fixed-width font, escaped inside it.
    expect(html).toContain('<span class="mono">&lt;b&gt;x&lt;/b&gt;.html</span>');
    expect(html).toContain('<span class="mono">&lt;u&gt;w&lt;/u&gt;.docx</span>');
    expect(html).not.toMatch(/\sstyle=/);
  });
});
