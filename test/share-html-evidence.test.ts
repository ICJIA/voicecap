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

import type { PassName } from "../src/model.js";
import { esc, plural } from "../src/report/html.js";
import { CHECK_SCRIPT, checkDataJson, type CheckData } from "../src/share/check.js";
import { longDate, sizeWords } from "../src/share/format.js";
import {
  renderCoverage,
  renderEvidence,
  renderFooter,
  renderStory,
} from "../src/share/html/evidence.js";
import type { ShareInput, TranscriptStore } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { ABOUT, STORY, TIMELINE, WORTH_KNOWING } from "../src/share/text.js";
import { walkthroughJson, walkthroughOf } from "../src/share/walkthrough.js";
import { inRun } from "../src/share/words.js";
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
  demoModel,
  downloadOf,
  inputOf,
  LINES,
  storeOf,
  TRANSCRIPTS,
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
