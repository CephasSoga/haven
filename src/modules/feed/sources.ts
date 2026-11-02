import { inApp } from "@/lib/platform";

/**
 * Free news sources, read through Haven's local feed fetcher (/api/feed):
 * Google News (search, topic sections, top headlines — breadth, localised by region) and
 * Bing News (images, snippets and direct publisher links). Plus any RSS/Atom feed you add.
 */

export type Region = { id: string; label: string; hl: string; gl: string; ceid: string; bing: string };

export const REGIONS: Region[] = [
  { id: "fr-FR", label: "France · Français", hl: "fr", gl: "FR", ceid: "FR:fr", bing: "fr-FR" },
  { id: "fr-CM", label: "Cameroun · Français", hl: "fr", gl: "CM", ceid: "CM:fr", bing: "fr-FR" },
  { id: "fr-BE", label: "Belgique · Français", hl: "fr", gl: "BE", ceid: "BE:fr", bing: "fr-BE" },
  { id: "fr-CA", label: "Canada · Français", hl: "fr-CA", gl: "CA", ceid: "CA:fr", bing: "fr-CA" },
  { id: "en-US", label: "United States · English", hl: "en-US", gl: "US", ceid: "US:en", bing: "en-US" },
  { id: "en-GB", label: "United Kingdom · English", hl: "en-GB", gl: "GB", ceid: "GB:en", bing: "en-GB" },
  { id: "en-NG", label: "Nigeria · English", hl: "en-NG", gl: "NG", ceid: "NG:en", bing: "en-WW" },
  { id: "en-ZA", label: "South Africa · English", hl: "en-ZA", gl: "ZA", ceid: "ZA:en", bing: "en-ZA" },
  { id: "en-IN", label: "India · English", hl: "en-IN", gl: "IN", ceid: "IN:en", bing: "en-IN" },
  { id: "de-DE", label: "Deutschland · Deutsch", hl: "de", gl: "DE", ceid: "DE:de", bing: "de-DE" },
  { id: "es-ES", label: "España · Español", hl: "es", gl: "ES", ceid: "ES:es", bing: "es-ES" },
];

export function defaultRegion() {
  const lang = navigator.language;
  return (REGIONS.find((r) => r.id === lang) ?? REGIONS.find((r) => r.id.startsWith(lang.slice(0, 2))) ?? REGIONS[4]).id;
}

export const TOPICS = {
  WORLD: { label: "World", emoji: "🌍" },
  NATION: { label: "Your country", emoji: "🏳️" },
  BUSINESS: { label: "Business", emoji: "📈" },
  TECHNOLOGY: { label: "Technology", emoji: "💻" },
  SCIENCE: { label: "Science", emoji: "🔭" },
  HEALTH: { label: "Health", emoji: "🩺" },
  SPORTS: { label: "Sports", emoji: "⚽" },
  ENTERTAINMENT: { label: "Culture", emoji: "🎬" },
} as const;

export type Topic = keyof typeof TOPICS;

/** One story as a source reports it, before merging with other sources' versions. */
export type Candidate = {
  title: string;
  url: string;
  source: string;
  published: number | null;
  snippet?: string;
  image?: string;
  /** Position in its feed: sources list what they consider most important first */
  rank: number;
  /** Other outlets' reports of the same story, when the feed lists them (Google top stories do) */
  group?: Candidate[];
};

const google = (path: string, r: Region) => `https://news.google.com/rss${path}${path.includes("?") ? "&" : "?"}hl=${r.hl}&gl=${r.gl}&ceid=${r.ceid}`;

export const urls = {
  googleTop: (r: Region) => google("", r),
  googleTopic: (t: Topic, r: Region) => google(`/headlines/section/topic/${t}`, r),
  googleSearch: (q: string, r: Region) => google(`/search?q=${encodeURIComponent(`${q} when:1d`)}`, r),
  bingSearch: (q: string, r: Region) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&mkt=${r.bing}&qft=${encodeURIComponent('interval="7"')}`,
  bingTop: (r: Region) => `https://www.bing.com/news?format=rss&mkt=${r.bing}`,
};

/** Fetches a feed through the local fetcher. */
export async function fetchFeed(url: string): Promise<Candidate[]> {
  if (inApp) {
    // The installed apps fetch natively, so no local server is needed.
    const { fetch: nativeFetch } = await import("@tauri-apps/plugin-http");
    const res = await nativeFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Haven feed reader)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
      connectTimeout: 15_000,
    });
    if (!res.ok) throw new Error(`The source answered ${res.status}.`);
    return parseFeed(await res.text());
  }
  const res = await fetch(`/api/feed?url=${encodeURIComponent(url)}`, { headers: { "X-Haven": "1" } });
  if (res.status === 404) throw new Error("NO_PROXY");
  if (!res.ok) throw new Error(await res.text());
  return parseFeed(await res.text());
}

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";
const child = (el: Element, name: string) => el.getElementsByTagName(name)[0] ?? null;

function stripHtml(s: string) {
  const doc = new DOMParser().parseFromString(s, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Bing wraps links in a click tracker; the real address is in its `url` parameter. */
function unwrap(link: string) {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith("bing.com") && u.searchParams.get("url")) return u.searchParams.get("url")!;
  } catch {
    /* keep as is */
  }
  return link;
}

/** RSS 2.0 (including Google's and Bing's extensions) and Atom. */
export function parseFeed(xml: string): Candidate[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];
  const channelTitle = text(doc.querySelector("channel > title")) || text(doc.querySelector("feed > title"));
  const items = [...doc.getElementsByTagName("item")];
  const entries = items.length ? items : [...doc.getElementsByTagName("entry")];

  return entries
    .map((el, rank): Candidate | null => {
      const linkEl = child(el, "link");
      const link = unwrap(text(linkEl) || linkEl?.getAttribute("href") || "");
      let title = stripHtml(text(child(el, "title")));
      const sourceEl = child(el, "source");
      const source = text(child(el, "News:Source")) || text(sourceEl) || channelTitle || hostOf(link);
      // Google appends " - Source" to every title.
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const date = text(child(el, "pubDate")) || text(child(el, "published")) || text(child(el, "updated")) || text(child(el, "dc:date"));
      const published = date ? Date.parse(date) : NaN;
      const rawDescription = text(child(el, "description")) || text(child(el, "summary")) || text(child(el, "content"));
      // Google's descriptions only repeat the headline as a link; they aren't summaries.
      const snippet = sourceEl && /news\.google\./.test(link) ? undefined : stripHtml(rawDescription).replace(/\s*\.\.\.$/, "…").slice(0, 320) || undefined;
      const image =
        bingImage(el) ||
        child(el, "media:content")?.getAttribute("url") ||
        child(el, "media:thumbnail")?.getAttribute("url") ||
        (child(el, "enclosure")?.getAttribute("type")?.startsWith("image") ? child(el, "enclosure")!.getAttribute("url") : null) ||
        undefined;
      if (!title || !link) return null;
      const when = Number.isFinite(published) ? published : null;
      return {
        title,
        url: link,
        source,
        published: when,
        snippet: snippet && snippet !== title ? snippet : undefined,
        image,
        rank,
        group: relatedCoverage(rawDescription, link).map((g) => ({ ...g, published: when, rank })),
      };
    })
    .filter((c): c is Candidate => !!c);
}

/** Google's top-story descriptions are a list of the outlets covering that story. */
function relatedCoverage(description: string, ownLink: string) {
  if (!description.includes("<li")) return [];
  const doc = new DOMParser().parseFromString(description, "text/html");
  return [...doc.querySelectorAll("li")]
    .map((li) => {
      const a = li.querySelector("a");
      return { title: a?.textContent?.trim() ?? "", url: a?.getAttribute("href") ?? "", source: li.querySelector("font")?.textContent?.trim() ?? "" };
    })
    .filter((g) => g.title && g.url && g.source && g.url !== ownLink);
}

function bingImage(el: Element) {
  const src = text(child(el, "News:Image"));
  return src ? `${src.replace(/^http:/, "https:")}&w=640&h=360&c=14` : undefined;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
