import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, FileText, Plus, RotateCcw, Search, Star, Trash2 } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { pageText, sortPages, type Page } from "./store";

type Props = {
  pages: Page[];
  trashed: Page[];
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onCreate: (parentId: string | null) => void;
  onRestore: (id: string) => void;
  onDestroy: (id: string) => void;
};

function Icon({ page, className }: { page: Page; className?: string }) {
  return page.icon ? (
    <span className={cn("w-5 shrink-0 text-center text-[15px] leading-none", className)}>{page.icon}</span>
  ) : (
    <FileText className={cn("size-4 shrink-0 text-faint", className)} />
  );
}

function Label({ children }: { children: string }) {
  return <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</div>;
}

/** The sidebar: search, favorites, the nested page tree and the trash. */
export function PageTree(props: Props) {
  const { pages, trashed, selectedId, onSelect, onCreate, onRestore, onDestroy } = props;
  const [query, setQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Page[]>();
    for (const p of [...pages].sort(sortPages)) map.set(p.parentId, [...(map.get(p.parentId) ?? []), p]);
    return map;
  }, [pages]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return pages.filter((p) => `${p.title}\n${pageText(p.content)}`.toLowerCase().includes(q));
  }, [pages, query]);

  const favorites = pages.filter((p) => p.favorite).sort(sortPages);
  // Only show trashed pages whose parent isn't also trashed; restoring brings the subtree back.
  const trashRoots = trashed.filter((p) => !trashed.some((t) => t.id === p.parentId));

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pages" className="h-9 pl-9 text-[14px]" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {results ? (
          <>
            <Label>{`${results.length} ${results.length === 1 ? "result" : "results"}`}</Label>
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[14px]", p.id === selectedId ? "bg-sunken font-medium" : "text-muted hover:bg-sunken/60 hover:text-ink")}
              >
                <Icon page={p} />
                <span className="truncate">{p.title || "Untitled"}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            {favorites.length > 0 && (
              <>
                <Label>Favorites</Label>
                {favorites.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onSelect(p.id)}
                    className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[14px]", p.id === selectedId ? "bg-sunken font-medium text-ink" : "text-muted hover:bg-sunken/60 hover:text-ink")}
                  >
                    <Icon page={p} />
                    <span className="flex-1 truncate">{p.title || "Untitled"}</span>
                    <Star className="size-3 shrink-0 fill-current text-note" />
                  </button>
                ))}
              </>
            )}
            <div className="flex items-center justify-between pr-1">
              <Label>Pages</Label>
              <button onClick={() => onCreate(null)} aria-label="New page" className="mt-3 rounded-md p-1 text-faint hover:bg-sunken hover:text-ink">
                <Plus className="size-4" />
              </button>
            </div>
            {(childrenOf.get(null) ?? []).map((p) => (
              <TreeRow key={p.id} page={p} depth={0} childrenOf={childrenOf} {...props} />
            ))}
            {pages.length === 0 && (
              <button onClick={() => onCreate(null)} className="mx-1 mt-1 flex h-8 w-[calc(100%-8px)] items-center gap-2 rounded-lg px-2 text-[14px] text-muted hover:bg-sunken hover:text-ink">
                <Plus className="size-4" /> Add a page
              </button>
            )}
          </>
        )}
      </div>

      <div className="border-t border-line p-2">
        <button onClick={() => setShowTrash(!showTrash)} className="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-sunken hover:text-ink">
          <Trash2 className="size-4" /> Trash
          {trashRoots.length > 0 && <span className="ml-auto text-faint tabular">{trashRoots.length}</span>}
        </button>
        <AnimatePresence initial={false}>
          {showTrash && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              {trashRoots.length === 0 && <div className="px-3 py-3 text-[13px] text-faint">The trash is empty.</div>}
              {trashRoots.map((p) => (
                <div key={p.id} className="group flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] text-muted hover:bg-sunken">
                  <Icon page={p} />
                  <span className="flex-1 truncate">{p.title || "Untitled"}</span>
                  <button onClick={() => onRestore(p.id)} aria-label="Restore" title="Restore" className="rounded p-1 hover:bg-line hover:text-ink">
                    <RotateCcw className="size-3.5" />
                  </button>
                  <button
                    onClick={() => confirm(`Delete “${p.title || "Untitled"}” forever?`) && onDestroy(p.id)}
                    aria-label="Delete forever"
                    title="Delete forever"
                    className="rounded p-1 hover:bg-line hover:text-neg"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TreeRow({
  page,
  depth,
  childrenOf,
  ...props
}: Props & { page: Page; depth: number; childrenOf: Map<string | null, Page[]> }) {
  const { selectedId, expanded, onToggle, onSelect, onCreate } = props;
  const kids = childrenOf.get(page.id) ?? [];
  const open = expanded.has(page.id);
  const active = page.id === selectedId;
  return (
    <div>
      <div
        className={cn(
          "group flex h-8 items-center gap-1 rounded-lg pr-1 text-[14px] transition-colors",
          active ? "bg-sunken font-medium text-ink" : "text-muted hover:bg-sunken/60 hover:text-ink",
        )}
        style={{ paddingLeft: 4 + depth * 16 }}
      >
        <button
          onClick={() => onToggle(page.id)}
          aria-label={open ? "Collapse" : "Expand"}
          className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-line hover:text-ink", !kids.length && "opacity-0 group-hover:opacity-100")}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button onClick={() => onSelect(page.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Icon page={page} />
          <span className="truncate">{page.title || "Untitled"}</span>
        </button>
        <button
          onClick={() => onCreate(page.id)}
          aria-label="Add a page inside"
          title="Add a page inside"
          className="rounded-md p-1 text-faint opacity-0 hover:bg-line hover:text-ink group-hover:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            {kids.length ? (
              kids.map((k) => <TreeRow key={k.id} page={k} depth={depth + 1} childrenOf={childrenOf} {...props} />)
            ) : (
              <div className="h-7 text-[13px] leading-7 text-faint" style={{ paddingLeft: 36 + (depth + 1) * 16 }}>
                No pages inside
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
