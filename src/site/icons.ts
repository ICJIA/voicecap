/**
 * The website's pictures: one before each view's heading, one before each site's name, and the
 * arrow of the link to a site itself; and the frame's (see ./frame.ts): an icon before each link of
 * the bottom bar, the shield with a check among them, the theme button's sun and moon, and the
 * arrow of the way back to the test results. A page's own heading has no picture: the trust page's
 * is the audit tool's, a kicker over a headline. Each is inline SVG in the shareable page's style for
 * its pictures (../share/html/icons.ts): outlined in the text's own color, on a 24 by 24 grid, and
 * drawn by attributes, so the page sets no `style` attribute. GitHub's mark is the one picture that
 * is filled, as GitHub draws it. Each is hidden from screen readers, since the words beside it say
 * it all, or, for the theme button, its label does; the page's style sizes and colors them by their
 * class.
 */

/**
 * One picture, outlined in the current color, hidden from screen readers. `name` is a class of its
 * own beside `icon`, for the style to tell it apart: the theme button's `sun` and `moon`.
 */
function picture(shapes: string, name?: string): string {
  const classes = name === undefined ? "icon" : `icon ${name}`;
  return `<svg class="${classes}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
}

/** One picture, filled in the current color, hidden from screen readers. */
function filled(path: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
}

// A shield with a check mark: the trust page, and what can be checked.
const SHIELD = picture(
  '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
);

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
};

/** The frame's pictures: the bottom bar's five, the theme button's two, and the way back's arrow. */
export const FRAME_ICONS = {
  // GitHub's mark, filled, as GitHub draws it: voicecap on GitHub.
  github: filled(
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  ),
  // A list: the CHANGELOG, a list of every change.
  changelog: picture('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  // A megaphone: what's new.
  whatsNew: picture(
    '<path d="M3 10v4a1 1 0 0 0 1 1h2l6 4V5L6 9H4a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
  ),
  trust: SHIELD,
  // A terminal's window: the technical details.
  technical: picture(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7.5 9.5 3 2.5-3 2.5M13 15h4"/>',
  ),
  // A sun, in the dark theme, and a moon, in the light one: the theme button shows one of them.
  sun: picture(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    "sun",
  ),
  moon: picture('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>', "moon"),
  // A left arrow: back to the test results.
  back: picture('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
};
