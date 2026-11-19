import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { notify } from "@/lib/notify";
import { fetchShow } from "./sources";
import { usePodcastCache, usePodcasts, type EpisodeRef } from "./store";
import { useLibrary } from "@/modules/library/store";
import { useShelf } from "@/modules/audiobooks/store";

/**
 * The podcast player belongs to the app, not to a screen: it keeps playing while you look at
 * anything else (and while Haven sits in the tray). Your place in each episode is saved as you
 * listen, so it picks up where you left off — on this device or another.
 */

type PlayerState = {
  episode: EpisodeRef | null;
  playing: boolean;
  loading: boolean;
  /** seconds */
  position: number;
  duration: number;
  error: string | null;
};

export const usePlayer = create<PlayerState>()(
  persist(() => ({ episode: null, playing: false, loading: false, position: 0, duration: 0, error: null }) as PlayerState, {
    name: "haven:player",
    // What was playing comes back (paused) next time; the rest is live.
    partialize: (s) => ({ episode: s.episode, position: s.position, duration: s.duration }),
  }),
);

export const SPEEDS = [0.8, 1, 1.2, 1.5, 1.75, 2];

let audio: HTMLAudioElement | null = null;
let lastSaved = 0;

/** A show's name and picture — a podcast you follow, or a book from your Library made into audio. */
export function showInfo(showId: string | undefined): { title: string; author?: string; artwork?: string } | undefined {
  if (!showId) return undefined;
  const show = usePodcasts.getState().shows.find((s) => s.id === showId);
  if (show) return show;
  if (showId.startsWith("ia:")) {
    const b = useShelf.getState().books[showId.slice(3)];
    return b ? { title: b.title, author: b.author, artwork: b.cover } : undefined;
  }
  const book = showId.startsWith("book:") ? useLibrary.getState().books.find((b) => `book:${b.id}` === showId) : undefined;
  return book ? { title: book.title, author: book.author, artwork: book.cover } : undefined;
}

export function useShowInfo(showId: string | undefined) {
  const shows = usePodcasts((s) => s.shows);
  const books = useLibrary((s) => s.books);
  const shelf = useShelf((s) => s.books);
  void shows;
  void books;
  void shelf;
  return showInfo(showId);
}

const showOf = (ep: EpisodeRef) => showInfo(ep.showId);

/** Where an episode's sound is: on the web, or (a book's chapter) on this device. */
let localUrl: string | null = null;
async function sourceOf(ep: EpisodeRef) {
  if (!ep.audio.startsWith("audiobook:")) return ep.audio;
  const [, bookId, i] = ep.audio.split(":");
  const { chapterAudio } = await import("@/modules/library/audiobook");
  const blob = await chapterAudio(bookId, Number(i));
  if (!blob) throw new Error("missing");
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = URL.createObjectURL(blob);
  return localUrl;
}

function save(force = false) {
  const { episode } = usePlayer.getState();
  if (!episode || !audio) return;
  const now = Date.now();
  if (!force && now - lastSaved < 5000) return;
  lastSaved = now;
  usePodcasts.getState().listen(episode.id, { position: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : episode.duration });
}

function element() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";
  const set = usePlayer.setState;
  audio.addEventListener("timeupdate", () => {
    set({ position: audio!.currentTime });
    save();
  });
  audio.addEventListener("loadedmetadata", () => set({ duration: audio!.duration || usePlayer.getState().episode?.duration || 0 }));
  audio.addEventListener("playing", () => set({ playing: true, loading: false, error: null }));
  audio.addEventListener("waiting", () => set({ loading: true }));
  audio.addEventListener("pause", () => {
    set({ playing: false });
    save(true);
  });
  audio.addEventListener("ended", () => {
    const ep = usePlayer.getState().episode;
    if (ep) usePodcasts.getState().setPlayed(ep.id, true);
    set({ playing: false });
    // An audiobook carries on with its next chapter; otherwise, on to the next one in "Up next".
    void (async () => {
      const { nextChapter } = await import("@/modules/audiobooks/store");
      const next = (ep && (await nextChapter(ep))) ?? usePodcasts.getState().queue.find((e) => e.id !== ep?.id);
      if (next) void play(next);
    })();
  });
  audio.addEventListener("error", () => set({ playing: false, loading: false, error: "This episode couldn't be played. The show may have moved or removed it." }));
  wireMediaKeys();
  return audio;
}

/** Plays an episode from where you left it (or resumes the one already loaded). */
export async function play(ep: EpisodeRef) {
  const a = element();
  const { episode } = usePlayer.getState();
  if (episode?.id !== ep.id || !a.src) {
    if (episode && episode.id !== ep.id) save(true);
    const listen = usePodcasts.getState().listens[ep.id];
    const start = listen && !listen.played ? listen.position : 0;
    usePlayer.setState({ episode: ep, position: start, duration: listen?.duration ?? ep.duration ?? 0, loading: true, error: null });
    try {
      a.src = await sourceOf(ep);
    } catch {
      usePlayer.setState({ playing: false, loading: false, error: "This chapter's audio isn't on this device." });
      return;
    }
    a.currentTime = start;
    usePodcasts.getState().dequeue(ep.id);
    if (listen?.played) usePodcasts.getState().setPlayed(ep.id, false);
  }
  a.playbackRate = usePodcasts.getState().speed;
  setMetadata(ep);
  if (ep.showId.startsWith("ia:")) useShelf.getState().touch(ep.showId.slice(3));
  try {
    await a.play();
  } catch (e) {
    usePlayer.setState({ playing: false, loading: false, error: e instanceof Error && e.name === "NotAllowedError" ? null : "This episode couldn't be played." });
  }
}

export function pause() {
  audio?.pause();
}

export function toggle() {
  const { episode, playing } = usePlayer.getState();
  if (!episode) return;
  if (playing) pause();
  else void play(episode);
}

export function seekBy(delta: number) {
  if (!audio || !audio.src) return;
  audio.currentTime = Math.max(0, Math.min((audio.duration || Infinity) - 1, audio.currentTime + delta));
  usePlayer.setState({ position: audio.currentTime });
}

export function seekTo(seconds: number) {
  if (!audio || !audio.src) {
    // Not loaded yet (after a restart): remember where to start.
    const ep = usePlayer.getState().episode;
    if (ep) usePodcasts.getState().listen(ep.id, { position: seconds });
    usePlayer.setState({ position: seconds });
    return;
  }
  audio.currentTime = seconds;
  usePlayer.setState({ position: seconds });
}

export function setSpeed(speed: number) {
  usePodcasts.getState().setSpeed(speed);
  if (audio) audio.playbackRate = speed;
}

/** Stops and closes the player (your place is kept). */
export function close() {
  save(true);
  audio?.pause();
  if (audio) audio.removeAttribute("src");
  usePlayer.setState({ episode: null, playing: false, position: 0, duration: 0, error: null });
}

/** The current position, live. */
export const currentTime = () => audio?.currentTime ?? usePlayer.getState().position;

/* ---------- The system's media controls (keyboard media keys, lock screen) ---------- */

function setMetadata(ep: EpisodeRef) {
  if (!("mediaSession" in navigator)) return;
  const show = showOf(ep);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: ep.title,
    artist: show?.title ?? "",
    album: show?.author ?? "",
    artwork: ep.artwork || show?.artwork ? [{ src: (ep.artwork || show?.artwork)!, sizes: "600x600" }] : [],
  });
}

function wireMediaKeys() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const on = (action: MediaSessionAction, fn: () => void) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* not supported here */
    }
  };
  on("play", () => toggle());
  on("pause", () => pause());
  on("seekbackward", () => seekBy(-15));
  on("seekforward", () => seekBy(30));
  on("nexttrack", () => {
    const next = usePodcasts.getState().queue[0];
    if (next) void play(next);
  });
}

/* ---------- New episodes ---------- */

let checking: Promise<void> | null = null;

/**
 * Fetches the shows you follow; when one has an episode newer than what this device last saw,
 * says so once. The first look at a show only learns what's there.
 */
export function refreshShows({ quiet = false, olderThan = 0 } = {}) {
  checking ??= (async () => {
    const { shows } = usePodcasts.getState();
    const fresh: string[] = [];
    await Promise.all(
      shows.map(async (show) => {
        const cached = usePodcastCache.getState().feeds[show.id];
        if (cached && Date.now() - cached.fetchedAt < olderThan) return;
        try {
          const { show: info, episodes } = await fetchShow(show.feedUrl);
          const newest = cached?.episodes[0]?.published ?? 0;
          if (cached && episodes[0] && episodes[0].published > newest) fresh.push(`${info.title}: ${episodes[0].title}`);
          usePodcastCache.getState().put(show.id, episodes);
          usePodcasts.getState().updateShow(show.id, { title: info.title, author: info.author, artwork: info.artwork ?? show.artwork, description: info.description, link: info.link });
        } catch {
          /* try again next time */
        }
      }),
    );
    if (!quiet && fresh.length) void notify(fresh.length === 1 ? "New podcast episode" : `${fresh.length} new podcast episodes`, fresh.slice(0, 3).join("\n"));
  })().finally(() => (checking = null));
  return checking;
}

/** Keeps an eye out for new episodes: a few seconds after start, then every three hours. */
export function usePodcastChecker() {
  const count = usePodcasts((s) => s.shows.length);
  useEffect(() => {
    if (!count) return;
    const first = setTimeout(() => void refreshShows({ olderThan: 60 * 60_000 }), 20_000);
    const every = setInterval(() => void refreshShows(), 3 * 60 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [count]);
}
