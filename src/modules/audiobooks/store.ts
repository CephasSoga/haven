import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EpisodeRef, Listen } from "@/modules/podcasts/store";
import { audioUrl, audiobookEpisodeId, audiobookShowId, type Audiobook } from "@/modules/library/audiobook";
import type { BookInfo } from "./sources";

/**
 * Your audiobooks: LibriVox books you've started or saved (synced, so your place carries over
 * between devices), alongside the ones made from your own Library books (on this device). Where you
 * are in each chapter is kept with podcast listening, so the same player resumes both.
 */

export type ShelfBook = Omit<BookInfo, "description"> & { addedAt: number; lastAt?: number };

type ShelfState = {
  books: Record<string, ShelfBook>;
  save: (b: BookInfo) => void;
  touch: (id: string) => void;
  remove: (id: string) => void;
};

export const useShelf = create<ShelfState>()(
  persist(
    (set) => ({
      books: {},
      save: (b) =>
        set((s) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { description, ...keep } = b;
          return { books: { ...s.books, [b.id]: { ...keep, addedAt: s.books[b.id]?.addedAt ?? Date.now(), lastAt: s.books[b.id]?.lastAt } } };
        }),
      touch: (id) => set((s) => (s.books[id] ? { books: { ...s.books, [id]: { ...s.books[id], lastAt: Date.now() } } } : s)),
      remove: (id) =>
        set((s) => {
          const books = { ...s.books };
          delete books[id];
          return { books };
        }),
    }),
    { name: "haven:audiobook-shelf", version: 1 },
  ),
);

/* ---------- Chapters as episodes for the player ---------- */

export const shelfShowId = (id: string) => `ia:${id}`;

export const chapterEpisode = (b: Pick<ShelfBook, "id" | "chapters" | "cover">, i: number): EpisodeRef => ({
  id: `ia:${b.id}:${i}`,
  showId: shelfShowId(b.id),
  title: b.chapters[i].title,
  audio: b.chapters[i].url,
  published: 0,
  duration: b.chapters[i].seconds,
  artwork: b.cover,
});

export const madeEpisode = (a: Audiobook, i: number, cover?: string): EpisodeRef => ({
  id: audiobookEpisodeId(a.bookId, i),
  showId: audiobookShowId(a.bookId),
  title: a.chapters[i].title,
  audio: audioUrl(a.bookId, i),
  published: 0,
  duration: a.chapters[i].seconds,
  artwork: cover,
});

/** All of a book's episodes: a LibriVox book's chapters, or a made book's ready chapters. */
export function episodesOf(showId: string): EpisodeRef[] {
  if (showId.startsWith("ia:")) {
    const b = useShelf.getState().books[showId.slice(3)];
    return b ? b.chapters.map((_, i) => chapterEpisode(b, i)) : [];
  }
  return [];
}

/** The chapter after this one, when it's a chapter of an audiobook (so listening carries on). */
export async function nextChapter(ep: EpisodeRef): Promise<EpisodeRef | null> {
  if (ep.showId.startsWith("ia:")) {
    const list = episodesOf(ep.showId);
    const i = list.findIndex((e) => e.id === ep.id);
    return i >= 0 ? (list[i + 1] ?? null) : null;
  }
  if (ep.showId.startsWith("book:")) {
    const { useAudiobooks } = await import("@/modules/library/audiobook");
    const { useLibrary } = await import("@/modules/library/store");
    const bookId = ep.showId.slice(5);
    const a = useAudiobooks.getState().books[bookId];
    const i = Number(ep.id.split(":").pop());
    if (!a || a.chapters[i + 1]?.state !== "ready") return null;
    return madeEpisode(a, i + 1, useLibrary.getState().books.find((b) => b.id === bookId)?.cover);
  }
  return null;
}

/** How far into a book you are: the chapter to resume, and how much is left. */
export function progressOf(episodes: EpisodeRef[], listens: Record<string, Listen>) {
  let resume = 0;
  let latest = 0;
  let left = 0;
  let started = false;
  episodes.forEach((e, i) => {
    const l = listens[e.id];
    if (l && l.updatedAt > latest) {
      latest = l.updatedAt;
      // Finished chapter: carry on with the next one.
      resume = l.played ? Math.min(i + 1, episodes.length - 1) : i;
      started = true;
    }
  });
  episodes.forEach((e, i) => {
    const l = listens[e.id];
    const total = e.duration ?? 0;
    if (i > resume || (i === resume && !l?.played)) left += Math.max(0, total - (i === resume ? (l?.position ?? 0) : 0));
  });
  const finished = episodes.length > 0 && episodes.every((e) => listens[e.id]?.played);
  return { started, resume, left, finished, lastAt: latest };
}
