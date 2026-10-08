/**
 * The website's pictures: one before each view's heading, one before each site's name, the arrow of
 * the link to a site itself, and the shield before the trust page's heading. Each is inline SVG in
 * the shareable page's style for its pictures
 * (../share/html/icons.ts): outlined in the text's own color, on a 24 by 24 grid, and sized and
 * drawn by attributes, so the page sets no `style` attribute. Each is hidden from screen readers,
 * since the words beside it say it all; the page's style sizes and colors them by their class.
 */

/** One picture, outlined in the current color, hidden from screen readers. */
function picture(shapes: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
}

export const SITE_ICONS = {
  // A play button in a circle: the demo, an example to try.
  demo: picture('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>'),
  // A globe: the sites.
  sites: picture(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  ),
  // A calendar: every report, by date.
  byDate: picture(
    '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ),
  // A browser's window: one site.
  site: picture(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01"/>',
  ),
  // An arrow out of a box: the link leaves the page for the site itself.
  visit: picture(
    '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  ),
  // A shield with a check mark: the trust page, and what can be checked.
  trust: picture(
    '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  ),
};
