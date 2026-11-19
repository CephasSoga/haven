import { inApp } from "@/lib/platform";
import { showIdFor, type Episode, type Show } from "./store";

/**
 * Finding shows uses Apple's public podcast directory (free, no key, the same catalogue most apps
 * use); episodes come straight from each show's own RSS feed.
 */

export class PodcastError extends Error {}

export type Found = Omit<Show, "addedAt" | "seenAt">;

/** Episodes kept per show on this device. */
const KEEP_EPISODES = 60;

async function get(url: string) {
  if (inApp) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(url, { connectTimeout: 15_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; Haven podcasts)" } });
  }
  return fetch(url);
}

export async function searchShows(term: string, country = navigator.language.split("-")[1]?.toLowerCase() || "us"): Promise<Found[]> {
  const qs = new URLSearchParams({ term, media: "podcast", entity: "podcast", limit: "20", country });
  let res: Response;
  try {
    res = await get(`https://itunes.apple.com/search?${qs}`);
  } catch {
    throw new PodcastError("Couldn't reach the podcast directory. Check your internet connection.");
  }
  if (!res.ok) throw new PodcastError(`The podcast directory answered ${res.status}.`);
  const data = (await res.json()) as { results?: { collectionName?: string; artistName?: string; artworkUrl600?: string; artworkUrl100?: string; feedUrl?: string; collectionViewUrl?: string }[] };
  return (data.results ?? [])
    .filter((r) => r.feedUrl && r.collectionName)
    .map((r) => ({ id: showIdFor(r.feedUrl!), feedUrl: r.feedUrl!, title: r.collectionName!, author: r.artistName, artwork: r.artworkUrl600 ?? r.artworkUrl100, link: r.collectionViewUrl }))
    // The same feed listed twice shows once.
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
}

/** The feed's text: natively in the apps, through Haven's own small fetcher in a browser. */
async function feedText(url: string) {
  if (inApp) {
    let res: Response;
    try {
      res = await get(url);
    } catch {
      throw new PodcastError("Couldn't reach this show's feed. Check your internet connection.");
    }
    if (!res.ok) throw new PodcastError(`This show's feed answered ${res.status}.`);
    return res.text();
  }
  const res = await fetch(`/api/feed?url=${encodeURIComponent(url)}`, { headers: { "X-Haven": "1" } });
  if (res.status === 404) throw new PodcastError("Podcasts need the Haven app (or Haven's own server) to read feeds.");
  if (!res.ok) throw new PodcastError(await res.text());
  return res.text();
}

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";
const first = (el: Element | Document, ...names: string[]) => {
  for (const n of names) {
    const found = el.getElementsByTagName(n)[0];
    if (found) return found;
  }
  return null;
};
/** Only the channel's own tags, not its items'. */
const own = (channel: Element, name: string) => [...channel.children].find((c) => c.tagName === name) ?? null;

function plain(html: string, max: number) {
  const t = (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "3605", "60:05" or "1:00:05" → seconds */
function seconds(s: string) {
  if (!s) return undefined;
  const parts = s.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  return parts.reduce((t, n) => t * 60 + n, 0) || undefined;
}

/** Reads a show's feed: what the show is, and its latest episodes (newest first). */
export async function fetchShow(feedUrl: string): Promise<{ show: Found; episodes: Episode[] }> {
  const xml = await feedText(feedUrl);
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const channel = doc.getElementsByTagName("channel")[0];
  if (doc.getElementsByTagName("parsererror").length || !channel) throw new PodcastError("That address isn't a podcast feed.");
  const id = showIdFor(feedUrl);
  const image = own(channel, "image");
  const showArt = own(channel, "itunes:image")?.getAttribute("href") || (image ? text(first(image, "url")) : "") || undefined;
  const show: Found = {
    id,
    feedUrl,
    title: text(own(channel, "title")) || "Untitled show",
    author: text(own(channel, "itunes:author")) || undefined,
    artwork: showArt,
    description: plain(text(own(channel, "description")) || text(own(channel, "itunes:summary")), 600) || undefined,
    link: text(own(channel, "link")) || undefined,
  };
  const episodes: Episode[] = [...channel.getElementsByTagName("item")]
    .map((item) => {
      const enclosure = item.getElementsByTagName("enclosure")[0];
      const audio = enclosure?.getAttribute("url") ?? "";
      const guid = text(first(item, "guid")) || audio;
      const published = Date.parse(text(first(item, "pubDate"))) || 0;
      return {
        id: `${id}:${guid}`,
        showId: id,
        title: text(first(item, "title")) || "Untitled episode",
        audio,
        published,
        duration: seconds(text(first(item, "itunes:duration"))),
        artwork: first(item, "itunes:image")?.getAttribute("href") || showArt,
        description: plain(text(first(item, "description", "itunes:summary", "content:encoded")), 300) || undefined,
        link: text(first(item, "link")) || undefined,
      };
    })
    .filter((e) => e.audio)
    .sort((a, b) => b.published - a.published)
    .slice(0, KEEP_EPISODES);
  return { show, episodes };
}
