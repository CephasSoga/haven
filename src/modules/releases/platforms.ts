import { useSubscriptions, type Subscription } from "@/modules/subscriptions/store";
import { useReleases, type Release } from "./store";

/**
 * The services a release can be watched, heard or bought on, and how to recognise each one —
 * in your Subscriptions, in TMDB's "where to watch" data, and in a game's store links.
 */

export type PlatformKind = "video" | "music" | "games";

export type Platform = {
  id: string;
  name: string;
  kind: PlatformKind;
  /** Words that identify it among your subscriptions */
  match: string[];
  /** How TMDB names it, squashed to letters and digits */
  tmdb?: string[];
  /** Where its store pages live (games) */
  host?: RegExp;
  /** A search on the service itself, for when there's no direct link */
  search?: (q: string) => string;
};

const q = encodeURIComponent;

export const PLATFORMS: Platform[] = [
  { id: "netflix", name: "Netflix", kind: "video", match: ["netflix"], tmdb: ["netflix"], search: (s) => `https://www.netflix.com/search?q=${q(s)}` },
  { id: "prime", name: "Prime Video", kind: "video", match: ["prime video", "amazon prime", "amzn prime"], tmdb: ["amazonprimevideo", "primevideo", "amazonvideo"], search: (s) => `https://www.primevideo.com/search/?phrase=${q(s)}` },
  { id: "disney", name: "Disney+", kind: "video", match: ["disney"], tmdb: ["disneyplus"] },
  { id: "appletv", name: "Apple TV", kind: "video", match: ["apple tv"], tmdb: ["appletv"], search: (s) => `https://tv.apple.com/search?term=${q(s)}` },
  { id: "max", name: "Max", kind: "video", match: ["hbo", "max"], tmdb: ["max", "hbomax"] },
  { id: "canal", name: "Canal+", kind: "video", match: ["canal+", "canal plus", "canalplus", "mycanal"], tmdb: ["canal"] },
  { id: "paramount", name: "Paramount+", kind: "video", match: ["paramount"], tmdb: ["paramountplus", "paramount"] },
  { id: "crunchyroll", name: "Crunchyroll", kind: "video", match: ["crunchyroll"], tmdb: ["crunchyroll"], search: (s) => `https://www.crunchyroll.com/search?q=${q(s)}` },
  { id: "youtube", name: "YouTube", kind: "video", match: ["youtube premium", "youtube"], tmdb: ["youtube"], search: (s) => `https://www.youtube.com/results?search_query=${q(s)}` },
  { id: "mubi", name: "MUBI", kind: "video", match: ["mubi"], tmdb: ["mubi"] },

  { id: "spotify", name: "Spotify", kind: "music", match: ["spotify"], search: (s) => `https://open.spotify.com/search/${q(s)}` },
  { id: "applemusic", name: "Apple Music", kind: "music", match: ["apple music", "apple one"], search: (s) => `https://music.apple.com/search?term=${q(s)}` },
  { id: "deezer", name: "Deezer", kind: "music", match: ["deezer"], search: (s) => `https://www.deezer.com/search/${q(s)}` },
  { id: "ytmusic", name: "YouTube Music", kind: "music", match: ["youtube music", "youtube premium"], search: (s) => `https://music.youtube.com/search?q=${q(s)}` },
  { id: "tidal", name: "Tidal", kind: "music", match: ["tidal"], search: (s) => `https://listen.tidal.com/search?q=${q(s)}` },
  { id: "amazonmusic", name: "Amazon Music", kind: "music", match: ["amazon music"], search: (s) => `https://music.amazon.com/search/${q(s)}` },
  { id: "qobuz", name: "Qobuz", kind: "music", match: ["qobuz"], search: (s) => `https://play.qobuz.com/search?q=${q(s)}` },

  { id: "steam", name: "Steam", kind: "games", match: ["steam"], host: /(^|\.)steampowered\.com$|(^|\.)steamcommunity\.com$/ },
  { id: "playstation", name: "PlayStation", kind: "games", match: ["playstation", "psn", "ps plus"], host: /(^|\.)playstation\.com$/ },
  { id: "xbox", name: "Xbox", kind: "games", match: ["xbox", "game pass"], host: /(^|\.)xbox\.com$|(^|\.)microsoft\.com$/ },
  { id: "nintendo", name: "Nintendo", kind: "games", match: ["nintendo"], host: /(^|\.)nintendo\.(com|co\.uk|de|fr|co\.jp)$/ },
  { id: "epic", name: "Epic Games", kind: "games", match: ["epic games"], host: /(^|\.)epicgames\.com$/ },
  { id: "gog", name: "GOG", kind: "games", match: ["gog"], host: /(^|\.)gog\.com$/ },
];

export const platformById = new Map(PLATFORMS.map((p) => [p.id, p]));

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim()} `;

/** The platforms among your active subscriptions and trials ("Netflix Standard", "Spotify Family"…). */
export function fromSubscriptions(subs: Subscription[]) {
  const names = subs.filter((s) => s.status !== "cancelled").map((s) => words(s.name));
  return PLATFORMS.filter((p) => names.some((n) => p.match.some((m) => n.includes(` ${m} `) || n.includes(` ${m}`)))).map((p) => p.id);
}

/** Your platforms: the ones you picked, or else the ones your Subscriptions say you pay for. */
export const myPlatforms = () => useReleases.getState().platforms ?? fromSubscriptions(useSubscriptions.getState().subs);

export function useMyPlatforms() {
  const picked = useReleases((s) => s.platforms);
  const subs = useSubscriptions((s) => s.subs);
  return picked ?? fromSubscriptions(subs);
}

/** Which platform a TMDB provider is ("Netflix basic with Ads" → netflix). Longest name wins, so "Apple TV" ≠ "Apple TV Plus" doesn't matter. */
export function tmdbPlatform(providerName: string) {
  const n = squash(providerName);
  let best: { id: string; len: number } | null = null;
  for (const p of PLATFORMS)
    for (const t of p.tmdb ?? [])
      if ((n === t || n.startsWith(t)) && (!best || t.length > best.len)) best = { id: p.id, len: t.length };
  return best?.id;
}

/** Which store a game's web link points to. */
export function storePlatform(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PLATFORMS.find((p) => p.host?.test(host))?.id;
  } catch {
    return undefined;
  }
}

export type Offer = {
  platform: string;
  /** stream: included in the subscription; free/ads: free to watch; rent/buy: costs extra; store: a game's store page; album: verified album page */
  type: "stream" | "free" | "ads" | "rent" | "buy" | "store" | "album";
  url: string;
};

/** A link worth showing on a card: on one of your platforms, best kind first. */
export type Link = { platform: Platform; url: string; label: string; verified: boolean };

const RANK: Record<Offer["type"], number> = { stream: 0, album: 0, store: 0, free: 1, ads: 1, rent: 2, buy: 3 };

export function linksFor(r: Release, mine: string[], today: string): Link[] {
  const yours = new Set(mine);
  const out = new Map<string, Link & { rank: number }>();
  for (const o of r.offers ?? []) {
    const p = platformById.get(o.platform);
    if (!p || !yours.has(p.id)) continue;
    const rank = RANK[o.type];
    if ((out.get(p.id)?.rank ?? 99) <= rank) continue;
    const label = o.type === "rent" ? `Rent on ${p.name}` : o.type === "buy" ? `Buy on ${p.name}` : p.name;
    out.set(p.id, { platform: p, url: o.url, label, verified: true, rank });
  }
  // Music: services that can't be checked get a search on the service once the album is out.
  if (r.kind === "music" && r.date <= today)
    for (const id of mine) {
      const p = platformById.get(id);
      if (p?.kind !== "music" || out.has(id) || !p.search) continue;
      out.set(id, { platform: p, url: p.search(`${r.subtitle ?? ""} ${r.title}`.trim()), label: p.name, verified: false, rank: 5 });
    }
  return [...out.values()].sort((a, b) => a.rank - b.rank).map(({ rank: _, ...l }) => l);
}
