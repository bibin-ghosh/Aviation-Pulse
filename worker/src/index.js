const CACHE_KEY = "aviation-pulse:latest:v1";
const DEFAULT_LIMIT = 5;
const MAX_ITEMS = 36;
const MAX_WEEKLY_ITEMS = 96;
const RECENT_WINDOW_DAYS = 90;
const WEEKLY_WINDOW_DAYS = 7;
const OFFICIAL_FEEDS = [
  {
    name: "EASA",
    url: "https://www.easa.europa.eu/newsroom-and-events/news/feed.xml",
    scopeHints: ["world"]
  },
  {
    name: "EASA",
    url: "https://www.easa.europa.eu/newsroom-and-events/press-releases/feed.xml",
    scopeHints: ["world"]
  },
  {
    name: "FAA",
    url: "https://www.faa.gov/taxonomy/term/56/feed",
    scopeHints: ["world"]
  }
];

const SOURCE_GROUPS = [
  {
    name: "World aviation trade press",
    query: "(aviation OR airline OR aircraft OR airport OR aerospace)",
    domains: [
      "aviationweek.com", "flightglobal.com", "atwonline.com", "theaircurrent.com",
      "simpleflying.com", "aeroroutes.com", "ch-aviation.com", "ainonline.com",
      "airwaysmag.com", "aerotime.aero", "leehamnews.com", "cirium.com",
      "centreforaviation.com", "skift.com", "airlineweekly.skift.com", "oag.com"
    ]
  },
  {
    name: "Safety, regulatory and business press",
    query: "(aviation OR airline OR aircraft OR airport OR airspace)",
    domains: [
      "aviation-safety.net", "flightsafety.org", "ntsb.gov", "avherald.com", "aaib.gov.in",
      "icao.int", "iata.org", "faa.gov", "easa.europa.eu", "eurocontrol.int",
      "reuters.com", "bloomberg.com", "thepointsguy.com"
    ]
  },
  {
    name: "Global investigation authorities and regulators",
    query: "(aviation OR aircraft OR airline OR airport OR incident OR accident OR airworthiness)",
    domains: [
      "aaib.gov.uk", "atsb.gov.au", "tsb.gc.ca", "bea.aero", "bfu-web.de",
      "caa.co.uk", "casa.gov.au", "tc.canada.ca", "caas.gov.sg",
      "aviation.govt.nz", "gcaa.gov.ae", "anac.gov.br", "caap.gov.ph",
      "caa.lk", "info.gov.hk"
    ]
  },
  {
    name: "Manufacturers and aviation infrastructure",
    query: "(aircraft OR aviation OR airline OR airport OR engine OR air traffic)",
    domains: [
      "airbus.com", "boeing.com", "embraer.com", "atr-aircraft.com",
      "geaerospace.com", "rtx.com", "rolls-royce.com", "aci.aero", "canso.org"
    ]
  },
  {
    name: "Additional global aviation reporting",
    query: "(aviation OR airline OR aircraft OR airport OR flight OR incident)",
    domains: [
      "aeroinside.com", "airport-technology.com", "airlinegeeks.com",
      "runwaygirlnetwork.com", "paxex.aero", "aviationsource.news",
      "airlineratings.com", "airlive.net", "apnews.com", "lemonde.fr"
    ]
  },
  {
    name: "Global airline newsrooms",
    query: "(airline OR aircraft OR route OR fleet OR operations)",
    domains: [
      "news.delta.com", "united.com", "news.aa.com", "lufthansagroup.com",
      "iairgroup.com", "emirates.com", "qatarairways.com", "qantasnewsroom.com.au",
      "corporate.ryanair.com", "southwestairlinesinvestorrelations.com"
    ]
  },
  {
    name: "India aviation sources",
    query: "(aviation OR airline OR airport OR DGCA OR IndiGo OR Akasa OR SpiceJet OR \"Air India\")",
    domains: [
      "stattimes.com", "moneycontrol.com", "thehindubusinessline.com",
      "business-standard.com", "livemint.com", "economictimes.indiatimes.com",
      "financialexpress.com", "dgca.gov.in", "aai.aero", "civilaviation.gov.in",
      "bcasindia.gov.in", "aera.gov.in", "pib.gov.in", "ndtv.com", "indiatoday.in", "ptinews.com",
      "goindigo.in", "akasaair.com", "spicejet.com", "allianceair.in"
    ]
  },
  {
    name: "Air India primary and specialist sources",
    query: "\"Air India\"",
    domains: [
      "airindia.com", "tata.com", "business-standard.com", "livemint.com",
      "economictimes.indiatimes.com", "centreforaviation.com", "simpleflying.com",
      "aeroroutes.com", "flightglobal.com", "reuters.com", "aaib.gov.in", "pib.gov.in",
      "airbus.com", "boeing.com", "singaporeair.com"
    ]
  }
];

const TRUSTED_NEWS_DOMAINS = [...new Set(SOURCE_GROUPS.flatMap(group => group.domains))];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "aviation-pulse" }, 200, headers);
    }

    if (url.pathname === "/api/news" && request.method === "GET") {
      const cached = await readCache(env);
      if (!cached) {
        return json({
          ok: true,
          items: [],
          refreshedAt: null,
          stale: true,
          message: "No cached refresh is available yet."
        }, 200, headers);
      }
      return json({ ok: true, ...cached }, 200, headers);
    }

    if (url.pathname === "/api/weekly" && request.method === "GET") {
      const cached = await readCache(env);
      return json({
        ok: true,
        items: cached?.weeklyItems || [],
        refreshedAt: cached?.refreshedAt || null,
        stale: !cached
      }, 200, headers);
    }

    if (url.pathname === "/api/refresh" && request.method === "POST") {
      const limitResult = await takeRefreshToken(request, env);
      if (!limitResult.allowed) {
        return json({
          ok: false,
          code: "RATE_LIMITED",
          message: `Daily refresh limit reached. Try again after ${limitResult.resetsAt}.`,
          remaining: 0,
          resetsAt: limitResult.resetsAt
        }, 429, {
          ...headers,
          "Retry-After": String(limitResult.retryAfter)
        });
      }

      try {
        const result = await refreshNews(env);
        await env.NEWS_CACHE.put(CACHE_KEY, JSON.stringify(result));
        return json({
          ok: true,
          ...result,
          remaining: limitResult.remaining,
          resetsAt: limitResult.resetsAt
        }, 200, headers);
      } catch (error) {
        const cached = await readCache(env);
        return json({
          ok: false,
          code: "REFRESH_FAILED",
          message: "The refresh failed. The last cached edition is still available.",
          detail: safeError(error),
          cached
        }, 502, headers);
      }
    }

    return json({ ok: false, message: "Not found" }, 404, headers);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const result = await refreshNews(env);
        await env.NEWS_CACHE.put(CACHE_KEY, JSON.stringify(result));
      } catch (error) {
        console.error("Scheduled refresh failed", safeError(error));
      }
    })());
  }
};

async function readCache(env) {
  if (!env.NEWS_CACHE) throw new Error("NEWS_CACHE KV binding is missing");
  return env.NEWS_CACHE.get(CACHE_KEY, "json");
}

async function refreshNews(env) {
  if (!env.NEWS_CACHE) throw new Error("NEWS_CACHE KV binding is missing");
  const feeds = [...OFFICIAL_FEEDS, ...parseExtraFeeds(env.EXTRA_FEEDS_JSON)];
  const tasks = feeds.map(fetchFeed);
  if (env.NEWS_API_KEY) tasks.push(fetchNewsApi(env.NEWS_API_KEY));

  const settled = await Promise.allSettled(tasks);
  const items = [];
  const sourceStatus = [];

  settled.forEach((result, index) => {
    const sourceName = index < feeds.length ? feeds[index].name : "NewsAPI trusted domains";
    if (result.status === "fulfilled") {
      items.push(...result.value);
      sourceStatus.push({ source: sourceName, ok: true, count: result.value.length });
    } else {
      sourceStatus.push({ source: sourceName, ok: false, count: 0 });
      console.warn("Source refresh failed", sourceName, safeError(result.reason));
    }
  });

  if (!items.length) throw new Error("No configured source returned usable items");

  const recentCutoff = Date.now() - RECENT_WINDOW_DAYS * 86400000;
  const cleaned = deduplicate(items.filter(item => {
    const published = new Date(item.date).getTime();
    return Number.isFinite(published) && published >= recentCutoff && published <= Date.now() + 86400000;
  }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, MAX_ITEMS);

  if (!cleaned.length) throw new Error(`No verified item was published within the last ${RECENT_WINDOW_DAYS} days`);

  const weeklyCutoff = Date.now() - WEEKLY_WINDOW_DAYS * 86400000;
  const weeklyItems = deduplicateWeekly(items.filter(item => {
    const published = new Date(item.date).getTime();
    return Number.isFinite(published) && published >= weeklyCutoff && published <= Date.now() + 86400000;
  }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, MAX_WEEKLY_ITEMS);

  return {
    items: cleaned,
    weeklyItems,
    refreshedAt: new Date().toISOString(),
    stale: false,
    sourceStatus
  };
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: {
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "User-Agent": "AviationPulse/1.0 (+public aviation news reader)"
    },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`${feed.name} returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 1_500_000) throw new Error(`${feed.name} feed exceeded size limit`);
  const xml = await response.text();
  return parseFeed(xml, feed);
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 24).map((block, index) => {
    const headline = cleanText(tagValue(block, "title"));
    const link = atomLink(block) || cleanText(tagValue(block, "link"));
    const rawDate = tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated");
    const rawDescription = tagValue(block, "description") || tagValue(block, "summary") || tagValue(block, "content");
    const summary = summarize(cleanText(rawDescription));
    const date = validDate(rawDate);
    if (!headline || !date || !isHttpUrl(link)) return null;
    return shapeItem({
      id: `${slug(feed.name)}-${date.slice(0, 10)}-${index}-${shortHash(headline)}`,
      headline,
      summary,
      date,
      source: feed.name,
      sourceUrl: link,
      scopeHints: feed.scopeHints
    });
  }).filter(Boolean);
}

async function fetchNewsApi(apiKey) {
  const responses = await Promise.all(SOURCE_GROUPS.map(async group => {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", group.query);
    url.searchParams.set("domains", group.domains.join(","));
    url.searchParams.set("language", "en");
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", "100");
    const response = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    if (!response.ok) throw new Error(`NewsAPI ${group.name} returned HTTP ${response.status}`);
    const payload = await response.json();
    return { group: group.name, articles: payload.articles || [] };
  }));

  return responses.flatMap(payload => payload.articles.map(article => ({ ...article, sourceGroup: payload.group }))).map((article, index) => {
    if (!article.title || !isHttpUrl(article.url)) return null;
    return shapeItem({
      id: `newsapi-${index}-${shortHash(article.title)}`,
      headline: cleanText(article.title.replace(/\s+-\s+[^-]+$/, "")),
      summary: summarize(cleanText(article.description || article.content || "")),
      date: validDate(article.publishedAt),
      source: cleanText(article.source?.name || hostnameLabel(article.url)),
      sourceUrl: article.url,
      scopeHints: article.sourceGroup === "Air India primary and specialist sources"
        ? ["world", "india", "air-india"]
        : article.sourceGroup === "India aviation sources"
          ? ["world", "india"]
          : ["world"],
      sourceGroup: article.sourceGroup
    });
  }).filter(item => item && item.date).filter(item => isTrustedUrl(item.sourceUrl));
}

function shapeItem(item) {
  const searchable = `${item.headline} ${item.summary}`.toLowerCase();
  const airIndia = item.scopeHints?.includes("air-india") || /\bair india(?: express)?\b|\bvistara\b/.test(searchable);
  const india = item.scopeHints?.includes("india") || airIndia || /\bindia(?:n)?\b|\bdgca\b|\bindigo\b|\bakasa(?: air)?\b|\bspicejet\b|\balliance air\b|\bstar air\b|\bfly91\b|\bindiaone air\b|\bdelhi\b|\bmumbai\b|\bbengaluru\b|\bhyderabad\b|\bchennai\b|\bkolkata\b/.test(searchable);
  return {
    ...item,
    summary: item.summary || "Open the original source for the complete update.",
    scopes: airIndia ? ["world", "india", "air-india"] : india ? ["world", "india"] : ["world"],
    topics: classifyTopics(searchable)
  };
}

function classifyTopics(text) {
  const rules = [
    ["safety", /safety|accident|incident|collision|risk|investigat|airworthiness|grounded|emergency/],
    ["fleet", /aircraft|fleet|boeing|airbus|embraer|engine|delivery|order|retrofit/],
    ["regulation", /regulat|rule|directive|authority|faa|easa|icao|dgca|policy|certificate/],
    ["airports", /airport|aerodrome|runway|terminal|air traffic/],
    ["sustainability", /saf\b|sustainab|emission|climate|carbon|fuel/],
    ["business", /profit|revenue|merger|acqui|finance|demand|traffic|capacity/],
    ["operations", /route|service|flight|network|schedule|operation|delay/]
  ];
  const topics = rules.filter(([, rule]) => rule.test(text)).map(([name]) => name);
  return topics.length ? topics.slice(0, 3) : ["industry"];
}

function deduplicate(items) {
  const output = [];
  for (const item of items) {
    const duplicate = output.find(existing => titleSimilarity(existing.headline, item.headline) >= 0.72);
    if (!duplicate) {
      output.push(item);
      continue;
    }
    if (new Date(item.date) > new Date(duplicate.date)) {
      Object.assign(duplicate, item);
    }
  }
  return output;
}

function deduplicateWeekly(items) {
  const seen = new Set();
  return items.filter(item => {
    let host = "publisher";
    try { host = new URL(item.sourceUrl).hostname.toLowerCase(); } catch {}
    const key = `${host}|${normalizeTitle(item.headline)}`;
    if (!normalizeTitle(item.headline) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleSimilarity(a, b) {
  const left = new Set(normalizeTitle(a).split(" ").filter(word => word.length > 2));
  const right = new Set(normalizeTitle(b).split(" ").filter(word => word.length > 2));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  left.forEach(word => { if (right.has(word)) intersection += 1; });
  return intersection / new Set([...left, ...right]).size;
}

async function takeRefreshToken(request, env) {
  if (!env.NEWS_CACHE) throw new Error("NEWS_CACHE KV binding is missing");
  const limit = Math.max(1, Number(env.REFRESH_LIMIT || DEFAULT_LIMIT));
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const identity = await sha256(ip);
  const key = `rate:${day}:${identity}`;
  const used = Number(await env.NEWS_CACHE.get(key) || 0);
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const retryAfter = Math.max(60, Math.ceil((nextMidnight - now.getTime()) / 1000));
  const resetsAt = new Date(nextMidnight).toISOString();

  if (used >= limit) return { allowed: false, remaining: 0, retryAfter, resetsAt };
  await env.NEWS_CACHE.put(key, String(used + 1), { expirationTtl: retryAfter + 3600 });
  return { allowed: true, remaining: limit - used - 1, retryAfter, resetsAt };
}

function parseExtraFeeds(value) {
  if (!value) return [];
  try {
    const feeds = JSON.parse(value);
    if (!Array.isArray(feeds)) return [];
    return feeds.filter(feed => feed && feed.name && isHttpUrl(feed.url)).slice(0, 8).map(feed => ({
      name: String(feed.name).slice(0, 40),
      url: String(feed.url),
      scopeHints: Array.isArray(feed.scopeHints) ? feed.scopeHints : ["world"]
    }));
  } catch {
    return [];
  }
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
}

function atomLink(block) {
  const match = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
  return match ? decodeEntities(match[1]) : "";
}

function summarize(value) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const summary = sentences.slice(0, 3).join(" ").trim();
  return summary.length > 420 ? `${summary.slice(0, 417).trim()}…` : summary;
}

function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function normalizeTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function validDate(value) {
  const date = new Date(cleanText(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hostnameLabel(value) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "Source"; }
}

function isTrustedUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    return TRUSTED_NEWS_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function shortHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function corsHeaders(request, env) {
  const configured = env.ALLOWED_ORIGIN || "*";
  const origin = request.headers.get("Origin");
  const allowed = configured === "*" || !origin || configured.split(",").map(v => v.trim()).includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (configured === "*" ? "*" : origin || configured.split(",")[0].trim()) : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  };
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 240) : "Unknown error";
}
