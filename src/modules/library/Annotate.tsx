import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Highlighter, NotebookPen, Quote, StickyNote, Trash2, X } from "lucide-react";
import { Button, Modal, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { copyText } from "@/modules/meetings/agent";
import { useNotes } from "@/modules/notes/store";
import { inReadingOrder, MARKS, useAnnotations, writeToNotes, type Annotation, type Mark, type Selection } from "./annotations";
import type { Book } from "./store";

type Theme = { bg: string; fg: string };
const LAST_MARK = "haven:reader-mark";

export const lastMark = (): Mark => {
  try {
    return (localStorage.getItem(LAST_MARK) as Mark) || "yellow";
  } catch {
    return "yellow";
  }
};

/* ---------- The bar over a selected passage ---------- */

/**
 * Shown while a passage is selected: highlight it (in a colour), keep it as a quote (it goes into
 * Notes), write a note about it, or copy it.
 */
export function SelectionBar({
  book,
  selection,
  theme,
  onDone,
  onNote,
  raised = false,
}: {
  book: Book;
  selection: Selection | null;
  theme: Theme;
  /** Sit higher, above the read-aloud controls */
  raised?: boolean;
  /** The selection was used: clear it */
  onDone: () => void;
  onNote: (s: Selection) => void;
}) {
  const add = useAnnotations((s) => s.add);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const mark = (color: Mark, quote = false) => {
    if (!selection) return;
    try {
      localStorage.setItem(LAST_MARK, color);
    } catch {
      /* only a preference */
    }
    const a = add({ bookId: book.id, text: selection.text, color, page: selection.page, rects: selection.rects, cfi: selection.cfi, where: selection.where });
    if (quote) {
      writeToNotes(book, a);
      setSaved("Quote saved to Notes");
      setTimeout(() => setSaved(null), 1800);
    }
    onDone();
  };

  // Pressing a button mustn't clear the selection before the button has read it.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <AnimatePresence>
      {(selection || saved) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className={cn("pointer-events-auto absolute left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5 shadow-float", raised ? "bottom-16" : "bottom-4")}
          style={{ background: theme.fg, color: theme.bg }}
          onMouseDown={keep}
        >
          {saved ? (
            <span className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium">
              <Check className="size-4" /> {saved}
            </span>
          ) : (
            <>
              <div className="flex items-center gap-1 px-1" title="Highlight">
                <Highlighter className="mr-0.5 size-4 opacity-70" />
                {(Object.keys(MARKS) as Mark[]).map((m) => (
                  <button
                    key={m}
                    onMouseDown={keep}
                    onClick={() => mark(m)}
                    aria-label={`Highlight in ${MARKS[m].label.toLowerCase()}`}
                    title={`Highlight in ${MARKS[m].label.toLowerCase()}`}
                    className="size-6 rounded-full border-2 transition-transform hover:scale-110"
                    style={{ background: MARKS[m].fill, borderColor: m === lastMark() ? theme.bg : "transparent" }}
                  />
                ))}
              </div>
              <Divider color={theme.bg} />
              <BarButton onClick={() => mark(lastMark(), true)} title="Keep as a quote in Notes">
                <Quote className="size-4" /> Quote
              </BarButton>
              <BarButton onClick={() => selection && onNote(selection)} title="Write a note about this passage">
                <StickyNote className="size-4" /> Note
              </BarButton>
              <BarButton
                onClick={async () => {
                  if (!selection) return;
                  await copyText(`“${selection.text}” — ${book.title}${book.author ? `, ${book.author}` : ""} (${selection.where})`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                title="Copy with the book and page"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                <span className="max-sm:hidden">{copied ? "Copied" : "Copy"}</span>
              </BarButton>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BarButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title} className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-75">
      {children}
    </button>
  );
}

const Divider = ({ color }: { color: string }) => <span className="mx-0.5 h-5 w-px" style={{ background: color, opacity: 0.25 }} />;

/* ---------- Writing a note ---------- */

/** A note on a passage, or on the page you're at. It's written into the book's page in Notes. */
export function NoteDialog({
  book,
  target,
  editing,
  onClose,
}: {
  book: Book;
  /** The passage (or just the place) the note is about */
  target: Selection | null;
  /** An existing note being edited */
  editing?: Annotation | null;
  onClose: () => void;
}) {
  const { add, update } = useAnnotations();
  const [text, setText] = useState("");
  const open = !!target || !!editing;
  const passage = editing?.text ?? target?.text;
  const where = editing?.where ?? target?.where ?? "";

  useEffect(() => {
    if (open) setText(editing?.note ?? "");
  }, [open, editing]);

  const save = () => {
    const note = text.trim();
    if (!note) return;
    if (editing) update(editing.id, { note });
    else if (target) {
      const a = add({ bookId: book.id, text: target.text || undefined, note, color: lastMark(), page: target.page, rects: target.text ? target.rects : undefined, cfi: target.cfi, where });
      writeToNotes(book, a);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      top
      title={editing ? "Edit note" : "Note"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!text.trim()}>
            <Check className="size-4" /> {editing ? "Save" : "Save to Notes"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {passage ? (
          <blockquote className="max-h-40 overflow-y-auto border-l-2 border-line-strong pl-3 font-serif text-[15px] italic text-muted">“{passage}”</blockquote>
        ) : null}
        <div className="text-[12px] text-faint">
          {book.title} · {where}
        </div>
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && save()}
          placeholder="What it makes you think, what to remember, what to look up…"
          className="min-h-32"
        />
        {editing?.inNotes && <p className="text-[12px] text-faint">The copy already in Notes isn't changed — edit it there if needed.</p>}
      </div>
    </Modal>
  );
}

/* ---------- Everything marked in this book ---------- */

export function AnnotationsPanel({
  book,
  open,
  theme,
  onClose,
  onGo,
  onEdit,
}: {
  book: Book;
  open: boolean;
  theme: Theme;
  onClose: () => void;
  onGo: (a: Annotation) => void;
  onEdit: (a: Annotation) => void;
}) {
  const all = useAnnotations((s) => s.items);
  const remove = useAnnotations((s) => s.remove);
  const items = inReadingOrder(all.filter((a) => a.bookId === book.id));
  const navigate = useNavigate();
  const list = useRef<HTMLDivElement>(null);
  const groupId = useNotes((s) => s.groups.find((g) => g.source?.kind === "book" && g.source.id === book.id)?.id ?? null);
  const noteIds = useNotes((s) => s.notes.map((n) => n.id).join(","));
  const stillThere = (id?: string) => !!id && noteIds.includes(id);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col shadow-float"
          style={{ background: theme.bg, borderLeft: `1px solid ${theme.fg}1f` }}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${theme.fg}14` }}>
            <div>
              <div className="font-medium">Highlights & notes</div>
              <div className="text-[12px] opacity-60">{items.length ? `${items.length} in this book` : "Select text to mark it"}</div>
            </div>
            <div className="flex items-center gap-1">
              {groupId && (
                <button
                  onClick={() => navigate(`/notes?group=${groupId}`)}
                  className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[13px] font-medium opacity-80 hover:opacity-100"
                  style={{ background: `${theme.fg}0d` }}
                  title="Open this book's group in Notes"
                >
                  <NotebookPen className="size-4" /> In Notes
                </button>
              )}
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 opacity-70 hover:opacity-100">
                <X className="size-5" />
              </button>
            </div>
          </div>
          <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-3">
            {!items.length && (
              <p className="px-2 py-8 text-center text-[14px] opacity-60">
                Select a passage to highlight it, keep it as a quote or write a note about it. Quotes and notes also go into Notes, in a group named after this book.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {items.map((a) => (
                <li key={a.id} className="group rounded-2xl p-3" style={{ background: `${theme.fg}0a` }}>
                  <button onClick={() => onGo(a)} className="block w-full text-left" title="Go to it">
                    {a.text && (
                      <p className="line-clamp-5 border-l-[3px] pl-2.5 font-serif text-[15px] leading-snug" style={{ borderColor: MARKS[a.color].fill }}>
                        {a.text}
                      </p>
                    )}
                    {a.note && <p className={cn("whitespace-pre-wrap text-[14px]", a.text && "mt-2")}>{a.note}</p>}
                  </button>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
                    <span className="opacity-60">
                      {a.where}
                      {a.inNotes &&
                        (stillThere(a.noteId) ? (
                          <>
                            {" · "}
                            <button onClick={() => navigate(`/notes?group=${groupId ?? ""}&id=${a.noteId}`)} className="underline underline-offset-2 hover:opacity-100">
                              in Notes
                            </button>
                          </>
                        ) : (
                          " · in Notes"
                        ))}
                    </span>
                    <span className="flex items-center gap-0.5 opacity-70 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      {!a.inNotes && (
                        <button onClick={() => writeToNotes(book, a)} className="rounded-lg px-2 py-1 font-medium hover:bg-black/5" title="Save it in Notes, in this book's group">
                          Add to Notes
                        </button>
                      )}
                      <button onClick={() => onEdit(a)} className="rounded-lg p-1.5 hover:bg-black/5" aria-label={a.note ? "Edit the note" : "Add a note"} title={a.note ? "Edit the note" : "Add a note"}>
                        <StickyNote className="size-3.5" />
                      </button>
                      <button onClick={() => remove(a.id)} className="rounded-lg p-1.5 hover:bg-black/5" aria-label="Delete" title="Delete (anything already in Notes stays there)">
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
