import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A show you follow. */
export type Show = {
  /** Made from the feed's address, so the same show is the same on every device */
  id: string;
  feedUrl: string;
  title: string;
  author?: string;
  artwork?: string;
  description?: string;
  link?: string;
  addedAt: number;
  /** Episodes published after this are "new" until you open the show */
  seenAt: number;
};

/** Enough about an episode to list it, queue it and play it. */
export type EpisodeRef = {
  /** Unique across shows: `${showId}:${guid}` */
  id: string;
  showId: string;
  title: string;
  audio: string;
  /** ms since epoch */
  published: number;
  /** seconds */
  duration?: number;
  artwork?: string;
};

export type Episode = EpisodeRef & { description?: string; link?: string };

export type Listen = {
  /** seconds */
  position: number;
  duration?: number;
  played?: boolean;
  updatedAt: number;
};

type PodcastsState = {
  shows: Show[];
  /** Where you are in each episode you've started */
  listens: Record<string, Listen>;
  /** Up next */
  queue: EpisodeRef[];
  speed: number;
  follow: (show: Omit<Show, "addedAt" | "seenAt">) => void;
  unfollow: (id: string) => void;
  updateShow: (id: string, patch: Partial<Show>) => void;
  listen: (episodeId: string, patch: Partial<Listen>) => void;
  setPlayed: (episodeId: string, played: boolean) => void;
  enqueue: (ep: EpisodeRef, { next }?: { next?: boolean }) => void;
  dequeue: (episodeId: string) => void;
  setSpeed: (speed: number) => void;
};

/** Only the latest few hundred listens are kept. */
const KEEP = 400;
const trim = (listens: Record<string, Listen>) => {
  const entries = Object.entries(listens);
  if (entries.length <= KEEP) return listens;
  return Object.fromEntries(entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, KEEP));
};

export const usePodcasts = create<PodcastsState>()(
  persist(
    (set) => ({
      shows: [],
      listens: {},
      queue: [],
      speed: 1,
      follow: (show) =>
        set((s) => (s.shows.some((x) => x.id === show.id) ? s : { shows: [...s.shows, { ...show, addedAt: Date.now(), seenAt: Date.now() }] })),
      unfollow: (id) => set((s) => ({ shows: s.shows.filter((x) => x.id !== id), queue: s.queue.filter((e) => e.showId !== id) })),
      updateShow: (id, patch) => set((s) => ({ shows: s.shows.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      listen: (episodeId, patch) =>
        set((s) => ({ listens: trim({ ...s.listens, [episodeId]: { ...(s.listens[episodeId] ?? { position: 0 }), ...patch, updatedAt: Date.now() } }) })),
      setPlayed: (episodeId, played) =>
        set((s) => ({
          listens: trim({ ...s.listens, [episodeId]: { ...s.listens[episodeId], position: played ? 0 : (s.listens[episodeId]?.position ?? 0), played, updatedAt: Date.now() } }),
          queue: played ? s.queue.filter((e) => e.id !== episodeId) : s.queue,
        })),
      enqueue: (ep, { next = false } = {}) =>
        set((s) => {
          const rest = s.queue.filter((e) => e.id !== ep.id);
          return { queue: next ? [ep, ...rest] : [...rest, ep] };
        }),
      dequeue: (episodeId) => set((s) => ({ queue: s.queue.filter((e) => e.id !== episodeId) })),
      setSpeed: (speed) => set({ speed }),
    }),
    { name: "haven:podcasts", version: 1 },
  ),
);

/** Episodes fetched from the shows' feeds, kept on this device only (not synced: they can always be fetched again). */
type CacheState = {
  feeds: Record<string, { fetchedAt: number; episodes: Episode[] }>;
  put: (showId: string, episodes: Episode[]) => void;
  drop: (showId: string) => void;
};

export const usePodcastCache = create<CacheState>()(
  persist(
    (set) => ({
      feeds: {},
      put: (showId, episodes) => set((s) => ({ feeds: { ...s.feeds, [showId]: { fetchedAt: Date.now(), episodes } } })),
      drop: (showId) =>
        set((s) => {
          const feeds = { ...s.feeds };
          delete feeds[showId];
          return { feeds };
        }),
    }),
    { name: "haven:podcast-cache", version: 1 },
  ),
);

/** A short, stable id from a feed address. */
export function showIdFor(feedUrl: string) {
  let h = 5381;
  const s = feedUrl.trim().replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return `pod-${h.toString(36)}-${s.length.toString(36)}`;
}

/** "1:02:03" / "12:34" */
export function clock(seconds: number) {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "1 h 5 min" / "42 min" */
export function length(seconds?: number) {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${Math.max(1, m)} min`;
}

export const ref = (e: Episode): EpisodeRef => ({ id: e.id, showId: e.showId, title: e.title, audio: e.audio, published: e.published, duration: e.duration, artwork: e.artwork });
