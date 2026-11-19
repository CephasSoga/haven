import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import { groupFor, useNotes } from "@/modules/notes/store";
import type { Book } from "./store";

/**
 * What you mark while reading. A highlight colours a passage; a quote is a highlight that's also
 * saved in Notes; a note is your own words (on a passage, or on the page you're at), also saved
 * there. In Notes, each quote or note is a note of its own, filed in a group named after the book —
 * ordinary notes you can edit, move or delete freely.
 */

export type Mark = "yellow" | "green" | "blue" | "pink";
export const MARKS: Record<Mark, { fill: string; label: string }> = {
  yellow: { fill: "#facc15", label: "Yellow" },
  green: { fill: "#4ade80", label: "Green" },
  blue: { fill: "#60a5fa", label: "Blue" },
  pink: { fill: "#f472b6", label: "Pink" },
};

/** A rectangle on a PDF page, as fractions of the page's width and height. */
export type Rect = { x: number; y: number; w: number; h: number };

export type Annotation = {
  id: string;
  bookId: string;
  /** The passage, when one was selected */
  text?: string;
  /** Your own words */
  note?: string;
  color: Mark;
  /** PDF: the page and where the passage sits on it */
  page?: number;
  rects?: Rect[];
  /** EPUB: where the passage (or the page) is */
  cfi?: string;
  /** "p. 12" or the chapter, for showing and for Notes */
  where: string;
  /** Saved in Notes */
  inNotes?: boolean;
  /** The note it became */
  noteId?: string;
  createdAt: number;
};

/** A passage selected in the reader, waiting for you to do something with it. */
export type Selection = { text: string; page?: number; rects?: Rect[]; cfi?: string; where: string };

type AnnotationsState = {
  items: Annotation[];
  add: (a: Omit<Annotation, "id" | "createdAt">) => Annotation;
  update: (id: string, patch: Partial<Annotation>) => void;
  remove: (id: string) => void;
  /** When a book is deleted (what's in Notes stays) */
  removeBook: (bookId: string) => void;
};

export const useAnnotations = create<AnnotationsState>()(
  persist(
    (set) => ({
      items: [],
      add: (a) => {
        const item: Annotation = { ...a, id: uid(), createdAt: Date.now() };
        set((s) => ({ items: [...s.items, item] }));
        return item;
      },
      update: (id, patch) => set((s) => ({ items: s.items.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      remove: (id) => set((s) => ({ items: s.items.filter((a) => a.id !== id) })),
      removeBook: (bookId) => set((s) => ({ items: s.items.filter((a) => a.bookId !== bookId) })),
    }),
    { name: "haven:annotations", version: 1 },
  ),
);

/** Reading order: by page for PDFs, else in the order they were made. */
export function inReadingOrder(items: Annotation[]) {
  return [...items].sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.rects?.[0]?.y ?? 0) - (b.rects?.[0]?.y ?? 0) || a.createdAt - b.createdAt);
}

/** The book's group in Notes, if there is one. */
export function bookGroupId(bookId: string) {
  return useNotes.getState().groups.find((g) => g.source?.kind === "book" && g.source.id === bookId)?.id ?? null;
}

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Saves a quote or note in Notes, as a note of its own in the book's group (made the first time). */
export function writeToNotes(book: Pick<Book, "id" | "title" | "author">, a: Annotation) {
  const groupId = groupFor({ kind: "book", id: book.id }, book.title);
  const cite = `— ${book.title}${book.author ? `, ${book.author}` : ""} · ${a.where}`;
  const passage = a.text ? `“${a.text}”` : "";
  const note = a.note?.trim();
  const id = useNotes.getState().create({
    title: note ? short(note.split("\n")[0]) : short(passage, 62),
    // Your words first, then the passage they're about, then where it's from.
    body: note ? (passage ? `${note}\n\n${passage}\n${cite}` : `${note}\n\n${cite}`) : `${passage}\n\n${cite}`,
    color: "blue",
    groupId,
  });
  useAnnotations.getState().update(a.id, { inNotes: true, noteId: id });
  return id;
}

/** Tidies a selection's text: one line, single spaces, hyphenation from line breaks undone. */
export function cleanPassage(text: string) {
  return text
    .replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}
