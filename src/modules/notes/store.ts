import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";

export type Note = {
  id: string;
  title: string;
  body: string;
  color: string;
  pinned: boolean;
  /** epoch ms */
  createdAt: number;
  updatedAt: number;
};

type NotesState = {
  notes: Note[];
  create: (patch?: Partial<Note>) => string;
  update: (id: string, patch: Partial<Omit<Note, "id" | "createdAt">>) => void;
  remove: (id: string) => void;
  replaceAll: (notes: Note[]) => void;
};

export const useNotes = create<NotesState>()(
  persist(
    (set) => ({
      notes: [],
      create: (patch) => {
        const now = Date.now();
        const note: Note = { id: uid(), title: "", body: "", color: "amber", pinned: false, createdAt: now, updatedAt: now, ...patch };
        set((s) => ({ notes: [note, ...s.notes] }));
        return note.id;
      },
      update: (id, patch) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)) })),
      remove: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      replaceAll: (notes) => set({ notes }),
    }),
    { name: "haven:notes", version: 1 },
  ),
);

export function isBlank(n: Note) {
  return !n.title.trim() && !n.body.trim();
}

const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;

/** Tags are written inline as #words anywhere in the note. */
export function tagsOf(n: Note) {
  const tags = new Set<string>();
  for (const m of `${n.title}\n${n.body}`.matchAll(TAG_RE)) tags.add(m[1].toLowerCase());
  return tags;
}

export function preview(n: Note) {
  return n.body.replace(/\s+/g, " ").trim();
}

/** Pinned first, then most recently edited. */
export function compareNotes(a: Note, b: Note) {
  return Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt;
}
