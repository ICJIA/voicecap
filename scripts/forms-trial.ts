/**
 * The forms pass's trial (Task 0 of docs/superpowers/plans/2026-10-30-forms-pass.md): real NVDA on
 * two local pages, through the same driver and Guidepup calls the pass would use, to learn what the
 * design can't know from here. Windows only, and only when the owner starts it. Nothing leaves the
 * computer: the pages are the fixture's, on 127.0.0.1, and their scripts stop every submit.
 *
 *   pnpm forms:trial
 *
 * It answers:
 * - does NVDA read Chrome's own validation bubble (the native page, pressed empty)?
 * - does Enter reach the submit button through NVDA, and how long do its words take to come?
 * - do typing, Space, and arrow keys reach fields through Guidepup, and what does NVDA say?
 *
 * It writes what NVDA said to docs/forms-trial-notes.md. NVDA speaks, and browser windows come and
 * go, for about 3 minutes: nobody may use the computer.
 */
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { resolveConfig } from "../src/config/load.js";
import { createGuidepupNvdaDriver } from "../src/drivers/guidepup-nvda.js";
import { handleInterrupts } from "../src/run/signals.js";
import { errorMessage } from "../src/util/errors.js";
import { createConsoleLogger } from "../src/util/log.js";
import { FIXTURE_PORT, startFixtureServer } from "./serve-fixture.js";

const NOTES = "docs/forms-trial-notes.md";
/** How long to go on listening after a press: errors can come a moment later. */
const SETTLE_MS = [500, 1500, 3000, 6000];

interface Keys {
  press(key: string): Promise<void>;
  type(text: string): Promise<void>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
}

const lines: string[] = [];
const note = (line: string): void => {
  console.log(line);
  lines.push(line);
};

/** Note what the driver gave for a Tab, which it has taken out of NVDA's log by then. */
async function tabHeard(what: string, tab: () => Promise<string>): Promise<void> {
  try {
    const spoken = await tab();
    note(`- **${what}:** ${spoken === "" ? "NVDA said nothing." : `"${spoken}"`}`);
  } catch (error) {
    note(`- **${what}: failed.** ${errorMessage(error)}`);
  }
}

/** What NVDA says after `action`, a list of what it had said at each moment of SETTLE_MS. */
async function heard(nvda: Keys, what: string, action: () => Promise<void>): Promise<void> {
  await nvda.clearSpokenPhraseLog();
  const began = performance.now();
  try {
    await action();
  } catch (error) {
    note(`- **${what}: failed.** ${errorMessage(error)}`);
    return;
  }
  const seen = new Set<string>();
  const said: string[] = [];
  for (const ms of SETTLE_MS) {
    await delay(Math.max(0, ms - (performance.now() - began)));
    for (const phrase of await nvda.spokenPhraseLog()) {
      if (!seen.has(phrase)) {
        seen.add(phrase);
        said.push(`"${phrase}" (by ${ms} ms)`);
      }
    }
  }
  note(`- **${what}:** ${said.length === 0 ? "NVDA said nothing." : said.join("; ")}`);
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    console.error("The forms trial runs real NVDA, so it needs Windows.");
    process.exitCode = 2;
    return;
  }
  const logger = createConsoleLogger();
  const server = await startFixtureServer({ port: FIXTURE_PORT });
  const controller = new AbortController();
  const unhook = handleInterrupts(controller, logger);
  const driver = createGuidepupNvdaDriver({ config: resolveConfig({}), logger });
  const { nvda } = (await import("@guidepup/guidepup")) as unknown as { nvda: Keys };
  const tab = async (): Promise<void> => {
    await driver.nextFocusable();
  };
  /** From a page's top, Tab to each of its six stops, the last of them the submit button. */
  const toSubmit = async (): Promise<void> => {
    for (let stop = 0; stop < 6; stop++) await tab();
  };
  try {
    await driver.start();
    const site = `http://127.0.0.1:${FIXTURE_PORT}`;
    note("# Forms trial");
    note("");
    note(`Run on ${new Date().toISOString()}, on ${process.platform}, by \`pnpm forms:trial\`.`);

    note("");
    note("## Each field, by Tab");
    await driver.openPage(`${site}/form-trial/`);
    for (const name of ["name", "email", "radio", "list", "check box", "button"]) {
      await tabHeard(`Tab to the ${name}`, () => driver.nextFocusable());
    }

    note("");
    note("## Pressed empty: a page's own error, in an alert");
    await driver.openPage(`${site}/form-trial/`);
    await toSubmit();
    await heard(nvda, "Enter", () => nvda.press("Enter"));

    note("");
    note("## Pressed empty: Chrome's own bubble");
    await driver.openPage(`${site}/form-trial/native/`);
    await toSubmit();
    await heard(nvda, "Enter", () => nvda.press("Enter"));

    note("");
    note("## Filled by keyboard");
    await driver.openPage(`${site}/form-trial/`);
    await tab();
    await heard(nvda, "Type a name", () => nvda.type("voicecap test"));
    await tab();
    await heard(nvda, "Type an email", () => nvda.type("test@example.com"));
    await tab();
    await heard(nvda, "Space on the radio", () => nvda.press("Space"));
    await tab();
    await heard(nvda, "Down Arrow on the list", () => nvda.press("ArrowDown"));
    await tab();
    await heard(nvda, "Space on the check box", () => nvda.press("Space"));
    await tab();
    await heard(nvda, "Enter on the button", () => nvda.press("Enter"));
    note("");
    note('"Ready to send." among the last words means the keys reached every field.');
  } catch (error) {
    note("");
    note(`**The trial stopped:** ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await driver.stop();
    unhook();
    await server.close();
    await writeFile(NOTES, `${lines.join("\n")}\n`);
    console.log(`Wrote ${NOTES}.`);
  }
}

await main();
