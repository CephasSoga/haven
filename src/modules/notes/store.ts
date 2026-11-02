import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";

/** Editor blocks, stored as the editor's own JSON. Kept loose here so the store doesn't depend on the editor. */
export type Blocks = Record<string, unknown>[];

export type Page = {
  id: string;
  parentId: string | null;
  title: string;
  /** An emoji */
  icon?: string;
  /** One of COVERS */
  cover?: string;
  content: Blocks;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  /** Set when the page is in the trash */
  trashedAt?: number;
};

export const COVERS: Record<string, string> = {
  dawn: "linear-gradient(120deg, #f7d6c4 0%, #ecb9d3 45%, #b8b3f1 100%)",
  sea: "linear-gradient(120deg, #b3e6da 0%, #7fbbe8 55%, #6d7fda 100%)",
  meadow: "linear-gradient(120deg, #e1f1b8 0%, #a5d9a0 50%, #4fae96 100%)",
  citrus: "linear-gradient(120deg, #fff2b3 0%, #ffca7a 50%, #ff977a 100%)",
  sand: "linear-gradient(120deg, #f5ead2 0%, #e7c899 55%, #cf9568 100%)",
  mist: "linear-gradient(120deg, #eef2f6 0%, #d3dce6 50%, #b3c1d3 100%)",
  dusk: "linear-gradient(120deg, #2a2c55 0%, #6a4c93 50%, #e07a8e 100%)",
  ink: "linear-gradient(120deg, #1d2130 0%, #394057 55%, #5a637e 100%)",
};

type NotesState = {
  pages: Page[];
  create: (patch?: Partial<Page>) => string;
  update: (id: string, patch: Partial<Omit<Page, "id" | "createdAt">>) => void;
  /** Moves a page and everything inside it to the trash */
  trash: (id: string) => void;
  restore: (id: string) => void;
  /** Deletes a trashed page and its subpages for good */
  destroy: (id: string) => void;
  replaceAll: (pages: Page[]) => void;
};

export function descendants(pages: Page[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) if (p.parentId && out.has(p.parentId) && !out.has(p.id)) (out.add(p.id), (grew = true));
  }
  return out;
}

export const useNotes = create<NotesState>()(
  persist(
    (set) => ({
      pages: [],
      create: (patch) => {
        const now = Date.now();
        const page: Page = { id: uid(), parentId: null, title: "", content: [], favorite: false, createdAt: now, updatedAt: now, ...patch };
        set((s) => ({ pages: [...s.pages, page] }));
        return page.id;
      },
      update: (id, patch) => set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) })),
      trash: (id) =>
        set((s) => {
          const ids = descendants(s.pages, id);
          const at = Date.now();
          return { pages: s.pages.map((p) => (ids.has(p.id) ? { ...p, trashedAt: at } : p)) };
        }),
      restore: (id) =>
        set((s) => {
          const ids = descendants(s.pages, id);
          const page = s.pages.find((p) => p.id === id);
          const parent = s.pages.find((p) => p.id === page?.parentId);
          // If its parent is still in the trash, the restored page comes back at the top level.
          const orphan = parent?.trashedAt && !ids.has(parent.id);
          return {
            pages: s.pages.map((p) =>
              ids.has(p.id) ? { ...p, trashedAt: undefined, parentId: p.id === id && orphan ? null : p.parentId } : p,
            ),
          };
        }),
      destroy: (id) =>
        set((s) => {
          const ids = descendants(s.pages, id);
          return { pages: s.pages.filter((p) => !ids.has(p.id)) };
        }),
      replaceAll: (pages) => set({ pages }),
    }),
    {
      name: "haven:notes",
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as { notes?: LegacyNote[]; pages?: Page[] };
        if (version < 2) return { pages: (s.notes ?? []).map(fromLegacy) };
        return s;
      },
    },
  ),
);

/* ---------- Upgrading notes from the first version ---------- */

export type LegacyNote = { id: string; title: string; body: string; color: string; pinned: boolean; createdAt: number; updatedAt: number };

const LEGACY_COVERS: Record<string, string> = { violet: "dawn", blue: "sea", teal: "sea", green: "meadow", amber: "citrus", orange: "citrus", rose: "dawn", pink: "dawn", slate: "mist" };

export function textToBlocks(text: string): Blocks {
  return text
    .split("\n")
    .filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()))
    .map((line) => {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) return { type: "bulletListItem", content: bullet[1] };
      const todo = line.match(/^\s*\[( |x)\]\s+(.*)$/i);
      if (todo) return { type: "checkListItem", props: { checked: todo[1] !== " " }, content: todo[2] };
      return { type: "paragraph", content: line };
    });
}

export function fromLegacy(n: LegacyNote): Page {
  return {
    id: n.id,
    parentId: null,
    title: n.title,
    content: textToBlocks(n.body),
    cover: LEGACY_COVERS[n.color],
    favorite: n.pinned,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

/* ---------- Reading content ---------- */

function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    // Tables keep their cells under content.rows[].cells[]
    const rows = (content as { rows?: { cells?: unknown[] }[] } | undefined)?.rows;
    return rows ? rows.flatMap((r) => (r.cells ?? []).map((c) => inlineText((c as { content?: unknown })?.content ?? c))).join(" ") : "";
  }
  return content
    .map((c) => {
      const node = c as { text?: string; content?: unknown };
      return node.text ?? inlineText(node.content);
    })
    .join("");
}

/** Plain text of a page's blocks, for search and previews. */
export function pageText(blocks: Blocks): string {
  return blocks
    .map((b) => [inlineText(b.content), pageText((b.children as Blocks) ?? [])].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" ");
}

export function sortPages(a: Page, b: Page) {
  return a.createdAt - b.createdAt;
}
