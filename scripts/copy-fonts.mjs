// After the TypeScript build: copy the shareable page's fonts, and their licence, from
// src/share/fonts/ to dist/share/fonts/, beside the built src/share/fonts.ts, which reads them
// from there. The copy replaces what was there, so it's exactly the source's. Plain Node, so the
// build needs nothing more to run it.
import { cp, rm } from "node:fs/promises";
import { URL } from "node:url";

const from = new URL("../src/share/fonts/", import.meta.url);
const to = new URL("../dist/share/fonts/", import.meta.url);

await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
