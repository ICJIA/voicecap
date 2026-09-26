/**
 * The report's inline stylesheet. Colors are chosen for at least 4.5:1 text contrast (7:1 for
 * body text) in both schemes; the a11y test runs axe against light and dark.
 */
export const REPORT_CSS = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1b1b1b;
  --muted: #4d4d4d;
  --border: #767676;
  --rule: #d0d0d0;
  --surface: #f3f3f3;
  --stripe: #f8f8f8;
  --link: #0b57d0;
  --visited: #6a1b9a;
  --focus: #0b57d0;
  --focus-halo: #ffffff;
  --danger-bg: #fde8e8;
  --danger-fg: #5c0f0f;
  --danger-border: #b3261e;
  --warning-bg: #fff4ce;
  --warning-fg: #3d2c00;
  --warning-border: #8a6100;
  --info-bg: #e8f0fe;
  --info-fg: #0b2a5c;
  --info-border: #0b57d0;
  --bad: #b3261e;
  --good: #1e6b30;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121212;
    --fg: #e8e8e8;
    --muted: #bdbdbd;
    --border: #8f8f8f;
    --rule: #3a3a3a;
    --surface: #1f1f1f;
    --stripe: #181818;
    --link: #8ab4f8;
    --visited: #d7aefb;
    --focus: #8ab4f8;
    --focus-halo: #121212;
    --danger-bg: #3d1212;
    --danger-fg: #ffd6d6;
    --danger-border: #ff8a80;
    --warning-bg: #3a2e00;
    --warning-fg: #ffe8a3;
    --warning-border: #e0b640;
    --info-bg: #0d2342;
    --info-fg: #d6e4ff;
    --info-border: #8ab4f8;
    --bad: #ff8a80;
    --good: #8fd19e;
  }
}
[hidden] { display: none !important; }
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--bg); color: var(--fg); }
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 1rem;
  line-height: 1.5;
  background: var(--bg);
  color: var(--fg);
}
a { color: var(--link); text-decoration: underline; text-underline-offset: 0.15em; }
a:visited { color: var(--visited); }
a:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible,
summary:focus-visible, [tabindex]:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
  box-shadow: 0 0 0 5px var(--focus-halo);
}
main:focus { outline: none; }
.visually-hidden {
  position: absolute !important;
  width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
.skip-link {
  position: absolute;
  left: 0.5rem;
  top: -10rem;
  z-index: 10;
  padding: 0.5rem 1rem;
  background: var(--bg);
  color: var(--link);
  border: 2px solid var(--focus);
}
.skip-link:focus { top: 0.5rem; }
.page-header, main, .page-footer { max-width: 110rem; margin: 0 auto; padding: 0 1.25rem; }
.page-header { padding-top: 1.25rem; border-bottom: 1px solid var(--rule); }
.brand { display: flex; align-items: center; gap: 0.75rem; }
.brand img { max-height: 3.5rem; max-width: 12rem; }
.agency { margin: 0; font-weight: 600; }
h1 { font-size: 1.75rem; line-height: 1.25; margin: 0.5rem 0 0.25rem; }
h2 { font-size: 1.4rem; line-height: 1.3; margin: 2rem 0 0.75rem; }
h3 { font-size: 1.1rem; line-height: 1.35; margin: 1.5rem 0 0.5rem; }
.subtitle { margin: 0 0 0.75rem; color: var(--muted); }
.toc ul { list-style: none; margin: 0; padding: 0 0 0.75rem; display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; }
.toc a { display: inline-block; padding: 0.25rem 0; min-height: 24px; }
.banner {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  border: 2px solid;
  border-left-width: 0.5rem;
  border-radius: 0.25rem;
}
.banner p { margin: 0.25rem 0; }
.banner .banner-title { font-weight: 700; font-size: 1.05rem; }
.banner-danger { background: var(--danger-bg); color: var(--danger-fg); border-color: var(--danger-border); }
.banner-warning { background: var(--warning-bg); color: var(--warning-fg); border-color: var(--warning-border); }
.banner-info { background: var(--info-bg); color: var(--info-fg); border-color: var(--info-border); }
.banner a { color: inherit; }
.summary-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.5rem 1.5rem;
  margin: 0;
}
.summary-list div { border-left: 3px solid var(--rule); padding-left: 0.75rem; }
.summary-list dt { color: var(--muted); font-size: 0.95rem; }
.summary-list dd { margin: 0; font-size: 1.15rem; font-weight: 600; overflow-wrap: anywhere; }
.details-list dt { font-weight: 600; margin-top: 0.5rem; }
.details-list dd { margin: 0 0 0.25rem 0; overflow-wrap: anywhere; }
.filters { margin: 0 0 0.75rem; }
.filters fieldset { border: 1px solid var(--border); border-radius: 0.25rem; padding: 0.75rem 1rem 1rem; margin: 0; }
.filters legend { font-weight: 600; padding: 0 0.25rem; }
.filter-controls { display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; align-items: flex-end; }
.filter-controls > div { display: flex; flex-direction: column; gap: 0.25rem; }
.filter-controls .check { flex-direction: row; align-items: center; gap: 0.5rem; min-height: 2.5rem; }
select, button {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  min-height: 2.5rem;
  padding: 0.25rem 0.75rem;
}
button { cursor: pointer; background: var(--surface); }
input[type="checkbox"] { width: 24px; height: 24px; margin: 0; accent-color: var(--link); }
.row-count { font-weight: 600; margin: 0.5rem 0; }
.table-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  max-width: 100%;
}
table { border-collapse: collapse; width: 100%; }
caption { text-align: left; padding: 0.5rem 0.75rem; font-weight: 600; }
th, td { text-align: left; vertical-align: top; padding: 0.5rem 0.75rem; border-top: 1px solid var(--rule); }
thead th { background: var(--surface); border-top: 0; border-bottom: 2px solid var(--border); white-space: nowrap; }
tbody tr:nth-child(even) { background: var(--stripe); }
.pages-table td, .pages-table th[scope="row"] { min-width: 9rem; }
.pages-table th[scope="row"] { min-width: 16rem; font-weight: 400; }
.pages-table th[scope="row"] .page-name { font-weight: 600; }
.pages-table .flags-cell { min-width: 16rem; }
.pages-table .review-cell { min-width: 11rem; }
.pages-table .links-cell { min-width: 12rem; }
.url, .mono, .url-wrap { overflow-wrap: anywhere; word-break: break-word; }
.url { display: block; color: var(--muted); font-size: 0.9rem; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9rem; }
td a, th a, .links a, .history a, .sessions a { display: inline-block; min-height: 24px; overflow-wrap: anywhere; }
ul.links, ul.flags { margin: 0; padding: 0; list-style: none; }
ul.links li, ul.flags li { margin: 0 0 0.25rem; }
ul.flags li { padding-left: 0.75rem; border-left: 3px solid var(--warning-border); }
.status-bad { color: var(--bad); font-weight: 600; }
.status-good { color: var(--good); font-weight: 600; }
.muted, .none { color: var(--muted); }
.meta { display: block; color: var(--muted); font-size: 0.9rem; }
details { margin: 0.5rem 0; }
summary { cursor: pointer; min-height: 24px; padding: 0.25rem 0; }
.history ol, .sessions ul { padding-left: 1.5rem; }
.history li, .sessions li { margin-bottom: 0.75rem; }
.history p, .sessions p { margin: 0.125rem 0; }
.page-footer { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1rem; padding-bottom: 2rem; color: var(--muted); }
.page-footer p { margin: 0.25rem 0; }
@media print {
  .filters, .skip-link { display: none !important; }
  .table-scroll { overflow: visible; border: 0; }
}
`;
