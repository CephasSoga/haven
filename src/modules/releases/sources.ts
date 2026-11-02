import { addDays, format } from "date-fns";
import { inApp } from "@/lib/platform";
import { useFeed } from "@/modules/feed/store";
import { platformById, storePlatform, tmdbPlatform, type Offer } from "./platforms";
import { MOVIE_GENRES, TV_GENRES, useReleasesLocal, type Release } from "./store";

/**
 * Where releases come from:
 *   Movies & TV — TMDB (The Movie Database), with your free API key
 *   Music       — MusicBrainz, the open music encyclopedia (no key)
 *   Games       — IGDB (Twitch's games database), with your free Twitch developer keys
 * Each looks from two weeks back (in case you missed something) to four months ahead.
 */

const PAST_DAYS = 14;
const AHEAD_DAYS = 120;
const day = (d: Date) => format(d, "yyyy-MM-dd");
const windowDates = () => ({ from: addDays(new Date(), -PAST_DAYS), to: addDays(new Date(), AHEAD_DAYS) });

/** The apps fetch natively (no browser restrictions); a browser tab uses its own fetch. */
async function get(url: string, init?: RequestInit & { connectTimeout?: number }) {
  if (inApp) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(url, { connectTimeout: 15_000, ...init });
  }
  return fetch(url, init);
}

export class SourceError extends Error {}

/* ---------- TMDB: movies and TV ---------- */

/** Your country, for release dates and streaming catalogues — the region chosen for the Morning edition. */
export const region = () => (useFeed.getState().region?.split("-")[1] ?? navigator.language.split("-")[1] ?? "US").toUpperCase();

async function tmdb(path: string, params: Record<string, string>) {
  const key = useReleasesLocal.getState().keys.tmdb.trim();
  if (!key) throw new SourceError("Add your TMDB key to see movies and TV shows.");
  // TMDB gives two kinds of key: a short "API key" (sent in the address) or a long "read access token" (sent as a header).
  const bearer = key.startsWith("eyJ");
  const qs = new URLSearchParams({ language: navigator.language || "en-US", ...params, ...(bearer ? {} : { api_key: key }) });
  const res = await get(`https://api.themoviedb.org/3${path}?${qs}`, { headers: bearer ? { Authorization: `Bearer ${key}` } : {} }).catch(() => {
    throw new SourceError("Couldn't reach TMDB. Check your connection.");
  });
  if (res.status === 401) throw new SourceError("TMDB didn't accept the key. Check it under Sources.");
  if (!res.ok) throw new SourceError(`TMDB answered ${res.status}.`);
  return res.json();
}

const poster = (path?: string | null) => (path ? `https://image.tmdb.org/t/p/w342${path}` : undefined);

type TmdbItem = { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null; genre_ids: number[]; overview?: string };

export async function fetchMovies(genres: number[]): Promise<Release[]> {
  if (!genres.length) return [];
  const { from, to } = windowDates();
  const names = new Map(MOVIE_GENRES);
  const out: Release[] = [];
  for (const page of ["1", "2"]) {
    const data = await tmdb("/discover/movie", {
      region: region(),
      // Theatrical (limited, wide) and digital releases in your country.
      with_release_type: "3|2|4",
      "release_date.gte": day(from),
      "release_date.lte": day(to),
      with_genres: genres.join("|"),
      sort_by: "popularity.desc",
      page,
    });
    for (const m of data.results as TmdbItem[]) {
      if (!m.release_date) continue;
      out.push({
        id: `movie:${m.id}`,
        kind: "movie",
        title: m.title ?? "",
        date: m.release_date,
        image: poster(m.poster_path),
        genres: m.genre_ids.map((g) => names.get(g)).filter(Boolean) as string[],
        overview: m.overview || undefined,
        url: `https://www.themoviedb.org/movie/${m.id}`,
      });
    }
    if (data.total_pages <= 1) break;
  }
  return out;
}

export async function fetchShows(genres: number[]): Promise<Release[]> {
  if (!genres.length) return [];
  const { from, to } = windowDates();
  const names = new Map(TV_GENRES);
  const out: Release[] = [];
  for (const page of ["1", "2"]) {
    const data = await tmdb("/discover/tv", {
      "first_air_date.gte": day(from),
      "first_air_date.lte": day(to),
      with_genres: genres.join("|"),
      sort_by: "popularity.desc",
      page,
    });
    for (const s of data.results as TmdbItem[]) {
      if (!s.first_air_date) continue;
      out.push({
        id: `tv:${s.id}`,
        kind: "tv",
        title: s.name ?? "",
        date: s.first_air_date,
        subtitle: "New series",
        image: poster(s.poster_path),
        genres: s.genre_ids.map((g) => names.get(g)).filter(Boolean) as string[],
        overview: s.overview || undefined,
        url: `https://www.themoviedb.org/tv/${s.id}`,
      });
    }
    if (data.total_pages <= 1) break;
  }
  return out;
}

/** A light request to check a TMDB key. */
export const testTmdb = () => tmdb("/genre/movie/list", {});

type Providers = { link?: string; flatrate?: { provider_name: string }[]; free?: { provider_name: string }[]; ads?: { provider_name: string }[]; rent?: { provider_name: string }[]; buy?: { provider_name: string }[] };

/**
 * Where a movie or show can be watched in your country (TMDB's data comes from JustWatch).
 * Links go to a search for the title on the service when it has one, else to TMDB's "where to watch" page.
 */
export async function fetchProviders(r: Release): Promise<{ offers: Offer[]; watchUrl?: string }> {
  const [kind, id] = r.id.split(":");
  const data = await tmdb(`/${kind}/${id}/watch/providers`, {});
  const here = (data.results ?? {})[region()] as Providers | undefined;
  if (!here) return { offers: [] };
  const offers: Offer[] = [];
  const add = (list: { provider_name: string }[] | undefined, type: Offer["type"]) => {
    for (const p of list ?? []) {
      const platform = tmdbPlatform(p.provider_name);
      if (!platform) continue;
      const search = platformById.get(platform)?.search;
      offers.push({ platform, type, url: search ? search(r.title) : (here.link ?? r.url) });
    }
  };
  add(here.flatrate, "stream");
  add(here.free, "free");
  add(here.ads, "ads");
  add(here.rent, "rent");
  add(here.buy, "buy");
  return { offers, watchUrl: here.link };
}

/* ---------- MusicBrainz: albums ---------- */

type MbGroup = { id: string; title: string; "first-release-date"?: string; "primary-type"?: string; "artist-credit"?: { name: string; joinphrase?: string }[]; tags?: { name: string }[] };

export async function fetchAlbums(tags: string[]): Promise<Release[]> {
  if (!tags.length) return [];
  const { from, to } = windowDates();
  const quote = (t: string) => `"${t.replace(/"/g, "")}"`;
  const query = `(${tags.map((t) => `tag:${quote(t)}`).join(" OR ")}) AND primarytype:album AND firstreleasedate:[${day(from)} TO ${day(to)}]`;
  const url = `https://musicbrainz.org/ws/2/release-group?${new URLSearchParams({ query, fmt: "json", limit: "100" })}`;
  // MusicBrainz asks apps to say who they are, and allows about one request a second — wait and retry once if it's busy.
  const ask = () =>
    get(url, inApp ? { headers: { "User-Agent": "Haven/0.2 (https://github.com/CephasSoga/haven)" } } : undefined).catch(() => {
      throw new SourceError("Couldn't reach MusicBrainz. Check your connection.");
    });
  let res = await ask();
  if (res.status === 503) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await ask();
  }
  if (res.status === 503) throw new SourceError("MusicBrainz is busy right now; Haven will try again later.");
  if (!res.ok) throw new SourceError(`MusicBrainz answered ${res.status}.`);
  const data = (await res.json()) as { "release-groups": MbGroup[] };
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  return (
    data["release-groups"]
      // Only exact days: a release listed as just "2026" can't be put on a timeline.
      .filter((g) => /^\d{4}-\d{2}-\d{2}$/.test(g["first-release-date"] ?? ""))
      .map((g) => ({
        id: `music:${g.id}`,
        kind: "music" as const,
        title: g.title,
        date: g["first-release-date"]!,
        subtitle: (g["artist-credit"] ?? []).map((a) => a.name + (a.joinphrase ?? "")).join("") || undefined,
        image: `https://coverartarchive.org/release-group/${g.id}/front-250`,
        genres: (g.tags ?? []).map((t) => t.name).filter((t) => wanted.has(t.toLowerCase())),
        url: `https://musicbrainz.org/release-group/${g.id}`,
      }))
  );
}

/* ---------- IGDB: games ---------- */

async function igdbToken() {
  const local = useReleasesLocal.getState();
  const { igdbId, igdbSecret } = local.keys;
  if (!igdbId.trim() || !igdbSecret.trim()) throw new SourceError("Add your Twitch developer keys to see games.");
  if (local.igdbToken && local.igdbToken.expires > Date.now() + 60_000) return local.igdbToken.value;
  const qs = new URLSearchParams({ client_id: igdbId.trim(), client_secret: igdbSecret.trim(), grant_type: "client_credentials" });
  const res = await get(`https://id.twitch.tv/oauth2/token?${qs}`, { method: "POST" }).catch(() => {
    throw new SourceError("Couldn't reach Twitch to sign in to IGDB.");
  });
  if (res.status === 400 || res.status === 403) throw new SourceError("Twitch didn't accept the Client ID or secret. Check them under Sources.");
  if (!res.ok) throw new SourceError(`Twitch answered ${res.status}.`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  useReleasesLocal.getState().set({ igdbToken: { value: access_token, expires: Date.now() + expires_in * 1000 } });
  return access_token;
}

async function igdb<T>(endpoint: string, body: string): Promise<T> {
  // IGDB doesn't accept requests from web pages, only from apps.
  if (!inApp) throw new SourceError("Games are checked in the Haven app — IGDB doesn't answer browsers.");
  const token = await igdbToken();
  const res = await get(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: { "Client-ID": useReleasesLocal.getState().keys.igdbId.trim(), Authorization: `Bearer ${token}`, Accept: "application/json" },
    body,
  }).catch(() => {
    throw new SourceError("Couldn't reach IGDB. Check your connection.");
  });
  if (res.status === 401) {
    useReleasesLocal.getState().set({ igdbToken: undefined });
    throw new SourceError("IGDB's sign-in expired; it will renew on the next check.");
  }
  if (!res.ok) throw new SourceError(`IGDB answered ${res.status}.`);
  return res.json() as Promise<T>;
}

/** IGDB's genres ("g…") and themes ("t…") — horror or sci-fi are themes there, not genres. */
export async function fetchGameGenres() {
  const [genres, themes] = await Promise.all([
    igdb<{ id: number; name: string }[]>("genres", "fields name; limit 100; sort name asc;"),
    igdb<{ id: number; name: string }[]>("themes", "fields name; limit 100; sort name asc;"),
  ]);
  return [...genres.map((g) => ({ id: `g${g.id}`, name: g.name })), ...themes.map((t) => ({ id: `t${t.id}`, name: t.name }))].sort((a, b) => a.name.localeCompare(b.name));
}

type IgdbGame = { id: number; name: string; first_release_date?: number; cover?: { image_id: string }; genres?: { name: string }[]; themes?: { name: string }[]; platforms?: { abbreviation?: string; name: string }[]; summary?: string; url?: string; websites?: { url: string }[] };

export async function fetchGames(picked: string[]): Promise<Release[]> {
  if (!picked.length) return [];
  const { from, to } = windowDates();
  const genres = picked.filter((g) => g.startsWith("g")).map((g) => g.slice(1));
  const themes = picked.filter((g) => g.startsWith("t")).map((g) => g.slice(1));
  const match = [genres.length && `genres = (${genres.join(",")})`, themes.length && `themes = (${themes.join(",")})`].filter(Boolean).join(" | ");
  const s = (d: Date) => Math.floor(d.getTime() / 1000);
  // Main games only (no DLC, editions or bundles), and only ones people are waiting for — IGDB lists thousands of tiny releases.
  const body = `fields name,first_release_date,cover.image_id,genres.name,themes.name,platforms.abbreviation,platforms.name,summary,url,websites.url;
where first_release_date >= ${s(from)} & first_release_date < ${s(to)} & (${match}) & parent_game = null & version_parent = null & hypes >= 3;
sort hypes desc; limit 80;`;
  const games = await igdb<IgdbGame[]>("games", body);
  return games
    .filter((g) => g.first_release_date)
    .map((g) => ({
      id: `game:${g.id}`,
      kind: "game" as const,
      title: g.name,
      date: day(new Date(g.first_release_date! * 1000)),
      subtitle: (g.platforms ?? []).map((p) => p.abbreviation || p.name).slice(0, 4).join(", ") || undefined,
      image: g.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : undefined,
      genres: [...(g.genres ?? []), ...(g.themes ?? [])].map((x) => x.name).slice(0, 4),
      overview: g.summary,
      url: g.url ?? `https://www.igdb.com/search?q=${encodeURIComponent(g.name)}`,
      // Its pages on the stores (Steam, PlayStation Store, eShop…), one per store.
      offers: [...new Map((g.websites ?? []).map((w) => [storePlatform(w.url), w.url] as const).filter(([p]) => p)).entries()].map(([platform, url]) => ({ platform: platform!, type: "store" as const, url })),
    }));
}

/* ---------- Music: the album's page on Deezer and Apple Music ---------- */

const same = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The album on Deezer, if Deezer has it (no key needed). */
export async function deezerAlbum(r: Release): Promise<Offer | null> {
  const query = `artist:"${(r.subtitle ?? "").replace(/"/g, "")}" album:"${r.title.replace(/"/g, "")}"`;
  const res = await get(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=5`);
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { title: string; link: string }[] };
  const hit = data.data?.find((a) => same(a.title, r.title)) ?? null;
  return hit ? { platform: "deezer", type: "album", url: hit.link } : null;
}

/** The album on Apple Music, through Apple's public catalogue search (no key needed). */
export async function appleAlbum(r: Release): Promise<Offer | null> {
  const qs = new URLSearchParams({ term: `${r.subtitle ?? ""} ${r.title}`.trim(), entity: "album", limit: "5", country: region() });
  const res = await get(`https://itunes.apple.com/search?${qs}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: { collectionName: string; collectionViewUrl: string }[] };
  const hit = data.results?.find((a) => same(a.collectionName.replace(/ - (single|ep)$/i, ""), r.title)) ?? null;
  return hit ? { platform: "applemusic", type: "album", url: hit.collectionViewUrl } : null;
}
