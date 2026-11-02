import { create } from "zustand";
import { persist } from "zustand/middleware";
import { deleteFile } from "./files";

export type BookStatus = "to-read" | "reading" | "finished";

export type Book = {
  id: string;
  title: string;
  author?: string;
  format: "pdf" | "epub";
  /** bytes */
  size: number;
  /** Small JPEG data URL rendered from the first page or the EPUB cover */
  cover?: string;
  /** PDFs only */
  pages?: number;
  /** 0 … 1 */
  progress: number;
  /** PDF page number, or EPUB CFI */
  location?: string;
  status: BookStatus;
  addedAt: number;
  lastOpenedAt?: number;
  finishedAt?: number;
  /** Time spent with the reader open, in seconds */
  readingSeconds: number;
};

type LibraryState = {
  books: Book[];
  add: (book: Book) => void;
  update: (id: string, patch: Partial<Book>) => void;
  /** Records where you are; reaching the end marks the book finished. */
  setProgress: (id: string, progress: number, location: string) => void;
  addReadingTime: (id: string, seconds: number) => void;
  remove: (id: string) => Promise<void>;
  replaceAll: (books: Book[]) => void;
};

export const useLibrary = create<LibraryState>()(
  persist(
    (set) => ({
      books: [],
      add: (book) => set((s) => ({ books: [book, ...s.books] })),
      update: (id, patch) => set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),
      setProgress: (id, progress, location) =>
        set((s) => ({
          books: s.books.map((b) => {
            if (b.id !== id) return b;
            const done = progress >= 0.995;
            return {
              ...b,
              progress: Math.min(1, Math.max(0, progress)),
              location,
              status: done ? "finished" : b.status === "finished" ? "finished" : "reading",
              finishedAt: done ? (b.finishedAt ?? Date.now()) : b.finishedAt,
            };
          }),
        })),
      addReadingTime: (id, seconds) =>
        set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, readingSeconds: b.readingSeconds + seconds } : b)) })),
      remove: async (id) => {
        await deleteFile(id);
        set((s) => ({ books: s.books.filter((b) => b.id !== id) }));
      },
      replaceAll: (books) => set({ books }),
    }),
    { name: "haven:library", version: 1 },
  ),
);

export function formatReadingTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
