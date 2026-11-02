import { useEffect } from "react";
import { addDays, format } from "date-fns";
import { notify } from "@/lib/notify";
import { dayKey, parseDay } from "@/lib/dates";
import { myPlatforms, platformById, type Offer } from "./platforms";
import { appleAlbum, deezerAlbum, fetchAlbums, fetchGames, fetchMovies, fetchProviders, fetchShows } from "./sources";
import { KINDS, useReleases, useReleasesLocal, type Kind, type Release } from "./store";

let inFlight: Promise<void> | null = null;

/**
 * Looks for releases in your genres, keeps them for the page, and — when something new turned up
 * since the last check — sends one notification about it. The first check only learns what's out
 * there, so you aren't flooded with everything already announced.
 */
export function checkReleases({ quiet = false } = {}) {
  inFlight ??= (async () => {
    const { kinds, genres } = useReleases.getState();
    const local = useReleasesLocal.getState();
    const jobs: [Kind, () => Promise<Release[]>][] = [
      ["movie", () => fetchMovies(genres.movie)],
      ["tv", () => fetchShows(genres.tv)],
      ["music", () => fetchAlbums(genres.music)],
      ["game", () => fetchGames(genres.game)],
    ];
    const errors: Partial<Record<Kind, string>> = {};
    const items: Release[] = [];
    await Promise.all(
      jobs.map(async ([kind, run]) => {
        if (!kinds[kind]) return;
        try {
          items.push(...(await run()));
        } catch (e) {
          errors[kind] = e instanceof Error ? e.message : String(e);
          // Keep what was found last time for a source that failed this time.
          items.push(...local.items.filter((i) => i.kind === kind));
        }
      }),
    );
    const unique = [...new Map(items.map((i) => [i.id, i])).values()].sort((a, b) => a.date.localeCompare(b.date));
    await findWhereToWatch(unique, local.items);
    await watchFollows();

    const seen = new Set(local.seen);
    // Picking a new genre would otherwise announce everything already out in it; learn it quietly instead.
    const signature = JSON.stringify([kinds, genres]);
    const firstTime = local.checkedAt === null || local.signature !== signature;
    const fresh = unique.filter((i) => !seen.has(i.id));
    useReleasesLocal.getState().set({
      items: unique,
      checkedAt: Date.now(),
      signature,
      errors,
      fresh: firstTime ? [] : fresh.map((i) => i.id),
      // Remember plenty, so a release that drops out of the results and comes back isn't announced twice.
      seen: [...new Set([...local.seen, ...unique.map((i) => i.id)])].slice(-3000),
    });
    if (!firstTime && !quiet && fresh.length) {
      const top = fresh.slice(0, 3).map((i) => `${i.title} (${format(parseDay(i.date), "MMM d")})`).join(", ");
      await notify(
        fresh.length === 1 ? "A new release in your genres" : `${fresh.length} new releases in your genres`,
        fresh.length > 3 ? `${top} and ${fresh.length - 3} more` : top,
      );
    }
  })().finally(() => {
    inFlight = null;
    void findOnAppleMusic();
  });
  return inFlight;
}

/** Runs `fn` over `list`, a few at a time. */
async function pool<T>(list: T[], size: number, fn: (x: T) => Promise<void>) {
  const queue = [...list];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x).catch(() => {});
  }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Where each release can be watched, heard or bought. Movies and shows are looked up when they're
 * out or about to be (streaming dates are rarely known earlier); albums once they're out, on Deezer
 * and Apple Music if you use them. A lookup that fails keeps what was found last time.
 */
async function findWhereToWatch(items: Release[], previous: Release[]) {
  const before = new Map(previous.map((i) => [i.id, i]));
  for (const i of items) if (!i.offers && before.get(i.id)?.offers) Object.assign(i, { offers: before.get(i.id)!.offers, watchUrl: before.get(i.id)!.watchUrl });
  const today = dayKey(new Date());
  const soon = dayKey(addDays(new Date(), 14));
  const mine = new Set(myPlatforms());

  await pool(
    items.filter((i) => (i.kind === "movie" || i.kind === "tv") && i.date <= soon),
    6,
    async (i) => void Object.assign(i, await fetchProviders(i)),
  );

  const albums = items.filter((i) => i.kind === "music" && i.date <= today && i.subtitle);
  const found = (i: Release, o: Offer | null) => o && (i.offers = [...(i.offers ?? []).filter((x) => x.platform !== o.platform), o]);
  if (mine.has("deezer")) await pool(albums, 4, async (i) => void found(i, await deezerAlbum(i)));
}

/**
 * Apple's catalogue search allows about 20 requests a minute, so albums are looked up there after
 * the check is saved — the most recent first, a few seconds apart — and each link appears as it's found.
 */
async function findOnAppleMusic() {
  if (!myPlatforms().includes("applemusic")) return;
  const today = dayKey(new Date());
  const todo = useReleasesLocal
    .getState()
    .items.filter((i) => i.kind === "music" && i.date <= today && i.subtitle && !i.offers?.some((o) => o.platform === "applemusic"))
    .reverse()
    .slice(0, 15);
  for (const album of todo) {
    const offer = await appleAlbum(album).catch(() => null);
    if (offer) {
      const { items, set } = useReleasesLocal.getState();
      set({ items: items.map((i) => (i.id === album.id ? { ...i, offers: [...(i.offers ?? []).filter((o) => o.platform !== "applemusic"), offer] } : i)) });
    }
    await wait(3200);
  }
}

/** Followed movies and shows: when one arrives on a platform you pay for, say so. */
async function watchFollows() {
  const { follows } = useReleases.getState();
  const mine = new Set(myPlatforms());
  const today = new Date();
  const candidates = Object.values(follows).filter(
    (f) => (f.kind === "movie" || f.kind === "tv") && f.date <= dayKey(addDays(today, 14)) && f.date >= dayKey(addDays(today, -730)),
  );
  const streaming = (offers?: Offer[]) => new Set((offers ?? []).filter((o) => (o.type === "stream" || o.type === "free" || o.type === "ads") && mine.has(o.platform)).map((o) => o.platform));
  const updates: Record<string, Release> = {};
  await pool(candidates, 4, async (f) => {
    const found = await fetchProviders(f);
    // The first look only sets the starting point, so following something already streaming doesn't ping you.
    if (f.offers) {
      const was = streaming(f.offers);
      const arrived = [...streaming(found.offers)].filter((p) => !was.has(p));
      if (arrived.length) await notify(`Now on ${arrived.map((p) => platformById.get(p)?.name).join(" and ")}: ${f.title}`, `The ${KINDS[f.kind].label.toLowerCase()} you follow can now be watched there.`);
    }
    // Only save a change, so following things doesn't mean writing to your account every day.
    if (JSON.stringify(found.offers) !== JSON.stringify(f.offers ?? null) || found.watchUrl !== f.watchUrl) updates[f.id] = { ...f, ...found };
  });
  if (Object.keys(updates).length) {
    const current = useReleases.getState().follows;
    useReleases.getState().set({ follows: Object.fromEntries(Object.entries(current).map(([id, f]) => [id, updates[id] ?? f])) });
  }
}

const DAY = 24 * 60 * 60_000;

/** Checks once a day while Haven is open (like the Morning edition). */
export function useReleaseChecker() {
  useEffect(() => {
    const tick = () => {
      const { kinds, genres } = useReleases.getState();
      const any = (Object.keys(kinds) as Kind[]).some((k) => kinds[k] && genres[k].length);
      const last = useReleasesLocal.getState().checkedAt ?? 0;
      if (any && Date.now() - last > DAY) void checkReleases();
    };
    // Give the app a moment to start before going online.
    const first = setTimeout(tick, 20_000);
    const later = setInterval(tick, 60 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(later);
    };
  }, []);
}
