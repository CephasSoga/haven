import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";

export type Note = {
  id: string;
  title: string;
  body: string;
  color: string;
  pinned: boolean;
  /** The group it's filed in; none = ungrouped */
  groupId?: string;
  /** epoch ms */
  createdAt: number;
  updatedAt: number;
};

/** A group of notes. Haven makes some itself — one per book you take notes in, one per podcast. */
export type NoteGroup = {
  id: string;
  name: string;
  /** What Haven made it for, so it finds it again (and shows the right icon) */
  source?: { kind: "book" | "podcast" | "learning"; id: string };
  createdAt: number;
};

type NotesState = {
  notes: Note[];
  groups: NoteGroup[];
  create: (patch?: Partial<Note>) => string;
  update: (id: string, patch: Partial<Omit<Note, "id" | "createdAt">>) => void;
  remove: (id: string) => void;
  replaceAll: (notes: Note[], groups?: NoteGroup[]) => void;
  addGroup: (name: string, source?: NoteGroup["source"]) => string;
  renameGroup: (id: string, name: string) => void;
  /** The group goes; its notes stay, ungrouped */
  removeGroup: (id: string) => void;
};

export const useNotes = create<NotesState>()(
  persist(
    (set) => ({
      notes: [],
      groups: [],
      create: (patch) => {
        const now = Date.now();
        const note: Note = { id: uid(), title: "", body: "", color: "amber", pinned: false, createdAt: now, updatedAt: now, ...patch };
        set((s) => ({ notes: [note, ...s.notes] }));
        return note.id;
      },
      update: (id, patch) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)) })),
      remove: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      replaceAll: (notes, groups) => set((s) => ({ notes, groups: groups ?? s.groups })),
      addGroup: (name, source) => {
        const group: NoteGroup = { id: uid(), name: name.trim() || "Untitled group", source, createdAt: Date.now() };
        set((s) => ({ groups: [...s.groups, group] }));
        return group.id;
      },
      renameGroup: (id, name) => set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name } : g)) })),
      removeGroup: (id) =>
        set((s) => ({ groups: s.groups.filter((g) => g.id !== id), notes: s.notes.map((n) => (n.groupId === id ? { ...n, groupId: undefined } : n)) })),
    }),
    {
      name: "haven:notes",
      version: 4,
      migrate: (persisted, version) => {
        const s = persisted as { notes?: Note[]; pages?: PageV2[]; groups?: NoteGroup[] };
        // Version 2 stored nested, block-based pages; bring them back as plain notes.
        if (version === 2) return { notes: fromPages(s.pages ?? []), groups: [] };
        return { notes: s.notes ?? [], groups: s.groups ?? [] };
      },
    },
  ),
);

/* ---------- Converting block-based pages (version 2) back to notes ---------- */

type BlockV2 = { type?: string; props?: { checked?: boolean; level?: number }; content?: unknown; children?: BlockV2[] };
export type PageV2 = { id: string; title: string; content: BlockV2[]; cover?: string; favorite?: boolean; trashedAt?: number; createdAt: number; updatedAt: number };

const COVER_COLORS: Record<string, string> = { dawn: "violet", sea: "blue", meadow: "green", citrus: "amber", sand: "orange", mist: "slate", dusk: "pink", ink: "slate" };

function inline(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: { type?: string; text?: string; href?: string; content?: unknown }) =>
      c.type === "link" ? `${inline(c.content)} (${c.href})` : (c.text ?? inline(c.content)),
    )
    .join("");
}

function blocksToText(blocks: BlockV2[], indent = ""): string[] {
  const lines: string[] = [];
  let n = 0;
  for (const b of blocks) {
    const text = inline(b.content);
    n = b.type === "numberedListItem" ? n + 1 : 0;
    if (b.type === "bulletListItem") lines.push(`${indent}- ${text}`);
    else if (b.type === "numberedListItem") lines.push(`${indent}${n}. ${text}`);
    else if (b.type === "checkListItem") lines.push(`${indent}[${b.props?.checked ? "x" : " "}] ${text}`);
    else if (b.type === "quote") lines.push(`${indent}> ${text}`);
    else if (b.type === "heading") lines.push("", `${indent}${text}`);
    else lines.push(`${indent}${text}`);
    if (b.children?.length) lines.push(...blocksToText(b.children, `${indent}  `));
  }
  return lines;
}

export function fromPages(pages: PageV2[]): Note[] {
  return pages
    .filter((p) => !p.trashedAt)
    .map((p) => ({
      id: p.id,
      title: p.title,
      body: blocksToText(p.content ?? []).join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n"),
      color: (p.cover && COVER_COLORS[p.cover]) || "amber",
      pinned: !!p.favorite,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
}

/** The group Haven keeps for a book or podcast, made (or remade, if you deleted it) when needed. */
export function groupFor(source: NonNullable<NoteGroup["source"]>, name: string) {
  const { groups, addGroup } = useNotes.getState();
  return groups.find((g) => g.source?.kind === source.kind && g.source.id === source.id)?.id ?? addGroup(name, source);
}

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
