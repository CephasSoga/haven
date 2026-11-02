import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ask } from "@/components/confirm";
import { useSearchParams } from "react-router";
import { format, formatDistanceToNowStrict, isThisYear, isToday, isYesterday } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, Hash, NotebookPen, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, IconButton, Input, PageHeader } from "@/components/ui";
import { cn, swatch, SWATCHES } from "@/lib/utils";
import { compareNotes, isBlank, preview, tagsOf, useNotes, type Note } from "./store";

function when(ms: number) {
  const d = new Date(ms);
  if (isToday(d)) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isYesterday(d)) return "Yesterday";
  return format(d, isThisYear(d) ? "MMM d" : "MMM d, yyyy");
}

function edited(ms: number) {
  return Date.now() - ms < 60_000 ? "Edited just now" : `Edited ${formatDistanceToNowStrict(ms, { addSuffix: true })}`;
}

export function NotesPage() {
  const { notes, create, update, remove } = useNotes();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const selected = notes.find((n) => n.id === params.get("id")) ?? null;

  const select = (id: string | null) => {
    // A note left completely empty isn't worth keeping.
    if (selected && selected.id !== id && isBlank(selected)) remove(selected.id);
    setParams(id ? { id } : {}, { replace: true });
  };
  const newNote = () => select(create(tag ? { body: `\n\n#${tag}` } : undefined));

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of tagsOf(n)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .filter((n) => (!tag || tagsOf(n).has(tag)) && (!q || `${n.title}\n${n.body}`.toLowerCase().includes(q)))
      .sort(compareNotes);
  }, [notes, query, tag]);

  const pinned = visible.filter((n) => n.pinned);
  const others = visible.filter((n) => !n.pinned);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Notes"
        title={
          <>
            Notes <span className="text-faint">{notes.length || ""}</span>
          </>
        }
        actions={
          <Button variant="primary" onClick={newNote}>
            <Plus className="size-4" /> New note
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* List */}
        <Card
          className={cn(
            "flex-col overflow-hidden lg:sticky lg:top-8 lg:flex lg:max-h-[calc(100dvh-10rem)]",
            selected ? "hidden" : "flex",
          )}
        >
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" className="h-10 pl-10" />
            </div>
            {allTags.length > 0 && (
              <div className="-mx-1 flex flex-wrap gap-1.5">
                {allTags.map(([t, count]) => (
                  <button
                    key={t}
                    onClick={() => setTag(tag === t ? null : t)}
                    className={cn(
                      "flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                      tag === t ? "bg-primary text-on-primary" : "bg-sunken text-muted hover:text-ink",
                    )}
                  >
                    <Hash className="size-3" />
                    {t}
                    <span className={cn("ml-1 tabular", tag === t ? "opacity-60" : "text-faint")}>{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {visible.length === 0 ? (
              <EmptyState
                icon={<NotebookPen className="size-5" />}
                title={notes.length ? "No matching notes" : "No notes yet"}
                body={notes.length ? "Try another search or tag." : "Ideas, lists, things to remember — they all live here."}
                action={
                  !notes.length && (
                    <button onClick={newNote} className="text-sm font-medium text-note hover:underline">
                      Write your first note
                    </button>
                  )
                }
              />
            ) : (
              <>
                {pinned.length > 0 && <ListLabel>Pinned</ListLabel>}
                {pinned.map((n) => (
                  <NoteItem key={n.id} note={n} active={n.id === selected?.id} onClick={() => select(n.id)} />
                ))}
                {pinned.length > 0 && others.length > 0 && <ListLabel>Others</ListLabel>}
                {others.map((n) => (
                  <NoteItem key={n.id} note={n} active={n.id === selected?.id} onClick={() => select(n.id)} />
                ))}
              </>
            )}
          </div>
        </Card>

        {/* Editor */}
        <div className={cn("min-w-0 lg:block", selected ? "block" : "hidden")}>
          <AnimatePresence mode="wait" initial={false}>
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <NoteEditor
                  note={selected}
                  onChange={(patch) => update(selected.id, patch)}
                  onBack={() => select(null)}
                  onDelete={async () => {
                    if (isBlank(selected) || (await ask({ title: `Delete “${selected.title || "Untitled"}”?`, body: "This note will be deleted.", confirmLabel: "Delete", danger: true }))) {
                      remove(selected.id);
                      setParams({}, { replace: true });
                    }
                  }}
                />
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className="flex min-h-[60dvh] items-center justify-center">
                  <EmptyState
                    icon={<NotebookPen className="size-5" />}
                    title="Pick a note"
                    body="Choose one from the list, or start something new."
                    action={
                      <Button onClick={newNote}>
                        <Plus className="size-4" /> New note
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

function ListLabel({ children }: { children: string }) {
  return <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</div>;
}

function NoteItem({ note, active, onClick }: { note: Note; active: boolean; onClick: () => void }) {
  const text = preview(note);
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full rounded-2xl px-3.5 py-3 text-left transition-colors",
        active ? "bg-sunken" : "hover:bg-sunken/60",
      )}
    >
      {active && (
        <motion.span
          layoutId="note-active"
          className="absolute inset-y-3 left-0 w-[3px] rounded-full"
          style={{ background: swatch(note.color).fg }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
        />
      )}
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: swatch(note.color).fg }} />
        <span className={cn("flex-1 truncate font-medium", !note.title && "text-muted")}>{note.title || "Untitled"}</span>
        {note.pinned && <Pin className="size-3 shrink-0 text-faint" />}
        <span className="shrink-0 text-[12px] text-faint tabular">{when(note.updatedAt)}</span>
      </div>
      <p className="mt-1 line-clamp-2 pl-4 text-[13px] leading-snug text-muted">{text || "No additional text"}</p>
    </button>
  );
}

function NoteEditor({
  note,
  onChange,
  onBack,
  onDelete,
}: {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const body = useRef<HTMLTextAreaElement>(null);
  const s = swatch(note.color);
  const tags = [...tagsOf(note)];
  const words = note.body.trim() ? note.body.trim().split(/\s+/).length : 0;

  // Grow the body with its content so the page, not the textarea, scrolls.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [note.body]);

  return (
    <Card className="relative min-h-[60dvh] overflow-hidden">
      <div
        className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full opacity-80 blur-3xl transition-colors duration-500"
        style={{ background: `radial-gradient(circle, ${s.soft}, transparent 70%)` }}
      />
      <div className="relative flex items-center gap-1 px-4 pt-4 sm:px-6">
        <IconButton label="Back to notes" onClick={onBack} className="-ml-2 lg:hidden">
          <ChevronLeft className="size-5" />
        </IconButton>
        <span className="text-[13px] text-faint">{edited(note.updatedAt)}</span>
        <div className="flex-1" />
        <div className="mr-1 hidden items-center gap-1.5 sm:flex">
          {SWATCHES.map((sw) => (
            <button
              key={sw.id}
              aria-label={`Color ${sw.id}`}
              onClick={() => onChange({ color: sw.id })}
              className={cn(
                "size-4 rounded-full transition-transform hover:scale-125",
                note.color === sw.id && "ring-2 ring-offset-2 ring-offset-surface",
              )}
              style={{ background: sw.fg, ["--tw-ring-color" as string]: sw.fg }}
            />
          ))}
        </div>
        <IconButton label={note.pinned ? "Unpin" : "Pin"} onClick={() => onChange({ pinned: !note.pinned })} className={note.pinned ? "text-ink" : undefined}>
          {note.pinned ? <PinOff className="size-[18px]" /> : <Pin className="size-[18px]" />}
        </IconButton>
        <IconButton label="Delete note" onClick={onDelete} className="hover:text-neg">
          <Trash2 className="size-[18px]" />
        </IconButton>
      </div>

      <div className="relative px-6 pb-8 pt-4 sm:px-10">
        <input
          value={note.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              body.current?.focus();
            }
          }}
          autoFocus={isBlank(note)}
          placeholder="Untitled"
          className="w-full bg-transparent font-serif text-[40px] leading-tight tracking-tight placeholder:text-faint/60 focus:outline-none"
        />
        <textarea
          ref={body}
          value={note.body}
          onChange={(e) => onChange({ body: e.target.value })}
          placeholder="Start writing… use #tags to group notes."
          rows={8}
          className="mt-3 block w-full resize-none overflow-hidden bg-transparent text-[16px] leading-7 placeholder:text-faint focus:outline-none"
        />
        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[12px] text-faint">
          {tags.map((t) => (
            <span key={t} className="rounded-full px-2 py-0.5 font-medium" style={{ background: s.soft, color: s.fg }}>
              #{t}
            </span>
          ))}
          <span className="ml-auto tabular">
            {words} {words === 1 ? "word" : "words"} · Created {format(note.createdAt, "MMM d, yyyy")}
          </span>
        </div>
      </div>
    </Card>
  );
}
