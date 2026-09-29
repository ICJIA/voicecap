/**
 * A fake `fetch` replaying real i2i.illinois.gov and dvfr.illinois.gov responses (home page,
 * robots.txt, and sitemap), for `init`'s site checks (`src/init/site.ts`). Never touches the
 * network. i2i.illinois.gov's /sitemap.xml is a stand-in, not a recording (see I2I_SITEMAP).
 */

const I2I_HOME =
  "<!doctype html><html><head><title>I2I</title></head><body><h1>Information for Illinois</h1></body></html>";
const DVFR_HOME =
  "<!doctype html><html><head><title>DVFR</title></head><body><h1>Domestic Violence Fatality Review</h1></body></html>";

const I2I_ROBOTS =
  "User-agent: *\nAllow: /\n\nSitemap: https://i2i.illinois.gov/sitemap-index.xml\n";
const I2I_SITEMAP_INDEX =
  '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://i2i.illinois.gov/sitemap-0.xml</loc></sitemap></sitemapindex>';
// i2i.illinois.gov serves /sitemap.xml too, beside the sitemap-index.xml its robots.txt names
// (Astro's default): the case that made init offer every sitemap a site has. This body is a
// stand-in, not a recording; init's checks only look for a <urlset> or <sitemapindex>.
const I2I_SITEMAP =
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://i2i.illinois.gov/</loc></url></urlset>';

const DVFR_ROBOTS = "User-agent: *\nAllow: /\n\nSitemap: https://dvfr.illinois.gov/sitemap.xml\n";
const DVFR_SITEMAP =
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://dvfr.illinois.gov/</loc></url><url><loc>https://dvfr.illinois.gov/about/</loc></url><url><loc>https://dvfr.illinois.gov/faq/</loc></url></urlset>';

const NOT_FOUND = "<!doctype html><html><body>Not found</body></html>";

function respond(body: string, contentType: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

/** A redirect a real fetch already followed: a constructed Response's `url` starts empty. */
function redirectedTo(finalUrl: string, body: string): Response {
  const response = respond(body, "text/html; charset=utf-8");
  Object.defineProperty(response, "url", { value: finalUrl });
  return response;
}

const RECORDED: Record<string, () => Response> = {
  "https://i2i.illinois.gov/": () => respond(I2I_HOME, "text/html; charset=utf-8"),
  "https://dvfr.illinois.gov/": () => respond(DVFR_HOME, "text/html; charset=utf-8"),
  "http://i2i.illinois.gov/": () => redirectedTo("https://i2i.illinois.gov/", I2I_HOME),
  "http://dvfr.illinois.gov/": () => redirectedTo("https://dvfr.illinois.gov/", DVFR_HOME),
  "https://i2i.illinois.gov/robots.txt": () => respond(I2I_ROBOTS, "text/plain; charset=utf-8"),
  "https://i2i.illinois.gov/sitemap-index.xml": () =>
    respond(I2I_SITEMAP_INDEX, "application/xml; charset=utf-8"),
  "https://i2i.illinois.gov/sitemap.xml": () =>
    respond(I2I_SITEMAP, "application/xml; charset=utf-8"),
  "https://dvfr.illinois.gov/robots.txt": () => respond(DVFR_ROBOTS, "text/plain; charset=utf-8"),
  "https://dvfr.illinois.gov/sitemap.xml": () =>
    respond(DVFR_SITEMAP, "application/xml; charset=utf-8"),
};

function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/**
 * Build a fake `fetch` for `init`'s site checks: the recorded i2i.illinois.gov and
 * dvfr.illinois.gov responses above, with `extra` answering (or overriding) single URLs on top,
 * as factories since a body can be read only once. Anything else answers 404 HTML.
 */
export function realSitesFetch(
  extra: Record<string, () => Response | Promise<Response>> = {},
): typeof fetch {
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = urlOf(input);
    const overridden = extra[url];
    if (overridden) return overridden();
    const recorded = RECORDED[url];
    if (recorded) return recorded();
    return respond(NOT_FOUND, "text/html; charset=utf-8", 404);
  };
  return fakeFetch;
}
