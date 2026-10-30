import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { chromium, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FORMS_DEFAULTS } from "../src/config/defaults.js";
import { launchChrome, type ChromeSession } from "../src/drivers/guidepup/chrome.js";
import type { FormInfo } from "../src/forms/types.js";

// Real Chromium (Playwright's build, headless), one page at a time from a local server.
const haveChromium = existsSync(chromium.executablePath());
const HEADLESS = ["--headless=new", ...(process.platform === "linux" ? ["--no-sandbox"] : [])];

const HEAD = `<!doctype html><title>Page</title><link rel="icon" href="data:,">`;
const SIGN_UP = `<form action="/join" method="post"><label>Email <input type="email" name="email" required></label><button>Join</button></form>`;

const PAGES: Record<string, string> = {
  "/one": `${HEAD}
    <p>Main</p>
    <form id="contact" action="/contact" method="post">
      <label for="n">Your name</label><input id="n" name="n" required>
      <input type="text" name="aria" aria-label="Nickname" aria-required="true">
      <input type="text" name="plain" placeholder="Anything">
      <fieldset><legend>Colour</legend>
        <label><input type="radio" name="c" value="r" required> Red</label>
        <label><input type="radio" name="c" value="b"> Blue</label>
      </fieldset>
      <select name="s" aria-label="Pick"><option>a</option><option>b</option></select>
      <textarea name="t" aria-label="Message"></textarea>
      <input type="hidden" name="h"><input type="text" name="gone" aria-label="Gone" style="display:none">
      <input type="submit" value="Send">
    </form>
    ${SIGN_UP}`,
  "/two": `${HEAD}<h1>Other page</h1>${SIGN_UP}`,
  "/kinds": `${HEAD}
    <form role="search" action="/s"><input type="search" aria-label="Find"><button>Go</button></form>
    <form action="/s" method="get"><input type="text" aria-label="Q"><button>Go</button></form>
    <form action="mailto:office@example.gov"><input aria-label="Say"><button>Mail</button></form>
    <form action="/nothing"><input aria-label="No button"></form>
    <form action="/login" method="post"><input aria-label="User"><input type="password" aria-label="Password" autocomplete="current-password"><button>In</button></form>
    <form action="/card" method="post"><input aria-label="Card" autocomplete="cc-number"><button>Pay</button></form>
    <form action="/c" method="post"><input aria-label="Say"><div class="g-recaptcha"></div><button>Go</button></form>
    <form action="/hidden" method="post" style="display:none"><input aria-label="Hid"><button>Go</button></form>
    <iframe src="https://docs.google.com/forms/d/e/1/viewform" width="10" height="10"></iframe>
    <input type="text" aria-label="Loose field"><div role="button">Not a submit</div>`,
  "/hostile": `${HEAD}
    <script>
      Element.prototype.getAttribute = () => "lies";
      window.MutationObserver = undefined;
      Object.defineProperty(HTMLElement.prototype, "checkVisibility", { value: () => false });
    </script>
    <form action="/real" method="post"><input name="action" aria-label="Field" required><input name="elements"><button>Go</button></form>`,
  "/focus": `${HEAD}
    <form action="/x" method="post">
      <input name="a" aria-label="Alpha">
      <label><input type="radio" name="r" value="a"> A</label>
      <label><input type="radio" name="r" value="b"> B</label>
      <a id="help" href="#help">What's this?</a>
      <button id="go">Send</button>
    </form>`,
  "/required": `${HEAD}
    <form action="/x" method="post">
      <input name="t" aria-label="Text" required>
      <label><input type="radio" name="r" value="one" required> One</label>
      <label><input type="radio" name="r" value="two"> Two</label>
      <label><input type="checkbox" name="b" required> Agree</label>
      <select name="l" aria-label="List" required><option value=""></option><option>one</option></select>
      <input name="o" aria-label="Optional">
      <button>Send</button>
    </form>`,
  "/typed": `${HEAD}
    <form action="/x" method="post">
      <input type="number" name="number" aria-label="Count" required>
      <input type="url" name="url" aria-label="Site" required>
      <input type="date" name="date" aria-label="Day" required>
      <button>Send</button>
    </form>`,
  "/tab": `${HEAD}
    <form action="/x" method="post">
      <input name="a" aria-label="Alpha">
      <input name="b" aria-label="Beta" tabindex="-1">
      <label><input type="radio" name="r" tabindex="-1"> A</label>
      <label><input type="radio" name="r" tabindex="0" checked> B</label>
      <button disabled>Off</button>
      <button aria-label="Send it">Go</button>
    </form>
    <form action="/y" method="post"><input name="c" aria-label="Gamma"><input type="submit" value="Save"></form>`,
  "/state": `${HEAD}
    <div role="alert">Cookie notice</div>
    <form id="f" action="/x" method="post">
      <input name="a" aria-label="Alpha" required>
      <input name="b" aria-label="Beta" aria-describedby="why" aria-invalid="true">
      <input type="email" name="c" aria-label="Gamma" value="not-an-email">
      <input name="d" aria-label="Delta" aria-invalid="true" aria-errormessage="err">
      <div id="inlive" role="alert"></div>
      <button>Go</button>
    </form>
    <p id="why">Beta must be longer.</p>
    <p id="err">Delta is wrong.</p>
    <div id="live" aria-live="polite">Elsewhere</div>
    <script>
      document.getElementById("f").addEventListener("submit", (e) => e.preventDefault());
      window.addError = () => { document.getElementById("inlive").textContent = "Name is required"; };
      window.addElsewhere = () => { document.getElementById("live").textContent = "Moved"; };
      window.addText = () => { const p = document.createElement("p"); p.textContent = "Check the form"; document.getElementById("f").append(p); };
      window.removeForm = () => document.getElementById("f").remove();
    </script>`,
  "/radios": `${HEAD}
    <form action="/x" method="post"><fieldset><legend>Colour</legend>
      <label><input id="r1" type="radio" name="c" required> Red</label>
      <label><input id="r2" type="radio" name="c"> Blue</label></fieldset><button>Go</button></form>`,
  "/empty": `${HEAD}<form method="post"><input aria-label="Name"><button>Go</button></form>`,
  "/images": `${HEAD}
    <form action="/ok" method="post"><input aria-label="A"><input type="image" src="data:," alt="Go" formaction="mailto:x@example.org"></form>
    <form id="o" action="/ok" method="post"><input aria-label="B"></form>
    <input type="image" form="o" src="data:," alt="Go" formaction="mailto:x@example.org">
    <form action="/ok" method="post"><input aria-label="C"><input type="image" src="data:," alt="Go" formaction="mailto:x@example.org" style="display:none"><button>Real</button></form>
    <form action="/ok" method="post"><input aria-label="D"><input type="image" src="data:," alt="Go" formaction="mailto:x@example.org" disabled><button>Real</button></form>
    <form action="/ok" method="post"><input aria-label="E"><input type="image" src="data:," alt="Go"></form>
    <form id="p" action="/ok" method="post"><input aria-label="F"></form>
    <input type="image" form="p" src="data:," alt="Go">`,
  "/extra": `${HEAD}
    <form action="/ok" method="post"><input aria-label="A"><button formaction="mailto:a@b.gov">Mail</button></form>
    <form method="dialog"><input aria-label="B"><button>Close</button></form>
    <search><form action="/s" method="post"><input aria-label="Q"><input aria-label="R"><button>Go</button></form></search>
    <form action="/ok" method="post"><input aria-label="A"><button formaction="/other">Go</button></form>`,
};

const pageOf = (session: ChromeSession): Page => (session as unknown as { page: Page }).page;

let server: Server;
let origin = "";
const sessions: ChromeSession[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
});

async function open(path: string): Promise<ChromeSession> {
  const session = await launchChrome({
    browser: { channel: "chromium", fallbackToChromium: false },
    env: process.env,
    extraArgs: HEADLESS,
  });
  sessions.push(session);
  await session.load(`${origin}${path}`, 15_000);
  return session;
}

describe.skipIf(!haveChromium)("scanForms", () => {
  it("finds a form's fields, in tab order, with their names and what's required", async () => {
    const forms = await (await open("/one")).scanForms();
    expect(forms.map((form) => form.kind)).toEqual(["test", "test"]);
    expect(forms[0]?.fields).toEqual([
      { index: 0, name: "Your name", type: "text", required: true, tabIndex: 0 },
      { index: 1, name: "Nickname", type: "text", required: true, tabIndex: 0 },
      { index: 2, name: "Anything", type: "text", required: false, tabIndex: 0 },
      { index: 3, name: "Red", type: "radio", required: true, tabIndex: 0 },
      { index: 4, name: "Pick", type: "select-one", required: false, tabIndex: 0 },
      { index: 5, name: "Message", type: "textarea", required: false, tabIndex: 0 },
    ]);
    expect(forms[1]?.fields).toEqual([
      { index: 0, name: "Email", type: "email", required: true, tabIndex: 0 },
    ]);
  });

  it("gives one form on two pages one signature, and two forms two", async () => {
    const one = await (await open("/one")).scanForms();
    const two = await (await open("/two")).scanForms();
    expect(two).toHaveLength(1);
    expect(two[0]?.signature).toBe(one[1]?.signature);
    expect(one[0]?.signature).not.toBe(one[1]?.signature);
  });

  it("sorts each row of the table, and the others stay in the page's order", async () => {
    const session = await open("/kinds");
    const forms = await session.scanForms();
    const summary = (form: FormInfo) => [form.kind, form.site, form.sensitive, form.captcha];
    expect(forms.map(summary)).toEqual([
      ["search", null, false, false],
      ["search", null, false, false],
      ["not-web", null, false, false],
      ["no-submit", null, false, false],
      ["test", null, true, false],
      ["test", null, true, false],
      ["test", null, false, true],
      ["no-submit", null, false, false],
      ["other-site", "docs.google.com", false, false],
    ]);
    expect(forms.map((form) => form.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("counts an empty action as the page's own", async () => {
    const forms = await (await open("/empty")).scanForms();
    expect(forms.map((form) => form.kind)).toEqual(["test"]);
  });

  it("leaves a form whose button sends by mailto:, a dialog form, and one inside <search>", async () => {
    const forms = await (await open("/extra")).scanForms();
    expect(forms.map((form) => form.kind)).toEqual(["not-web", "no-submit", "search", "test"]);
  });

  it("treats an image button as a submit control, and reads every one's formaction", async () => {
    const forms = await (await open("/images")).scanForms();
    // Not-web: an image button, one outside the form (form="o"), a hidden one, a disabled one.
    // Test: an image button as the only submit control, and one outside the form (form="p").
    expect(forms.map((form) => form.kind)).toEqual([
      "not-web",
      "not-web",
      "not-web",
      "not-web",
      "test",
      "test",
    ]);
  });

  it("isn't changed by a page that redefines the built-ins, or names a field after a form's property", async () => {
    const forms = await (await open("/hostile")).scanForms();
    expect(forms.map((form) => form.kind)).toEqual(["test"]);
    expect(forms[0]?.fields.map((field) => field.required)).toEqual([true, false]);
  });

  it("moves no focus, clicks nothing, and changes nothing in the page", async () => {
    const session = await open("/one");
    await pageOf(session).focus("#n");
    const before = await session.focusedElement();
    const html = await pageOf(session).content();
    expect(before?.name).toBe("Your name");
    await session.scanForms();
    expect(await session.focusedElement()).toEqual(before);
    expect(await pageOf(session).content()).toBe(html);
  });
});

describe.skipIf(!haveChromium)("scanForms, for Tab", () => {
  it("gives each field's tabIndex, a radio group's its most reachable, and the submit's name", async () => {
    const [form, other] = await (await open("/tab")).scanForms();
    expect(form?.fields.map((field) => field.tabIndex)).toEqual([0, -1, 0]);
    expect(form?.submitName).toBe("Send it");
    expect(other?.submitName).toBe("Save");
  });
});

describe.skipIf(!haveChromium)("readFormState", () => {
  it("lists the invalid fields, the messages showing, and Chrome's bubble", async () => {
    const session = await open("/state");
    await session.scanForms();
    const state = await session.readFormState(0);
    expect(state.present).toBe(true);
    expect(state.invalid).toEqual([0, 1, 2, 3]);
    // Beta's aria-describedby, Delta's aria-errormessage, and the page's alert; not the live
    // region outside the form.
    expect(state.messages).toEqual(["Beta must be longer.", "Delta is wrong.", "Cookie notice"]);
    expect(state.liveChanged).toBe(false);
    expect(state.heldRequests).toBe(0);
    expect(state.bubble).toBeNull();
    expect(state.focused).toBeNull();
  });

  it("lists the required fields with no value or no choice, and only those", async () => {
    const session = await open("/required");
    await session.scanForms();
    const page = pageOf(session);
    // Empty: text, a radio group with nothing chosen, an unchecked box, a list on its blank option.
    expect((await session.readFormState(0)).emptyRequired).toEqual([0, 1, 2, 3]);
    await page.fill('[name="t"]', "x");
    await page.check('[name="b"]');
    await page.check('[value="two"]');
    expect((await session.readFormState(0)).emptyRequired).toEqual([3]);
    await page.selectOption('[name="l"]', "one");
    expect((await session.readFormState(0)).emptyRequired).toEqual([]);
  });

  it("takes each default value the keyboard types, in real Chromium", async () => {
    const session = await open("/typed");
    await session.scanForms();
    const page = pageOf(session);
    for (const name of ["number", "url", "date"]) {
      await page.focus(`[name="${name}"]`);
      await page.keyboard.type(FORMS_DEFAULTS.values[name] ?? "");
    }
    expect((await session.readFormState(0)).emptyRequired).toEqual([]);
    expect((await session.readFormState(0)).invalid).toEqual([]);
    expect(await page.inputValue('[name="date"]')).toBe("2026-01-01");
  });

  it("says which field has focus, a radio group's one index for any radio, and which is a submit", async () => {
    const session = await open("/focus");
    await session.scanForms();
    const page = pageOf(session);
    expect((await session.readFormState(0)).focusedField).toBeNull();
    await page.focus('[name="a"]');
    expect(await session.readFormState(0)).toMatchObject({ focusedField: 0, focusedSubmit: false });
    await page.focus('[value="b"]');
    expect((await session.readFormState(0)).focusedField).toBe(1);
    await page.focus("#help");
    expect(await session.readFormState(0)).toMatchObject({
      focusedField: null,
      focusedSubmit: false,
    });
    await page.focus("#go");
    expect(await session.readFormState(0)).toMatchObject({
      focusedField: null,
      focusedSubmit: true,
    });
  });

  it("shows a hint both before and after, and a new error only after", async () => {
    const session = await open("/state");
    await session.scanForms();
    const before = await session.readFormState(0);
    await pageOf(session).evaluate("addError()");
    const after = await session.readFormState(0);
    for (const hint of ["Beta must be longer.", "Delta is wrong.", "Cookie notice"]) {
      expect(before.messages).toContain(hint);
      expect(after.messages).toContain(hint);
    }
    expect(before.messages).not.toContain("Name is required");
    expect(after.messages).toContain("Name is required");
  });

  it("reads the focused field's own validation message", async () => {
    const session = await open("/state");
    await session.scanForms();
    await session.pressTab();
    const state = await session.readFormState(0);
    expect(state.focused?.name).toBe("Alpha");
    expect(state.bubble).toMatch(/fill (in|out) this field/i);
  });

  it("gives the bubble whichever radio of a group has focus", async () => {
    const session = await open("/radios");
    await session.scanForms();
    await pageOf(session).focus("#r2");
    expect((await session.readFormState(0)).bubble).toMatch(/select one of these options/i);
  });

  it("counts a live region's change once, and keeps the text added to the form", async () => {
    const session = await open("/state");
    await session.scanForms();
    await pageOf(session).evaluate("addElsewhere()");
    const elsewhere = await session.readFormState(0);
    expect(elsewhere.liveChanged).toBe(true);
    expect(elsewhere.messages).not.toContain("Moved");
    expect((await session.readFormState(0)).liveChanged).toBe(false);
    await pageOf(session).evaluate("addText()");
    expect((await session.readFormState(0)).messages).toContain("Check the form");
    expect((await session.readFormState(0)).messages).toContain("Check the form");
  });

  it("says the form is gone when it's removed, and when there is no such form", async () => {
    const session = await open("/state");
    await session.scanForms();
    await pageOf(session).evaluate("removeForm()");
    expect((await session.readFormState(0)).present).toBe(false);
    expect((await session.readFormState(9)).present).toBe(false);
  });
});
