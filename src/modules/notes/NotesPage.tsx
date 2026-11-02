import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, FileText, ImagePlus, NotebookPen, Plus, Smile, Star, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, IconButton, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COVERS, sortPages, useNotes, type Page } from "./store";
import { PageTree } from "./PageTree";
import { PageEditor } from "./PageEditor";
import { CoverPicker, EmojiPicker, Popover } from "./pickers";

export function NotesPage() {
  const { pages, create, update, trash, restore, destroy } = useNotes();
  const [params, setParams] = useSearchParams();
  const live = useMemo(() => pages.filter((p) => !p.trashedAt), [pages]);
  const trashed = useMemo(() => pages.filter((p) => p.trashedAt), [pages]);
  const selected = live.find((p) => p.id === params.get("id")) ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Keep the selected page's ancestors open in the tree.
  const ancestors = useMemo(() => {
    const out: Page[] = [];
    let cur = selected && live.find((p) => p.id === selected.parentId);
    while (cur) {
      out.unshift(cur);
      cur = live.find((p) => p.id === cur!.parentId);
    }
    return out;
  }, [selected, live]);
  useEffect(() => {
    if (ancestors.length) setExpanded((s) => new Set([...s, ...ancestors.map((a) => a.id)]));
  }, [ancestors]);

  const select = (id: string | null) => setParams(id ? { id } : {}, { replace: true });
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const newPage = (parentId: string | null) => {
    const id = create({ parentId });
    if (parentId) setExpanded((s) => new Set([...s, parentId]));
    select(id);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Notes"
        title="Pages"
        actions={
          <Button variant="primary" onClick={() => newPage(null)}>
            <Plus className="size-4" /> New page
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className={cn("overflow-hidden lg:sticky lg:top-8 lg:block lg:h-[calc(100dvh-10rem)]", selected ? "hidden" : "block")}>
          <PageTree
            pages={live}
            trashed={trashed}
            selectedId={selected?.id ?? null}
            expanded={expanded}
            onToggle={toggle}
            onSelect={select}
            onCreate={newPage}
            onRestore={restore}
            onDestroy={destroy}
          />
        </Card>

        <div className={cn("min-w-0 lg:block", selected ? "block" : "hidden")}>
          <AnimatePresence mode="wait" initial={false}>
            {selected ? (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                <PageView
                  page={selected}
                  ancestors={ancestors}
                  subpages={live.filter((p) => p.parentId === selected.id).sort(sortPages)}
                  onSelect={select}
                  onBack={() => select(null)}
                  onNewSubpage={() => newPage(selected.id)}
                  onChange={(patch) => update(selected.id, patch)}
                  onTrash={() => {
                    trash(selected.id);
                    select(selected.parentId);
                  }}
                />
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className="flex min-h-[60dvh] items-center justify-center">
                  <EmptyState
                    icon={<NotebookPen className="size-5" />}
                    title={live.length ? "Pick a page" : "Your first page"}
                    body="Pages can hold text, to-dos, toggles, quotes, code, tables — and other pages. Type “/” for everything."
                    action={
                      <Button onClick={() => newPage(null)}>
                        <Plus className="size-4" /> New page
                      </Button>
                    }
                  />
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function PageView({
  page,
  ancestors,
  subpages,
  onSelect,
  onBack,
  onNewSubpage,
  onChange,
  onTrash,
}: {
  page: Page;
  ancestors: Page[];
  subpages: Page[];
  onSelect: (id: string) => void;
  onBack: () => void;
  onNewSubpage: () => void;
  onChange: (patch: Partial<Page>) => void;
  onTrash: () => void;
}) {
  const [picker, setPicker] = useState<"icon" | "cover" | null>(null);
  const title = useRef<HTMLTextAreaElement>(null);
  const focusEditor = useRef<() => void>(() => {});
  const onReady = useCallback((focus: () => void) => (focusEditor.current = focus), []);

  // Let the title wrap and grow like a heading.
  useLayoutEffect(() => {
    const el = title.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [page.title]);

  const edited = Date.now() - page.updatedAt < 60_000 ? "Edited just now" : `Edited ${formatDistanceToNowStrict(page.updatedAt, { addSuffix: true })}`;

  return (
    <div className="flex flex-col gap-3">
      {/* Breadcrumbs and page actions */}
      <div className="flex min-h-9 items-center gap-1 text-[13px]">
        <IconButton label="Back to pages" onClick={onBack} className="-ml-2 lg:hidden">
          <ChevronLeft className="size-5" />
        </IconButton>
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-muted">
          {ancestors.map((a) => (
            <span key={a.id} className="flex min-w-0 items-center gap-1">
              <button onClick={() => onSelect(a.id)} className="flex min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-1 hover:bg-sunken hover:text-ink">
                {a.icon && <span>{a.icon}</span>}
                <span className="truncate">{a.title || "Untitled"}</span>
              </button>
              <ChevronRight className="size-3.5 shrink-0 text-faint" />
            </span>
          ))}
          <span className="flex min-w-0 items-center gap-1 truncate px-1.5 font-medium text-ink">
            {page.icon && <span>{page.icon}</span>}
            <span className="truncate">{page.title || "Untitled"}</span>
          </span>
        </nav>
        <span className="hidden text-faint sm:inline">{edited}</span>
        <IconButton label={page.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => onChange({ favorite: !page.favorite })}>
          <Star className={cn("size-[18px]", page.favorite && "fill-current text-note")} />
        </IconButton>
        <IconButton label="Move to trash" onClick={onTrash} className="hover:text-neg">
          <Trash2 className="size-[18px]" />
        </IconButton>
      </div>

      <Card className="relative min-h-[70dvh] overflow-visible">
        {/* Cover */}
        {page.cover && COVERS[page.cover] && (
          <div className="group/cover relative h-44 overflow-hidden rounded-t-3xl sm:h-56" style={{ background: COVERS[page.cover] }}>
            <div
              className="absolute inset-0 opacity-50 mix-blend-soft-light"
              style={{ background: "radial-gradient(circle at 20% 20%, rgba(255,255,255,.7), transparent 45%), radial-gradient(circle at 85% 90%, rgba(0,0,0,.25), transparent 50%)" }}
            />
            <div className="absolute bottom-3 right-3 flex gap-1.5 opacity-0 transition-opacity group-hover/cover:opacity-100">
              <button onClick={() => setPicker("cover")} className="rounded-lg bg-white/80 px-2.5 py-1 text-[12px] font-medium text-[#1b1a17] backdrop-blur hover:bg-white">
                Change cover
              </button>
            </div>
          </div>
        )}

        <div className="group/page relative mx-auto max-w-[860px] pb-24">
          <div className="relative px-[54px]">
            {page.icon && (
              <button
                onClick={() => setPicker("icon")}
                className={cn("relative z-10 block rounded-2xl text-[64px] leading-none transition-transform hover:scale-105", page.cover ? "-mt-10" : "mt-12")}
                aria-label="Change icon"
              >
                {page.icon}
              </button>
            )}

            {/* Hover controls, as in a notebook margin */}
            <div className={cn("flex gap-1 opacity-0 transition-opacity group-hover/page:opacity-100 focus-within:opacity-100", page.icon ? "mt-3" : page.cover ? "mt-6" : "mt-12")}>
              {!page.icon && (
                <button onClick={() => setPicker("icon")} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-faint hover:bg-sunken hover:text-muted">
                  <Smile className="size-4" /> Add icon
                </button>
              )}
              {!page.cover && (
                <button
                  onClick={() => onChange({ cover: Object.keys(COVERS)[Math.floor(Math.random() * Object.keys(COVERS).length)] })}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-faint hover:bg-sunken hover:text-muted"
                >
                  <ImagePlus className="size-4" /> Add cover
                </button>
              )}
              <button onClick={onNewSubpage} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-faint hover:bg-sunken hover:text-muted">
                <FileText className="size-4" /> Add subpage
              </button>
            </div>

            <Popover open={picker === "icon"} onClose={() => setPicker(null)} className="left-[54px] top-full">
              <EmojiPicker
                onPick={(icon) => {
                  onChange({ icon });
                  setPicker(null);
                }}
                onRemove={
                  page.icon
                    ? () => {
                        onChange({ icon: undefined });
                        setPicker(null);
                      }
                    : undefined
                }
              />
            </Popover>

            <textarea
              ref={title}
              rows={1}
              value={page.title}
              onChange={(e) => onChange({ title: e.target.value.replace(/\n/g, "") })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === page.title.length)) {
                  e.preventDefault();
                  focusEditor.current();
                }
              }}
              autoFocus={!page.title && page.content.length === 0}
              placeholder="Untitled"
              className="mt-2 block w-full resize-none overflow-hidden bg-transparent font-serif text-[44px] leading-[1.1] tracking-tight placeholder:text-faint/60 focus:outline-none sm:text-[52px]"
            />
          </div>

          {page.cover && (
            <Popover open={picker === "cover"} onClose={() => setPicker(null)} className="right-6 top-0">
              <CoverPicker
                value={page.cover}
                onPick={(cover) => {
                  onChange({ cover });
                  setPicker(null);
                }}
                onRemove={() => {
                  onChange({ cover: undefined });
                  setPicker(null);
                }}
              />
            </Popover>
          )}

          <div className="mt-4">
            <PageEditor pageId={page.id} content={page.content} onReady={onReady} />
          </div>

          {/* Pages inside this one */}
          <div className="mt-10 px-[54px]">
            {subpages.length > 0 && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Pages inside</div>}
            <div className="flex flex-col">
              {subpages.map((p) => (
                <button key={p.id} onClick={() => onSelect(p.id)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-sunken">
                  {p.icon ? <span className="w-5 text-center">{p.icon}</span> : <FileText className="size-4 text-faint" />}
                  <span className="border-b border-line font-medium">{p.title || "Untitled"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
