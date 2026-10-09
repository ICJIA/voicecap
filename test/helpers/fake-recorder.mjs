/**
 * A stand-in for the recorder's helper (RECORDER_SCRIPT, in src/drivers/guidepup/voice-recorder.ts)
 * for its client's tests: a Node script that speaks the same JSON lines on its standard input and
 * output, and records nothing. What it does is scripted by its one argument, a JSON object:
 *
 *   - failed: the reason it gives in place of saying it's ready; then it exits with code 1;
 *   - ready: false, to never say it's ready;
 *   - stderr: what it writes to its error output, after its first line;
 *   - exit: an exit code it ends with at once, having written those, in place of answering anything;
 *   - stopped: what it answers each stop with (a RecorderStop);
 *   - stopErrors: the errors it answers its first stops with, one a stop, before it answers stopped;
 *   - exitedAfterStart: true, to say its target exited as soon as it has answered a start, once;
 *   - ignore: the commands it never answers, by name ("target", "start", "stop", or "quit");
 *   - exitOn: a command it ends on, by name, with exit code 3, after saying so on its error output;
 *   - stay: true, to never end on its own: not on a quit, and not when its input ends.
 *
 * Before anything else, it echoes each line it reads: {"read":<the command>,"line":<the line as it
 * came>}. The client doesn't know that line and skips it, and a test that watches the fake's output
 * sees what it was sent. It writes every line as the real helper does, in ASCII alone.
 *
 * It's plain Node, started with `node`, so it imports what Node has as globals: eslint.config.js
 * gives a plain .mjs file none of them.
 */
import process from "node:process";
import { createInterface } from "node:readline";
import { setInterval } from "node:timers";

const script = JSON.parse(process.argv[2] ?? "{}");

/** What a stop is answered with when the script doesn't say. */
const STOPPED = {
  frames: 16_000,
  lostMs: 0,
  peak: 1_200,
  firstSampleAt: "2026-10-09T14:03:07.215Z",
  targetExited: false,
};

/** Writes `value` as one line of JSON in ASCII alone: asciiJson, as the real helper writes it. */
function send(value) {
  const json = JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  process.stdout.write(`${json}\n`);
}

/** Ends the fake with `code` once what it has written has gone, as a program that exits does. */
function end(lines, code) {
  process.exitCode = code;
  lines.close();
  process.stdin.destroy();
}

if (typeof script.failed === "string") {
  send({ failed: script.failed });
  if (script.stderr) process.stderr.write(script.stderr);
  process.exitCode = 1;
} else {
  if (script.ready !== false) send({ ready: { build: 26200 } });
  if (script.stderr) process.stderr.write(script.stderr);
  if (typeof script.exit === "number") process.exitCode = script.exit;
  else serve();
}

/** Answers each command on the input, as the script says, until the input ends. */
function serve() {
  const ignore = new Set(script.ignore ?? []);
  const stopErrors = [...(script.stopErrors ?? [])];
  let target = null;
  let exitSaid = false;
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const command = JSON.parse(line);
    send({ read: command, line });
    const [name] = Object.keys(command);
    if (name === script.exitOn) {
      process.stderr.write(`The fake recorder ended on ${name}.\r\n`);
      end(lines, 3);
      return;
    }
    if (ignore.has(name)) return;
    if (name === "target") {
      target = command.target.pid;
      send({ targeted: { pid: target } });
    } else if (name === "start") {
      send({ started: { at: STOPPED.firstSampleAt } });
      if (script.exitedAfterStart === true && !exitSaid) {
        exitSaid = true;
        send({ "target-exited": { pid: target } });
      }
    } else if (name === "stop") {
      const error = stopErrors.shift();
      send(error === undefined ? { stopped: script.stopped ?? STOPPED } : { error });
    } else if (name === "quit") {
      end(lines, 0);
    }
  });
  lines.on("close", () => {
    // A helper that outlives its input, or a quit, runs until it's killed.
    if (script.stay === true) setInterval(() => {}, 60_000);
  });
}
