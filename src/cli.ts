#!/usr/bin/env node
import { main } from "./cli/main.js";
import { guardProgramSearch } from "./util/system-tools.js";

// Before anything starts a program: Windows looks in the folder voicecap runs in first for one
// started by name (git, say), unless it's told not to.
guardProgramSearch();

const code = await main(process.argv.slice(2));
process.exitCode = code;
// Exit even if something (a hung browser, say) still holds the event loop open.
setTimeout(() => process.exit(code), 2000).unref();
