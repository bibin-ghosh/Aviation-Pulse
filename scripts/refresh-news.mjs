import fs from "node:fs/promises";

const currentPath = new URL("../data/current-news.json", import.meta.url);
const sourcesPath = new URL("../data/sources.json", import.meta.url);
const existing = JSON.parse(await fs.readFile(currentPath, "utf8"));
const registry = JSON.parse(await fs.readFile(sourcesPath, "utf8"));
const cutoff = Date.now() - 90 * 86400000;
const feeds = [
  ["EASA", "https://www.easa.europa.eu/newsroom-and-events/news/feed.xml"],
  ["EASA", "https://www.easa.europa.eu/newsroom-and-events/press-releases/feed.xml"],
  ["FAA", "https://www.faa.gov/taxonomy/term/56/feed"]
];

const fetched = [];
for (const [name, url] of feeds) {
  try {
    const response = await fetch(url, {headers:{Accept:"application/rss+xml, application/atom+xml, application/xml, text/xml","User-Agent":"AviationPulse/1.0"}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fetched.push(...parseFeed(await response.text(), name));
  } catch (error) {
    console.warn(`${name} feed skipped: ${error.message}`);
  }
}

if (process.env.NEWS_API_KEY) {
  const groups = [
    ["world", registry.filter(x => x.coverage === "world" && x.access === "conditional").map(x => x.domain)],
    ["india", registry.filter(x => /India/.test(x.coverage) && x.access === "conditional").map(x => x.domain)],
    ["air-india", registry.filter(x => /Air India/.test(x.coverage) && x.access === "conditional").map(x => x.domain)]
  ];
  for (const [scope, domains] of groups) {
    if (!domains.length) continue;
    try {
      const url = new URL("https://newsapi.org/v2/everything");
      url.searchParams.set("q", scope === "air-india" ? '"Air India"' : scope === "india" ? "(aviation OR airline OR airport OR DGCA)" : "(aviation OR airline OR aircraft OR airport)");
      url.searchParams.set("domains", [...new Set(domains)].join(","));
      url.searchParams.set("language", "en");
      url.searchParams.set("sortBy", "publishedAt");
      url.searchParams.set("pageSize", "40");
      const response = await fetch(url, {headers:{"X-Api-Key":process.env.NEWS_API_KEY}});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      fetched.push(...(payload.articles || []).map((article, index) => shape({
        id:`newsapi-${scope}-${index}-${hash(article.title || "")}`,
        headline:clean(article.title || "").replace(/\s+-\s+[^-]+$/, ""),
        summary:summarize(clean(article.description || "")),
        date:article.publishedAt,
        source:clean(article.source?.name || hostLabel(article.url)),
        sourceUrl:article.url,
        scopeHint:scope
      })).filter(Boolean));
    } catch (error) {
      console.warn(`NewsAPI ${scope} group skipped: ${error.message}`);
    }
  }
}

const trusted = new Set(registry.map(x => x.domain));
const combined = [...fetched, ...(existing.items || [])]
  .filter(item => validItem(item, trusted))
  .sort((a,b) => new Date(b.date) - new Date(a.date));
const seen = new Set();
const items = combined.filter(item => {
  const key = normalize(item.headline);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
}).slice(0,36);

if (!items.length) throw new Error("No recent verified items were available; existing edition was left unchanged.");
await fs.writeFile(currentPath, `${JSON.stringify({refreshedAt:new Date().toISOString(),edition:"github-scheduled-source-check",items}, null, 2)}\n`, "utf8");
console.log(`Published ${items.length} items from ${new Set(items.map(x => x.source)).size} sources.`);

function parseFeed(xml, source) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0,30).map((block,index) => shape({
    id:`${source.toLowerCase()}-${index}-${hash(value(block,"title"))}`,
    headline:clean(value(block,"title")),
    summary:summarize(clean(value(block,"description") || value(block,"summary") || value(block,"content"))),
    date:value(block,"pubDate") || value(block,"published") || value(block,"updated"),
    source,
    sourceUrl:atomLink(block) || clean(value(block,"link")),
    scopeHint:"world"
  })).filter(Boolean);
}

function shape(item) {
  if (!item.headline || !item.sourceUrl || !Number.isFinite(new Date(item.date).getTime())) return null;
  const text = `${item.headline} ${item.summary}`.toLowerCase();
  const airIndia = item.scopeHint === "air-india" || /\bair india(?: express)?\b|\bvistara\b/.test(text);
  const india = airIndia || item.scopeHint === "india" || /\bindia(?:n)?\b|\bdgca\b|\bindigo\b|\bakasa(?: air)?\b|\bspicejet\b|\balliance air\b|\bstar air\b|\bfly91\b/.test(text);
  return {...item,summary:item.summary || "Open the original source for the complete update.",date:new Date(item.date).toISOString(),scopes:airIndia?["world","india","air-india"]:india?["world","india"]:["world"],topics:topics(text)};
}

function validItem(item, trusted) {
  const time = new Date(item.date).getTime();
  if (!Number.isFinite(time) || time < cutoff || time > Date.now() + 86400000) return false;
  try { const host = new URL(item.sourceUrl).hostname.toLowerCase(); return [...trusted].some(domain => host === domain || host.endsWith(`.${domain}`)); } catch { return false; }
}
function value(block, tag) { const match=block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i")); return match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g,"") || ""; }
function atomLink(block) { return block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || ""; }
function clean(value) { return String(value || "").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim(); }
function summarize(value) { const cleanValue=clean(value); return cleanValue.length>360 ? `${cleanValue.slice(0,357).replace(/\s+\S*$/,"")}…` : cleanValue; }
function normalize(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function hash(value) { let h=2166136261; for (const char of String(value)) h=Math.imul(h^char.charCodeAt(0),16777619); return (h>>>0).toString(36); }
function hostLabel(url) { try { return new URL(url).hostname.replace(/^www\./,""); } catch { return "Publisher"; } }
function topics(text) { const rules=[["safety",/safety|accident|incident|risk|investigat|airworthiness|emergency/],["fleet",/aircraft|fleet|boeing|airbus|engine|delivery|order/],["regulation",/regulat|rule|authority|faa|easa|icao|dgca|policy/],["airports",/airport|runway|terminal|air traffic/],["business",/profit|revenue|merger|finance|demand|capacity/],["operations",/route|service|flight|network|schedule|operation/]]; const found=rules.filter(([,rule])=>rule.test(text)).map(([name])=>name); return found.length?found.slice(0,3):["industry"]; }
