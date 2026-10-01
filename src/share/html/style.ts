/**
 * The shareable page's one style block: the approved mockup's, ported, with the fonts embedded
 * ahead of it (see ../fonts.ts) in place of its Google Fonts link. It's dark by default, light when
 * the reader switches (`data-theme="light"` on the root), and light in print, where the page's
 * script has opened every fold first.
 *
 * It is the page's only styling: the page sets no `style` attribute, since a Content Security
 * Policy that hashes this block allows nothing else. So where the mockup set a style attribute,
 * there's a rule here, and so for what each section's markup added; each was checked with axe in
 * Chromium, in both themes, at 1100 and 390 pixels, and the page's fit at 320. Beyond the mockup's
 * own rules:
 * - only the hidden attribute shows or hides what a script shows (`[hidden]`), and the check's
 *   result is never `display: none` when empty, so a screen reader announces what it finds;
 * - "Not recorded" lines (`.not-recorded`), and the margins the mockup gave by attribute;
 * - colors axe needs: a solid background behind "When to run voicecap", a darker green for chips
 *   in the light theme, and red, not green, behind the words a removed line lost;
 * - the transcript's box scrolls, not the text in it (the box is what a keyboard reaches), and in
 *   print no box scrolls or cuts anything short, since paper can't scroll;
 * - long words in tables wrap at a phone's width, and the timeline's table fits its box down to 320
 *   pixels (closer columns, no dots, smaller type), so nothing in it is cut off at the box's edge;
 * - a name is a whole address, or a host, and can be one word longer than any box: the text it can
 *   be in (paragraphs, list items, headings, a fold's line, terms and what they mean, captions, the
 *   command that verifies the records, the site's name and address) breaks it where it must
 *   (`overflow-wrap: anywhere`), rather than run out of its box or the window;
 * - every grid of cards, tiles, or steps asks for columns no wider than its own box
 *   (`minmax(min(300px, 100%), 1fr)`), so nothing runs past a window 320 pixels wide, where WCAG's
 *   reflow rule is measured;
 * - the folds' triangle is drawn but not read aloud.
 *
 * Nothing from the mockup's samples (`.mock`) is here.
 */
export const SHARE_CSS = `/* Layout: an instrument panel for evidence — the verdict band first, then every page, then the run's own proof. */
:root {
  --bg: #0b1015; --panel: #10171f; --panel-2: #151e28; --line: #243242;
  --fg: #e6edf3; --muted: #9aabbd; --accent: #72b7ff;
  --ok: #4cc38a; --warn: #f0b23e; --bad: #f27575; --mac: #b99cff;
  --display: "IBM Plex Sans Condensed", "Arial Narrow", "Segoe UI", system-ui, sans-serif;
  --body: "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  color-scheme: dark;
}
:root[data-theme="light"] {
  --bg: #ffffff; --panel: #f5f7fa; --panel-2: #edf1f5; --line: #d5dde6;
  --fg: #0e1621; --muted: #4b5b6c; --accent: #1d63c9;
  --ok: #187a51; --warn: #8f5c00; --bad: #c0392b; --mac: #6a3fc9;
  color-scheme: light;
}
@media print { :root { --bg: #fff; --panel: #fff; --panel-2: #f3f5f8; --line: #cfd7e0; --fg: #0e1621; --muted: #445566; --accent: #1d63c9; --ok: #1a7f55; --warn: #8f5c00; --bad: #c0392b; --mac: #6a3fc9; color-scheme: light; } .theme { display: none; } }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); padding-inline: 16px; }
.wrap { max-width: 1120px; margin-inline: auto; padding-block: 24px 64px; display: grid; gap: 56px; }
.wrap > *, .run > *, .glance > *, main > *, .folds > *, details.fold > .inside > * { min-width: 0; }
main { display: grid; gap: 56px; }
/* A name is a whole address (or a host), one word that can be longer than any box: break it there, rather than run out of the box or the window. The masthead and the verify command do the same, where they are. */
main :where(p, li, h3, summary, dt, dd, figcaption) { overflow-wrap: anywhere; }
a { color: var(--accent); } a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.skip { position: absolute; left: -9999px; } .skip:focus { left: 16px; top: 16px; background: var(--panel); padding: 8px 12px; z-index: 5; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* Only the hidden attribute shows or hides what a script does: the top's two buttons, the check's buttons and list, the no-script line. */
[hidden] { display: none !important; }
h1, h2, h3 { font-family: var(--display); text-wrap: balance; letter-spacing: 0.005em; }
h2 { font-size: 1.6rem; font-weight: 600; margin: 0 0 6px; }
h3 { font-size: 1.12rem; font-weight: 600; margin: 0; }
.eyebrow { font: 500 0.78rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.lead { font-size: 1.08rem; max-width: 68ch; margin: 0; }
.sub { color: var(--muted); font: 400 0.82rem var(--body); }
.not-recorded { margin: 0; color: var(--muted); font-style: italic; }
.mono, code { font-family: var(--mono); font-size: 0.86em; }
code { overflow-wrap: anywhere; }
/* masthead */
.mast { display: grid; gap: 14px; border-bottom: 1px solid var(--line); padding-bottom: 28px; }
.mast-top { display: flex; flex-wrap: wrap; gap: 10px 16px; justify-content: space-between; align-items: center; }
.mast h1 { font-size: clamp(2.2rem, 6vw, 3.6rem); line-height: 1.02; margin: 4px 0 0; font-weight: 700; overflow-wrap: anywhere; }
.mast-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--muted); font-size: 0.92rem; }
.mast-meta b { color: var(--fg); font-weight: 500; }
.mast-lead { font-size: 1.1rem; color: var(--muted); margin: 0; max-width: 60ch; }
.mast-meta .addr { font-family: var(--mono); font-size: 0.8rem; align-self: center; overflow-wrap: anywhere; }
.file { font-family: var(--mono); font-size: 0.8rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px; }
.file span { border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; background: var(--panel); }
.theme { border: 1px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 999px; padding: 6px 14px; font: 500 0.82rem var(--body); cursor: pointer; }
/* summary */
.glance { display: grid; gap: 22px; }
.verdict { font-size: 1.3rem; line-height: 1.45; font-weight: 500; max-width: 60ch; }
.verdict + .gist { margin: 10px 0 0; }
.panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 12px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; display: grid; gap: 6px; align-content: start; }
.panel h3 { font-size: 0.95rem; }
.panel p, .panel ul { margin: 0; font-size: 0.93rem; }
.panel ul { padding-left: 18px; display: grid; gap: 4px; }
.panel.attention { border-color: color-mix(in srgb, var(--warn) 55%, var(--line)); }
.panel.attention h3 { color: var(--warn); }
.toc { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; border-top: 1px solid var(--line); padding-top: 14px; }
.toc a { font-weight: 500; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr)); gap: 12px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 16px 14px; display: grid; gap: 4px; align-content: start; }
.tile .n { font: 700 2.5rem/1 var(--display); font-variant-numeric: tabular-nums; }
.tile .n small { font-size: 1.1rem; color: var(--muted); font-weight: 500; }
.tile .k { color: var(--muted); font-size: 0.86rem; }
.tile.ok .n { color: var(--ok); } .tile.warn .n { color: var(--warn); } .tile.quiet .n { color: var(--fg); }
.meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 16px; }
.meter { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: grid; gap: 10px; }
.meter h3 { font-size: 0.95rem; }
.bar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: var(--panel-2); }
.bar i { display: block; height: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.84rem; color: var(--muted); }
.legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; background: currentColor; vertical-align: -1px; }
.legend .l-ok { color: var(--ok); } .legend .l-warn { color: var(--warn); } .legend .l-bad { color: var(--bad); } .legend .l-q { color: var(--muted); }
.legend span b { color: var(--fg); font-weight: 500; }
.rules { display: grid; gap: 8px; }
.rule { display: grid; grid-template-columns: 150px 1fr 36px; gap: 10px; align-items: center; font-size: 0.86rem; }
.rule .track { height: 10px; background: var(--panel-2); border-radius: 5px; overflow: hidden; } .rule .track i { display: block; height: 100%; background: var(--warn); }
.rule .c { font-variant-numeric: tabular-nums; text-align: right; color: var(--muted); }
/* chips */
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: 500 0.74rem/1.2 var(--mono); padding: 4px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel-2); }
.c-ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); }
.c-bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }
.c-warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--line)); }
.c-quiet { color: var(--muted); }
/* pages */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 16px; }
.cards + .folds, .cards + .panel, .folds + .panel { margin-top: 16px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: grid; grid-template-rows: auto 1fr; min-width: 0; }
.card img { width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: cover; object-position: top; border-bottom: 1px solid var(--line); background: #fff; }
.card-body { padding: 14px 16px 16px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.card-body p { margin: 0; }
.num { display: inline-grid; place-items: center; min-width: 1.6em; height: 1.6em; border-radius: 6px; background: var(--panel-2); border: 1px solid var(--line); font: 600 0.8rem var(--mono); margin-right: 6px; }
.passes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 0; }
.passes div { background: var(--panel-2); border-radius: 8px; padding: 6px 8px; }
.passes dt { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.passes dd { margin: 0; font: 600 0.95rem var(--display); font-variant-numeric: tabular-nums; }
.strip-fig { margin: 0; display: grid; gap: 4px; } .strip { width: 100%; height: 36px; display: block; } .strip rect { fill: var(--accent); opacity: 0.85; }
.strip-fig figcaption { font-size: 0.74rem; color: var(--muted); }
.more { font-size: 0.86rem; }
/* findings, tables */
.finding { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: grid; gap: 12px; }
.scroll { overflow-x: auto; }
table.plain { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
table.plain th, table.plain td { text-align: left; padding: 9px 10px; border-top: 1px solid var(--line); vertical-align: top; }
table.plain thead th { border-top: 0; color: var(--muted); font: 500 0.74rem var(--mono); text-transform: uppercase; letter-spacing: 0.06em; }
.panel table.plain th, .panel table.plain td { overflow-wrap: anywhere; }
td.said code { display: inline-block; background: var(--panel-2); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; margin: 2px 0; }
.limits { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 16px; margin-top: 14px; }
.limits > div { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.limits ul { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 6px; }
/* evidence */
.run { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; display: grid; gap: 22px; }
.run-head { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline; justify-content: space-between; }
.run-inside h3 { margin-bottom: 8px; }
.run-inside table.plain td { overflow-wrap: anywhere; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 10px; }
.facts div { background: var(--panel-2); border-radius: 10px; padding: 10px 12px; }
.facts dt { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.facts dd { margin: 2px 0 0; font: 600 1.05rem var(--display); }
.timeline { width: 100%; min-width: 760px; height: auto; display: block; }
.timeline .grid { stroke: var(--line); stroke-width: 1; }
.timeline .t-axis { fill: var(--muted); font: 11.5px var(--mono); }
.timeline .t-lane { fill: var(--fg); font: 600 12.5px var(--body); }
.timeline .t-in { fill: var(--bg); font: 600 11.5px var(--mono); }
.timeline .t-note { fill: var(--muted); font: 11.5px var(--body); }
.timeline .t-fail { fill: var(--bad); font: 600 11.5px var(--body); }
.timeline .b-lock { fill: var(--accent); } .timeline .b-nvda { fill: var(--ok); } .timeline .b-page { fill: var(--muted); } .timeline .b-fail { fill: var(--bad); } .timeline .b-own { fill: var(--panel-2); stroke: var(--muted); stroke-dasharray: 3 3; }
.timeline .fail-line { stroke: var(--bad); stroke-width: 1.5; stroke-dasharray: 4 4; }
details.log > summary, details.tx-page > summary { cursor: pointer; }
.events { max-height: 360px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; }
.events td { padding: 6px 10px; border-top: 1px solid var(--line); font-size: 0.86rem; }
.ev-fail td { color: var(--bad); } .ev-own td { color: var(--warn); } .ev-lock td { color: var(--accent); }
.cross { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 10px; }
.cross div { border: 1px dashed var(--line); border-radius: 10px; padding: 12px; }
.cross .big { font: 700 1.8rem/1 var(--display); }
dl.spec { display: grid; grid-template-columns: minmax(150px, 230px) 1fr; margin: 0; border-top: 1px solid var(--line); }
dl.spec dt, dl.spec dd { padding: 9px 10px; border-bottom: 1px solid var(--line); margin: 0; font-size: 0.9rem; }
dl.spec dt { color: var(--muted); }
.hashes code { color: var(--fg); }
.verify { background: var(--panel-2); border-radius: 10px; padding: 12px 14px; font-size: 0.9rem; display: grid; gap: 6px; }
.scroll + .verify { margin-top: 12px; }
.verify pre { margin: 0; font: 0.84rem var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
/* transcripts */
.appendix { display: grid; gap: 10px; }
.appendix details { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.appendix summary { padding: 12px 16px; font: 600 1rem var(--display); cursor: pointer; }
.tx-grid { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 18px; padding: 0 16px 16px; }
.inside > .tx-grid { padding: 0; }
.tx-grid > img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.tx h3 { margin: 10px 0 2px; font: 600 0.95rem var(--display); }
.fp { margin: 0 0 6px; font-size: 0.78rem; color: var(--muted); }
.tx pre { margin: 0; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font: 0.8rem/1.55 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.tx .scroll { max-height: 280px; overflow: auto; }
footer { color: var(--muted); font-size: 0.84rem; border-top: 1px solid var(--line); padding-top: 18px; display: grid; gap: 6px; }
/* collapsed parts: a line that says what's inside, opened with a click (or all at once, or for printing) */
details.fold { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
details.fold > summary { list-style: none; cursor: pointer; padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::before { content: "▸"; content: "▸" / ""; color: var(--muted); font-size: 0.9rem; transition: transform 0.15s; }
details.fold[open] > summary::before { transform: rotate(90deg); }
details.fold > summary .what { font: 600 1rem var(--display); }
details.fold > .inside { padding: 0 16px 16px; display: grid; gap: 14px; }
details.fold > .inside > p { margin: 0; }
.folds { display: grid; gap: 10px; }
details.fold > .run-inside { gap: 22px; }
.gist { margin: 0 0 16px; color: var(--muted); max-width: 70ch; }
.gist b { color: var(--fg); font-weight: 500; }
/* how voicecap works */
.flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 12px; }
.flow li { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: grid; grid-template-columns: 44px 1fr; gap: 4px 14px; align-content: start; }
.flow .ico { grid-row: span 2; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 16%, var(--panel-2)); color: var(--accent); }
.flow .ico svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.flow h3 { font-size: 1.02rem; }
.step-n { font: 600 0.85rem var(--mono); color: var(--accent); margin-right: 4px; }
.flow p { margin: 0; font-size: 0.92rem; }
.heard { margin-top: 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; display: grid; gap: 12px; }
.heard h3 { font-size: 1rem; }
.heard > .sub { margin: 0; }
.lanes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 14px; }
.lane { margin: 0; display: grid; gap: 8px; align-content: start; }
.lane figcaption { font-size: 0.86rem; color: var(--muted); display: flex; gap: 8px; align-items: center; }
kbd { font: 600 0.8rem var(--mono); border: 1px solid var(--line); border-bottom-width: 3px; border-radius: 6px; padding: 2px 8px; background: var(--panel-2); color: var(--fg); }
.said-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.said-list li { background: var(--panel-2); border-left: 3px solid var(--accent); border-radius: 6px; padding: 6px 10px; font-size: 0.88rem; display: flex; justify-content: space-between; gap: 10px; }
.said-list .t { color: var(--muted); font: 0.74rem var(--mono); white-space: nowrap; }
/* when to run it */
.when { margin-top: 14px; border: 1px solid color-mix(in srgb, var(--warn) 50%, var(--line)); background: color-mix(in srgb, var(--warn) 4%, var(--panel)); border-radius: 14px; padding: 18px; display: grid; gap: 12px; }
.when-title { font: 700 clamp(1.35rem, 3.2vw, 1.8rem)/1.2 var(--display); margin: 0; }
.when-title span { color: var(--warn); }
.when-lead { margin: 0; color: var(--muted); max-width: 72ch; }
.stages { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 12px; }
.stages li { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: grid; gap: 7px; align-content: start; }
.stages li b { font: 600 1.02rem var(--display); }
.stages .st { font-size: 0.88rem; color: var(--muted); }
.stages .chip { justify-self: start; }
.stages li.stage-skip { border-style: dashed; opacity: 0.85; }
.stages li.run { border: 2px solid var(--warn); }
.run-chip { background: var(--warn); color: var(--bg); border-color: var(--warn); font-weight: 600; }
/* problems */
.prob-verdict { font-size: 1.12rem; max-width: 64ch; margin: 0 0 14px; }
details.problem { border-left: 4px solid var(--warn); }
details.kinds th, details.kinds td { overflow-wrap: anywhere; }
dl.qa { display: grid; grid-template-columns: minmax(140px, 200px) 1fr; margin: 0; }
dl.qa dt, dl.qa dd { padding: 8px 10px; border-top: 1px solid var(--line); margin: 0; font-size: 0.92rem; }
dl.qa dt { color: var(--muted); }
.logh { margin: 0 0 6px; font: 600 0.92rem var(--display); display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.logblock { margin: 0; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font: 0.78rem/1.65 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
table.logtable { width: 100%; border-collapse: collapse; font: 0.78rem/1.55 var(--mono); background: var(--bg); border: 1px solid var(--line); }
table.logtable th { text-align: left; color: var(--muted); font-weight: 500; padding: 6px 10px; border-bottom: 1px solid var(--line); }
table.logtable td { padding: 3px 10px; vertical-align: top; overflow-wrap: anywhere; }
table.logtable td.lt { white-space: nowrap; color: var(--muted); } table.logtable td.src { white-space: nowrap; color: var(--accent); }
table.logtable tr.err td:last-child { color: var(--bad); }
/* what changed */
table.difftable { width: 100%; border-collapse: collapse; font: 0.84rem/1.55 var(--mono); background: var(--bg); border: 1px solid var(--line); }
table.difftable th { text-align: left; color: var(--muted); font-weight: 500; padding: 6px 10px; border-bottom: 1px solid var(--line); }
table.difftable td { padding: 4px 10px; vertical-align: top; }
table.difftable td:first-child { white-space: nowrap; width: 9ch; }
table.difftable tr.same td { color: var(--muted); font-style: italic; }
table.difftable tr.del td { background: color-mix(in srgb, var(--bad) 12%, transparent); } table.difftable tr.del td:last-child { text-decoration: line-through; }
table.difftable tr.add td { background: color-mix(in srgb, var(--ok) 12%, transparent); }
table.difftable mark { background: color-mix(in srgb, var(--ok) 35%, transparent); color: inherit; border-radius: 3px; padding: 0 2px; }
table.difftable tr.del mark { background: color-mix(in srgb, var(--bad) 35%, transparent); }
/* the fingerprint check */
.fp-check { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: grid; gap: 12px; margin-bottom: 14px; }
.fp-what { margin: 0; max-width: 72ch; }
.fp-row { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
.fp-button { border: 1px solid color-mix(in srgb, var(--accent) 60%, var(--line)); background: color-mix(in srgb, var(--accent) 16%, var(--panel)); color: var(--fg); border-radius: 10px; padding: 9px 16px; font: 600 0.95rem var(--body); cursor: pointer; }
.fp-demo { background: none; border: 0; color: var(--accent); text-decoration: underline; font: 500 0.9rem var(--body); cursor: pointer; padding: 4px 2px; }
.fp-result { margin: 0; font-weight: 500; }
.fp-result.good { color: var(--ok); } .fp-result.bad { color: var(--bad); }
.fp-limit { margin: 0; max-width: 84ch; }
/* the story */
#story-h + .gist { color: var(--fg); }
table.tracks { width: 100%; min-width: 540px; border-collapse: separate; border-spacing: 8px 8px; margin: 4px -8px 10px; font-size: 0.92rem; }
table.tracks caption { text-align: left; font: 600 1.02rem var(--display); padding: 0 8px 2px; }
table.tracks thead th { text-align: left; color: var(--muted); font: 500 0.74rem var(--mono); text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 10px 0; }
table.tracks tbody th { text-align: left; vertical-align: top; white-space: nowrap; font: 600 0.8rem var(--mono); color: var(--accent); padding: 11px 10px 10px 22px; position: relative; width: 7.5em; }
table.tracks tbody th::before { content: ""; position: absolute; left: 4px; top: 14px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
table.tracks td { vertical-align: top; padding: 10px 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
table.tracks td.pc { border-left: 3px solid var(--accent); } table.tracks td.mac { border-left: 3px solid var(--mac); } table.tracks td.both { border-left: 3px solid var(--ok); }
table.tracks td.none { background: transparent; border: 1px dashed var(--line); } table.tracks td.next { border-style: dashed; border-left-style: solid; }
.plat.pc { color: var(--accent); } .plat.mac { color: var(--mac); } .plat { font-weight: 600; }
.days { list-style: none; margin: 0; padding: 2px 0 0 20px; border-left: 2px solid var(--line); display: grid; gap: 14px; align-content: start; align-self: start; }
.days li { position: relative; font-size: 0.92rem; }
.days li::before { content: ""; position: absolute; left: -27px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg); }
.days time { display: block; font: 600 0.8rem var(--mono); color: var(--accent); }
.worth { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 12px; }
.worth div { background: var(--panel-2); border-radius: 12px; padding: 14px 16px; }
.worth h3 { font-size: 0.98rem; margin-bottom: 4px; }
.worth p { margin: 0; font-size: 0.9rem; }
.cite { font-size: 0.84rem; color: var(--muted); }
@media (max-width: 640px) { .tx-grid { grid-template-columns: 1fr; } dl.spec, dl.qa { grid-template-columns: 1fr; } dl.spec dt, dl.qa dt { border-bottom: 0; padding-bottom: 0; } dl.qa dd { border-top: 0; padding-top: 2px; } .rule { grid-template-columns: 120px 1fr 30px; } .passes { grid-template-columns: repeat(2, 1fr); } table.tracks { min-width: 0; } table.tracks tbody th { white-space: normal; width: auto; } table.tracks td { padding: 8px; } }
/* At a phone's width, down to 320 pixels, the timeline's three columns fit their box: closer together, inside it, without the dots, and in smaller type. */
@media (max-width: 400px) { table.tracks { border-spacing: 4px 6px; margin: 4px 0 10px; font-size: 0.86rem; } table.tracks caption { padding: 0 0 2px; } table.tracks thead th { padding: 4px 4px 0; letter-spacing: 0.02em; } table.tracks tbody th { padding: 8px 4px; font-size: 0.74rem; } table.tracks tbody th::before { display: none; } table.tracks td { padding: 8px 6px; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
/* Paper doesn't scroll: in print, every box shows all it holds. After the rules that limit the boxes, so it wins. */
@media print { .scroll, .tx .scroll, .events { max-height: none; overflow: visible; } }
`;
