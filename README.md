# Aviation Pulse

A static, single-page aviation briefing with three scopes—Air India, India and World—and a clear two-level layout:

- **Hot News — Past 7 days:** a standalone box at the top for smaller incidents, diversions, technical notices, route changes, operational reports and regulatory updates.
- **Industry briefing:** a two-tab component containing **Current**, the source-checked live edition, and **Past 4 years**, the curated timeline covering 2023–2026.

The World scope includes Indian and Air India stories. Every item retains its original publisher link.

## Project layout

```text
index.html                       Single-file HTML/CSS/JavaScript frontend
data/current-news.json          Same-origin current edition used by GitHub Pages
data/weekly-news.json           Same-origin rolling seven-day report feed
data/historical-events.json     Curated four-year timeline
data/sources.json               Approved source registry and ingestion mode
favicon.svg                     Browser icon matching the header logo
scripts/refresh-news.mjs        Scheduled GitHub edition builder
.github/workflows/refresh-news.yml  Daily and manual GitHub refresh workflow
worker/src/index.js             Cloudflare Worker
worker/wrangler.toml.example    Worker and KV configuration template
worker/package.json             Worker development dependency
```

## 1. Create the Cloudflare Worker

This section is optional. GitHub Pages refresh works without a Worker by loading `data/current-news.json`; the Worker provides a more immediate server-fetched refresh with KV caching and per-IP rate limiting.

You need a Cloudflare account and Node.js 20 or later.

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create NEWS_CACHE
npx wrangler kv namespace create NEWS_CACHE --preview
```

Cloudflare prints an identifier after each KV command. Copy `wrangler.toml.example` to `wrangler.toml`, then replace both placeholder KV identifiers.

Set `ALLOWED_ORIGIN` to the public origin that will host the page. For a standard GitHub Pages project it normally looks like:

```toml
ALLOWED_ORIGIN = "https://YOUR-GITHUB-USERNAME.github.io"
```

For a custom domain, use that origin instead. Multiple origins may be supplied as a comma-separated value.

Deploy the Worker:

```bash
npx wrangler deploy
```

Copy the resulting `workers.dev` address. In `index.html`, replace:

```js
apiBase: ""
```

with the deployed address, without a trailing slash. Leaving it empty is supported: Refresh will reload the latest `data/current-news.json` and `data/weekly-news.json` editions instead of displaying a configuration error.

### Optional broader trade-news coverage

The Worker works without an API key and starts with official EASA and FAA RSS feeds. To add current articles from the expanded trade, safety-investigation, regulatory, manufacturer, infrastructure, airline-newsroom, Indian-business and Air India source groups, create a NewsAPI key and save it only as a Worker secret:

```bash
npx wrangler secret put NEWS_API_KEY
```

The key never reaches the browser. The Worker runs separate World, safety/regulatory, manufacturer, airline-newsroom, India and Air India queries and filters every returned URL against the trusted-domain registry in `worker/src/index.js`. The registry covers more than 90 approved domains; availability still depends on each publisher and the licensed aggregator.

Additional publisher-approved RSS feeds can be supplied through `EXTRA_FEEDS_JSON`. Use only feeds offered by the publisher or feeds you are authorised to consume. Example:

```json
[
  {
    "name": "Publisher name",
    "url": "https://publisher.example/official-feed.xml",
    "scopeHints": ["world"]
  }
]
```

Save that JSON as a Worker secret:

```bash
npx wrangler secret put EXTRA_FEEDS_JSON
```

Do not add HTML pages as feeds. The Worker intentionally does not scrape publisher websites.

### Source coverage and access modes

`data/sources.json` records every approved source, its coverage area and how it may be used:

- **active:** an official feed is fetched directly;
- **conditional:** available when NewsAPI returns the domain or when a publisher-approved feed/API is configured;
- **manual:** used for structured databases, PDFs and editorial historical curation;
- **review required:** not automated until the publisher identity and current status can be verified.

Listing a source does not bypass its paywall, licence, robots policy or terms. CAPA, Bloomberg, ch-aviation, Cirium and other commercial services may require a direct subscription or licensed API for complete coverage.

## 2. Seed the initial cache

After deploying, create the first cached edition:

```bash
curl -X POST https://YOUR-WORKER.workers.dev/api/refresh
```

The scheduled trigger refreshes the cache every six hours. Manual requests are limited per hashed IP and UTC day; the default is five. Change `REFRESH_LIMIT` in `wrangler.toml` if necessary.

KV stores:

- the latest successful edition under `aviation-pulse:latest:v1`;
- daily per-IP refresh counters under hashed keys beginning with `rate:`.

If a refresh fails, the Worker leaves the previous cached edition intact.

## 3. Publish the frontend on GitHub Pages

1. Create a GitHub repository.
2. Copy `index.html`, `data/`, `worker/` and this README into it.
3. Commit and push the files to the default branch.
4. In the repository, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select the default branch and `/ (root)`, then save.
7. Open the Pages address shown by GitHub after deployment finishes.

The included GitHub workflow runs daily and can also be started from **Actions → Refresh verified aviation news → Run workflow**. It fetches approved official feeds, rebuilds both `data/current-news.json` and `data/weekly-news.json`, and commits a changed edition. To include broader domain-filtered coverage, add a repository Actions secret named `NEWS_API_KEY`, subject to the provider’s licence and usage terms. The workflow still operates with the official feeds when this optional secret is absent.

Publishing the Worker source is safe. Secrets entered with `wrangler secret put` are stored by Cloudflare and are not written into the repository.

## Local preview

The page can now be opened directly by double-clicking `index.html`; it uses built-in verified fallbacks for both Current and Past 4 Years. To test the same-origin JSON refresh behavior used by GitHub Pages, run a local web server:

```bash
npx serve .
```

## Current-data behavior

Without a Worker, the Refresh button requests both live JSON editions with cache bypassing so GitHub Pages serves the latest published files. When the page is opened directly from disk, Refresh confirms and redraws the built-in source-checked editions. The displayed refresh time records when that check completed, even when no new article was found or the network request failed.

The Worker:

1. fetches official or publisher-authorised feeds;
2. optionally fetches NewsAPI results limited to the configured trusted domains;
3. strips markup and rejects entries without a valid source link or publication date;
4. classifies Air India separately while the India scope covers IndiGo, Akasa Air, SpiceJet, Alliance Air, airports, regulators and other Indian aviation subjects;
5. removes closely matching headlines from the concise Current briefing;
6. builds the separate Past 7 days feed with exact same-publisher deduplication only, preserving smaller reports up to 96 entries;
7. excludes entries older than 90 days from the Current edition and older than seven days from the weekly feed;
8. retains the original link, publication date and publisher name;
9. stores only the completed result in KV.

The frontend merges any Worker edition with source-checked starter items published within the last 120 days. This prevents a newly verified major item from disappearing behind an older KV cache while allowing the starter edition to age out automatically.

Summaries are extracted from publisher-provided feed descriptions. No headline or date is generated by the application.

## Updating the historical timeline

The recommended process is manual quarterly curation:

1. Identify a genuinely consequential event from one of the approved sources.
2. Confirm the date and facts against the original article or official release.
3. Add an object to `data/historical-events.json` with a unique `id`.
4. Use scopes as follows:
   - `world` for every event;
   - add `india` when the event directly concerns Indian civil aviation;
   - add `air-india` only when it directly concerns Air India, Air India Express or the Vistara integration.
5. Keep `significance` to one sentence and `summary` to two or three sentences.
6. Open every `sourceUrl` and recheck the date before publishing.
7. Validate the JSON and preview the timeline under Air India, India and World scopes.

For Air India, review the official press-release archive quarterly and cross-check material fleet, safety, merger, leadership and partnership events against the Tata newsroom, AAIB India, DGCA, Airbus, Boeing, Singapore Airlines and trusted trade-press archives. Routine sales, awards and minor promotional announcements should not be promoted into the major-events timeline.

Example entry:

```json
{
  "id": "2026-example",
  "date": "2026-01-31",
  "headline": "Verbatim or faithfully shortened source headline",
  "significance": "Why the event mattered in one sentence.",
  "summary": "Two or three source-grounded sentences.",
  "source": "Publisher",
  "sourceUrl": "https://publisher.example/original-item",
  "scopes": ["world", "india"],
  "topics": ["safety", "regulation"]
}
```

Avoid automatically promoting live headlines into the historical timeline. Historical inclusion requires editorial judgment and a second source check.

## Source and usage policy

- Prefer official RSS, official APIs and licensed aggregators.
- Do not bypass paywalls or copy full articles.
- Store short feed-provided descriptions, not article bodies.
- Treat an association press release as authoritative for that association’s data and position, not as independent reporting.
- For accidents, link to the responsible investigation authority whenever possible and clearly distinguish preliminary information from final findings.
- Review publisher terms before adding any new feed.

## API responses

- `GET /api/news` returns the last successful cached edition.
- `GET /api/weekly` returns the rolling seven-day portion of the cached edition.
- `POST /api/refresh` refreshes all configured sources and updates KV.
- `GET /api/health` confirms that the Worker is running.
- `429` indicates that the daily manual-refresh limit has been reached.
- `502` indicates that all configured sources failed; the response may include the previous cached edition.
