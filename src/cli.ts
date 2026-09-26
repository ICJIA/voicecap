#!/usr/bin/env node
import { main } from "./cli/main.js";

const code = await main(process.argv.slice(2));
process.exitCode = code;
// Exit even if something (a hung browser, say) still holds the event loop open.
setTimeout(() => process.exit(code), 2000).unref();
