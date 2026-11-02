import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ask } from "@/components/confirm";
import { useSearchParams } from "react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, BookPlus, CheckCircle2, Clock, HardDrive, MoreHorizontal, Pencil, Search, Trash2, Upload } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Segmented, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { describe, formatOf } from "./extract";
import { formatBytes, keepFiles, putFile, storageUsed } from "./files";
import { Reader } from "./Reader";
import { Cover, SPINES, spine } from "./Cover";
import { formatReadingTime, useLibrary, type Book, type BookStatus } from "./store";

type Filter = "all" | BookStatus;

const STATUS_LABEL: Record<BookStatus, string> = { "to-read": "To read", reading: "Reading", finished: "Finished" };

export function LibraryPage() {
  const { books, add, update, remove } = useLibrary();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reading = books.find((b) => b.id === params.get("read")) ?? null;
  const open = (b: Book) => setParams({ read: b.id });
  const close = () => setParams({}, { replace: true });

  useEffect(() => {
    storageUsed().then(setStorage);
  }, [books.length]);

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => formatOf(f));
    if (!list.length) {
      setAdding("Only PDF and EPUB files can be added.");
      setTimeout(() => setAdding(null), 3000);
      return;
    }
    await keepFiles();
    for (const [i, file] of list.entries()) {
      setAdding(`Adding ${list.length > 1 ? `${i + 1} of ${list.length}` : file.name}…`);
      const book = await describe(file);
      await putFile(book.id, file);
      add(book);
    }
    setAdding(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const continuing = books.filter((b) => b.status === "reading").sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  const thisYear = new Date().getFullYear();
  const finishedThisYear = books.filter((b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === thisYear).length;
  const totalTime = books.reduce((s, b) => s + b.readingSeconds, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books
      .filter((b) => (filter === "all" || b.status === filter) && (!q || `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q)))
      .sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
  }, [books, filter, query]);

  return (
    <div
      className="relative flex flex-col gap-8"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <PageHeader
        eyebrow="Library"
        title="Library"
        actions={
          <Button variant="primary" onClick={() => input.current?.click()}>
            <BookPlus className="size-4" /> Add books
          </Button>
        }
      />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {books.length === 0 ? (
        <button
          onClick={() => input.current?.click()}
          className="group flex min-h-[50dvh] flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-line bg-surface/50 px-6 text-center transition-colors hover:border-cal/50 hover:bg-surface"
        >
          <div className="relative flex h-24 items-end gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-12 rounded-r-md rounded-l-sm shadow-card"
                style={{ height: 72 + i * 10, background: `linear-gradient(160deg, ${SPINES[i][0]}, ${SPINES[i][1]})`, rotate: i === 2 ? 8 : 0, originX: 0, originY: 1 }}
                whileHover={{ y: -4 }}
              />
            ))}
          </div>
          <div>
            <div className="font-serif text-3xl">Start your shelf</div>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">Drop PDFs or EPUBs anywhere on this page, or click to choose files. They stay on this device.</p>
          </div>
        </button>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={<BookOpen className="size-4" />} value={String(continuing.length)} label="Reading now" />
            <Stat icon={<CheckCircle2 className="size-4" />} value={String(finishedThisYear)} label={`Finished in ${thisYear}`} />
            <Stat icon={<Clock className="size-4" />} value={formatReadingTime(totalTime)} label="Time spent reading" />
            <Stat icon={<HardDrive className="size-4" />} value={storage ? formatBytes(storage.used) : "—"} label={storage ? `of ${formatBytes(storage.quota)} available` : "Storage used"} />
          </div>

          {/* Continue reading */}
          {continuing.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">Continue reading</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {continuing.slice(0, 2).map((b) => (
                  <Card key={b.id} className="relative overflow-hidden">
                    <div className="pointer-events-none absolute inset-0 opacity-25 blur-3xl" style={{ background: b.cover ? `url(${b.cover}) center/cover` : `linear-gradient(160deg, ${spine(b.id)[0]}, ${spine(b.id)[1]})` }} />
                    <div className="relative flex gap-5 p-5">
                      <button onClick={() => open(b)} className="w-24 shrink-0 transition-transform hover:-translate-y-1 sm:w-28">
                        <Cover book={b} />
                      </button>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="font-serif text-2xl leading-tight">{b.title}</div>
                        {b.author && <div className="mt-0.5 truncate text-[13px] text-muted">{b.author}</div>}
                        <div className="mt-auto">
                          <div className="mb-1.5 flex justify-between text-[12px] text-muted tabular">
                            <span>{Math.round(b.progress * 100)}%</span>
                            <span>{b.lastOpenedAt && `Opened ${formatDistanceToNowStrict(b.lastOpenedAt, { addSuffix: true })}`}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                            <div className="h-full rounded-full bg-cal" style={{ width: `${b.progress * 100}%` }} />
                          </div>
                          <Button size="sm" variant="primary" className="mt-4" onClick={() => open(b)}>
                            <BookOpen className="size-3.5" /> Resume
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Shelf */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Segmented
                layoutId="lib-filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: `All · ${books.length}` },
                  { value: "reading", label: "Reading" },
                  { value: "to-read", label: "To read" },
                  { value: "finished", label: "Finished" },
                ]}
              />
              <div className="relative flex-1 sm:max-w-xs sm:ml-auto">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles and authors" className="h-10 pl-10" />
              </div>
            </div>
            {visible.length === 0 ? (
              <Card>
                <EmptyState icon={<BookOpen className="size-5" />} title="No books here" body="Try another filter." />
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                <AnimatePresence initial={false}>
                  {visible.map((b) => (
                    <BookTile key={b.id} book={b} onOpen={() => open(b)} onEdit={() => setEditing(b)} onStatus={(status) => update(b.id, { status, finishedAt: status === "finished" ? Date.now() : undefined, progress: status === "finished" ? 1 : b.progress })} onRemove={async () => (await ask({ title: `Remove “${b.title}”?`, body: "The book and its reading progress will be removed from your library.", confirmLabel: "Remove", danger: true })) && remove(b.id)} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </>
      )}

      {/* Drop overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-canvas/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-cal bg-surface px-12 py-10 shadow-float">
              <Upload className="size-8 text-cal" />
              <div className="font-serif text-3xl">Drop to add to your library</div>
              <div className="text-[13px] text-muted">PDF and EPUB</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {adding && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-on-primary shadow-float md:bottom-8">{adding}</div>
      )}

      <AnimatePresence>{reading && <Reader key={reading.id} book={reading} onClose={close} />}</AnimatePresence>
      <EditDialog book={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex size-8 items-center justify-center rounded-full bg-sunken text-muted">{icon}</div>
      <div className="font-serif text-3xl leading-none tabular">{value}</div>
      <div className="mt-1 text-[12px] text-muted">{label}</div>
    </div>
  );
}

function BookTile({ book, onOpen, onEdit, onStatus, onRemove }: { book: Book; onOpen: () => void; onEdit: () => void; onStatus: (s: BookStatus) => void; onRemove: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="group relative flex flex-col">
      <button onClick={onOpen} className="relative transition-transform duration-300 group-hover:-translate-y-1.5" aria-label={`Open ${book.title}`}>
        <Cover book={book} className="group-hover:shadow-float" />
        {book.status === "finished" && (
          <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-white/90 text-pos shadow-soft">
            <CheckCircle2 className="size-4" />
          </span>
        )}
        <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">{book.format}</span>
      </button>
      <div className="mt-3 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[14px] font-medium leading-snug">{book.title}</div>
          <div className="truncate text-[12px] text-muted">{book.author || STATUS_LABEL[book.status]}</div>
        </div>
        <div className="relative">
          <button onClick={() => setMenu(!menu)} aria-label="Book options" className="rounded-lg p-1 text-faint hover:bg-sunken hover:text-ink">
            <MoreHorizontal className="size-4" />
          </button>
          <AnimatePresence>
            {menu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute right-0 z-40 mt-1 w-48 rounded-2xl border border-line bg-raised p-1.5 shadow-float">
                  {(Object.keys(STATUS_LABEL) as BookStatus[]).map((s) => (
                    <MenuItem key={s} onClick={() => (onStatus(s), setMenu(false))} active={book.status === s}>
                      Mark as {STATUS_LABEL[s].toLowerCase()}
                    </MenuItem>
                  ))}
                  <div className="my-1 h-px bg-line" />
                  <MenuItem onClick={() => (onEdit(), setMenu(false))}>
                    <Pencil className="size-3.5" /> Edit details
                  </MenuItem>
                  <MenuItem onClick={() => (onRemove(), setMenu(false))} danger>
                    <Trash2 className="size-3.5" /> Remove
                  </MenuItem>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
      {book.status !== "to-read" && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken">
          <div className={cn("h-full rounded-full", book.status === "finished" ? "bg-pos" : "bg-cal")} style={{ width: `${book.progress * 100}%` }} />
        </div>
      )}
    </motion.div>
  );
}

function MenuItem({ children, onClick, active, danger }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-sunken",
        active && "font-semibold",
        danger ? "text-neg" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}

function EditDialog({ book, onClose }: { book: Book | null; onClose: () => void }) {
  const update = useLibrary((s) => s.update);
  const [form, setForm] = useState<Book | null>(book);
  const [prev, setPrev] = useState(book);
  if (book !== prev) {
    setPrev(book);
    if (book) setForm(book);
  }
  const f = form ?? book;
  if (!f) return null;
  return (
    <Modal
      open={!!book}
      onClose={onClose}
      title="Book details"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!f.title.trim()}
            onClick={() => {
              update(f.id, { title: f.title.trim(), author: f.author?.trim() || undefined, status: f.status });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex gap-5">
        <div className="w-24 shrink-0">
          <Cover book={f} />
        </div>
        <div className="flex flex-1 flex-col gap-4">
          <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => setForm({ ...f, title: e.target.value })} />}</Field>
          <Field label="Author">{(id) => <Input id={id} value={f.author ?? ""} onChange={(e) => setForm({ ...f, author: e.target.value })} />}</Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={f.status} onChange={(e) => setForm({ ...f, status: e.target.value as BookStatus })}>
                {(Object.keys(STATUS_LABEL) as BookStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="text-[12px] text-muted">
            {f.format.toUpperCase()} · {formatBytes(f.size)}
            {f.pages ? ` · ${f.pages} pages` : ""} · {formatReadingTime(f.readingSeconds)} read
          </div>
        </div>
      </div>
    </Modal>
  );
}
