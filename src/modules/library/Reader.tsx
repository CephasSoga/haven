import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Headphones, Highlighter, Minus, Plus, StickyNote } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Book as EpubBook, Rendition } from "epubjs";
import { cn } from "@/lib/utils";
import { getFile } from "./files";
import { BookTransferError, downloadBook } from "@/lib/sync";
import { useLibrary, type Book } from "./store";
import { cleanPassage, MARKS, useAnnotations, type Annotation, type Rect, type Selection } from "./annotations";
import { AnnotationsPanel, NoteDialog, SelectionBar } from "./Annotate";
import { ListenBar } from "./Listen";
import { startReading, stopReading, useReadAloud, type ReadSource } from "./readAloud";
import { sentencesIn, type Sentence } from "./sentences";
import { detectLang, type Lang } from "./voices";

type Paper = "paper" | "sepia" | "night";
const PAPERS: Record<Paper, { bg: string; fg: string; label: string }> = {
  paper: { bg: "#f7f5ef", fg: "#1b1a17", label: "Paper" },
  sepia: { bg: "#f0e5cc", fg: "#3b2f20", label: "Sepia" },
  night: { bg: "#131417", fg: "#d9d5cc", label: "Night" },
};
const PAPER_KEY = "haven:reader-paper";

type Nav = {
  prev: () => void;
  next: () => void;
  /** Shows where an annotation is */
  goTo?: (a: Annotation) => void;
  /** The place you're at, for a note that isn't about a passage */
  here?: () => Selection;
  /** Drops the text selection */
  clear?: () => void;
  /** The book's text from where you are, for reading aloud */
  readAloud?: () => ReadSource;
};
type OnSelect = (s: Selection | null) => void;
type Progress = (progress: number, location: string, label?: string) => void;

/** Full-screen reader. Saves your place as you go and counts the time spent reading. */
export function Reader({ book, onClose }: { book: Book; onClose: () => void }) {
  const { update, setProgress, addReadingTime } = useLibrary();
  const live = useLibrary((s) => s.books.find((b) => b.id === book.id)) ?? book;
  const [blob, setBlob] = useState<Blob | null | undefined>(undefined);
  // While a PDF is zoomed in, the page-turn strips at the sides step aside so the page can be dragged.
  const [zoomed, setZoomed] = useState(false);
  // Why the book can't be shown, in words; and whether trying again could help.
  const [problem, setProblem] = useState<{ text: string; retry?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem(PAPER_KEY) as Paper) || "paper");
  const [label, setLabel] = useState("");
  const nav = useRef<Nav>({ prev: () => {}, next: () => {} });
  // Marking up: the selected passage, the note being written, and the list of everything marked.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [noteFor, setNoteFor] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [panel, setPanel] = useState(false);
  const items = useAnnotations((s) => s.items);
  const marks = useMemo(() => items.filter((a) => a.bookId === book.id), [items, book.id]);
  const writing = !!noteFor || !!editing;
  const listening = useReadAloud((s) => s.status !== "idle");
  // Reading stops with the book.
  useEffect(() => () => stopReading(), []);
  const usedSelection = () => {
    nav.current.clear?.();
    setSelection(null);
  };

  useEffect(() => {
    // Books added on another device are fetched from your account the first time they're opened here.
    setProblem(null);
    setBlob(undefined);
    getFile(book.id)
      .catch(() => undefined)
      .then(async (b) => b ?? (await downloadBook(book.id)) ?? null)
      .then((b) => {
        setBlob(b);
        if (!b) setProblem({ text: "This book's file isn't on this device. Delete it from the Library and add the file again." });
      })
      .catch((e) => {
        setBlob(null);
        const reason = e instanceof BookTransferError ? e.reason : "failed";
        setProblem(
          reason === "offline"
            ? { text: "This book was added on another device and hasn't been downloaded here yet. Connect to the internet to open it.", retry: true }
            : reason === "not-in-account"
              ? { text: "This book was added on another device, but its file never reached your account — it may be too large to sync. Open it on that device, or add the file again here." }
              : { text: `This book couldn't be downloaded from your account. ${e instanceof Error ? e.message : ""}`.trim(), retry: true },
        );
      });
  }, [book.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    update(book.id, { lastOpenedAt: Date.now(), status: book.status === "to-read" ? "reading" : book.status });
    // Count reading time in 15-second ticks while the reader is visible.
    const t = setInterval(() => document.visibilityState === "visible" && addReadingTime(book.id, 15), 15_000);
    return () => clearInterval(t);
    // Only when a different book is opened.
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing a note, or a dialog on top: the keys are theirs.
      if (writing || (e.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (e.key === "Escape") return panel ? setPanel(false) : onClose();
      if (e.key === "ArrowRight" || e.key === "PageDown") nav.current.next();
      if (e.key === "ArrowLeft" || e.key === "PageUp") nav.current.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, writing, panel]);

  useEffect(() => {
    localStorage.setItem(PAPER_KEY, paper);
  }, [paper]);

  const onProgress: Progress = (p, loc, l) => {
    setProgress(book.id, p, loc);
    if (l !== undefined) setLabel(l);
  };
  const theme = PAPERS[paper];

  // Drawn straight into the page body, so nothing in the app's layout (like the sidebar) can sit on top of it.
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: theme.bg, color: theme.fg }}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6" style={{ borderBottom: `1px solid ${theme.fg}14` }}>
        <button
          onClick={onClose}
          aria-label="Back to library"
          className="flex shrink-0 items-center gap-1 rounded-xl py-2 pl-1.5 pr-3 text-[14px] font-medium opacity-75 transition-opacity hover:opacity-100"
          style={{ background: `${theme.fg}0d` }}
        >
          <ChevronLeft className="size-5" />
          <span className="max-sm:hidden">Library</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-xl leading-tight">{live.title}</div>
          {live.author && <div className="truncate text-[12px] opacity-60">{live.author}</div>}
        </div>
        {blob && !problem && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => nav.current.here && setNoteFor(nav.current.here())}
              title="Write a note on this page (it goes into Notes)"
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[13px] font-medium opacity-75 transition-opacity hover:opacity-100"
              style={{ background: `${theme.fg}0d` }}
            >
              <StickyNote className="size-4" /> <span className="max-sm:hidden">Note</span>
            </button>
            <button
              onClick={() => (listening ? stopReading() : nav.current.readAloud && void startReading(nav.current.readAloud()))}
              aria-pressed={listening}
              title={listening ? "Stop reading aloud" : "Read aloud from here"}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[13px] font-medium opacity-75 transition-opacity hover:opacity-100"
              style={{ background: listening ? `${theme.fg}1f` : `${theme.fg}0d` }}
            >
              <Headphones className="size-4" /> <span className="max-sm:hidden">Listen</span>
            </button>
            <button
              onClick={() => setPanel((p) => !p)}
              aria-pressed={panel}
              title="Highlights & notes in this book"
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[13px] font-medium opacity-75 transition-opacity hover:opacity-100"
              style={{ background: panel ? `${theme.fg}1f` : `${theme.fg}0d` }}
            >
              <Highlighter className="size-4" />
              {marks.length > 0 && <span className="tabular">{marks.length}</span>}
            </button>
          </div>
        )}
        <div className="flex items-center gap-1 rounded-full p-1" style={{ background: `${theme.fg}0d` }}>
          {(Object.keys(PAPERS) as Paper[]).map((p) => (
            <button
              key={p}
              onClick={() => setPaper(p)}
              aria-label={PAPERS[p].label}
              title={PAPERS[p].label}
              className={cn("size-6 rounded-full border transition-transform hover:scale-110", paper === p && "ring-2 ring-offset-1")}
              style={{ background: PAPERS[p].bg, borderColor: `${PAPERS[p].fg}33`, ["--tw-ring-color" as string]: theme.fg, ["--tw-ring-offset-color" as string]: theme.bg }}
            />
          ))}
        </div>
      </div>

      {/* Page */}
      <div className="relative min-h-0 flex-1">
        {blob === undefined && !problem && <Centered>Opening…</Centered>}
        {problem && (
          <Centered>
            {problem.text}
            {problem.retry && (
              <button onClick={() => setAttempt((a) => a + 1)} className="mt-4 block w-full font-medium underline underline-offset-4">
                Try again
              </button>
            )}
          </Centered>
        )}
        {blob && !problem && live.format === "pdf" && (
          <PdfView
            blob={blob}
            start={Number(book.location) || 1}
            night={paper === "night"}
            nav={nav}
            onProgress={onProgress}
            onFail={() => setProblem({ text: UNREADABLE.pdf })}
            onZoomed={setZoomed}
            marks={marks}
            onSelect={setSelection}
          />
        )}
        {blob && !problem && live.format === "epub" && (
          <EpubView
            blob={blob}
            start={book.location}
            theme={theme}
            nav={nav}
            onProgress={onProgress}
            onFail={() => setProblem({ text: UNREADABLE.epub })}
            marks={marks}
            onSelect={setSelection}
            onMarkClick={() => setPanel(true)}
          />
        )}

        <button onClick={() => nav.current.prev()} aria-label="Previous page" className={cn("group absolute inset-y-0 left-0 hidden w-16 items-center justify-center sm:flex", zoomed && "sm:hidden")}>
          <span className="rounded-full p-2 opacity-25 transition-opacity group-hover:opacity-70" style={{ background: `${theme.fg}14` }}>
            <ChevronLeft className="size-5" />
          </span>
        </button>
        <button onClick={() => nav.current.next()} aria-label="Next page" className={cn("group absolute inset-y-0 right-0 hidden w-16 items-center justify-center sm:flex", zoomed && "sm:hidden")}>
          <span className="rounded-full p-2 opacity-25 transition-opacity group-hover:opacity-70" style={{ background: `${theme.fg}14` }}>
            <ChevronRight className="size-5" />
          </span>
        </button>

        <ListenBar theme={theme} />
        <SelectionBar
          raised={listening}
          book={live}
          selection={selection}
          theme={theme}
          onDone={usedSelection}
          onNote={(s) => {
            setNoteFor(s);
            usedSelection();
          }}
        />
        <AnnotationsPanel
          book={live}
          open={panel}
          theme={theme}
          onClose={() => setPanel(false)}
          onGo={(a) => {
            nav.current.goTo?.(a);
            // On a phone the list covers the page; get out of the way.
            if (window.innerWidth < 640) setPanel(false);
          }}
          onEdit={setEditing}
        />
      </div>
      <NoteDialog
        book={live}
        target={noteFor}
        editing={editing}
        onClose={() => {
          setNoteFor(null);
          setEditing(null);
        }}
      />

      {/* Progress */}
      <div className="shrink-0 px-4 pb-4 pt-3 sm:px-6" style={{ borderTop: `1px solid ${theme.fg}14` }}>
        <div className="mb-2 flex items-center justify-between gap-3 text-[12px] tabular">
          <div className="flex items-center gap-1">
            <PageButton label="Previous page" onClick={() => nav.current.prev()} fg={theme.fg}>
              <ChevronLeft className="size-4" />
            </PageButton>
            <span className="min-w-24 text-center opacity-70">{label}</span>
            <PageButton label="Next page" onClick={() => nav.current.next()} fg={theme.fg}>
              <ChevronRight className="size-4" />
            </PageButton>
          </div>
          <span className="opacity-70">{Math.round(live.progress * 100)}% read</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full" style={{ background: `${theme.fg}1a` }}>
          <div className="h-full rounded-full bg-cal transition-[width] duration-300" style={{ width: `${live.progress * 100}%` }} />
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}

function PageButton({ label, onClick, fg, children }: { label: string; onClick: () => void; fg: string; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="rounded-lg p-1.5 opacity-70 transition-opacity hover:opacity-100" style={{ background: `${fg}0d` }}>
      {children}
    </button>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-[15px]">
      <div className="max-w-md opacity-70">{children}</div>
    </div>
  );
}

const UNREADABLE = {
  pdf: "This PDF couldn't be opened. The file may be damaged, or protected with a password.",
  epub: "This EPUB couldn't be opened. The file may be damaged, or protected with DRM.",
};

/* ---------- PDF ---------- */

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

function PdfView({
  blob,
  start,
  night,
  nav,
  onProgress,
  onFail,
  onZoomed,
  marks,
  onSelect,
}: {
  blob: Blob;
  start: number;
  night: boolean;
  nav: MutableRefObject<Nav>;
  onProgress: Progress;
  onFail: () => void;
  onZoomed: (zoomed: boolean) => void;
  marks: Annotation[];
  onSelect: OnSelect;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // pdf.js's invisible text, laid over the picture of the page, is what makes text selectable.
  const textLayer = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  // The sentence being read aloud, as rectangles on the page.
  const [reading, setReading] = useState<Rect[] | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(start);
  const [zoom, setZoomState] = useState(1);
  const [dragging, setDragging] = useState(false);
  // The point of the page in the middle of the screen, kept there when the zoom changes.
  const focus = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const setZoom = (next: (z: number) => number) => {
    const el = box.current;
    if (el && el.scrollWidth && el.scrollHeight)
      focus.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight };
    setZoomState((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next(z))));
  };

  useEffect(() => onZoomed(zoom > 1), [zoom, onZoomed]);
  useEffect(() => () => onZoomed(false), [onZoomed]);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      const { pdfjs } = await import("./pdf");
      loaded = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      if (alive) setDoc(loaded);
      else loaded.loadingTask.destroy();
    })().catch(() => alive && onFail());
    return () => {
      alive = false;
      loaded?.loadingTask.destroy();
    };
  }, [blob]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = doc?.numPages ?? 0;
  const current = Math.min(Math.max(1, page), Math.max(total, 1));

  nav.current = {
    prev: () => setPage((p) => Math.max(1, p - 1)),
    next: () => setPage((p) => Math.min(total || p, p + 1)),
    goTo: (a) => a.page && setPage(a.page),
    here: () => ({ text: "", page: current, where: `p. ${current}` }),
    clear: () => document.getSelection()?.removeAllRanges(),
    readAloud: () => {
      let page = current;
      let first = true;
      let lang: Lang | null = null;
      /** The text layer once it's drawn for `p`. */
      const layerFor = async (p: number) => {
        for (let i = 0; i < 150; i++) {
          const l = textLayer.current;
          if (l?.dataset.page === String(p)) return l;
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      };
      return {
        next: async () => {
          if (!first) {
            if (page >= total) return null;
            page += 1;
            setPage(page);
          }
          first = false;
          const layer = await layerFor(page);
          if (!layer) return null;
          const lb = layer.getBoundingClientRect();
          // Running heads, footers and page numbers sit in the top and bottom margins: leave short lines there out.
          const margin = (el: Element) => {
            if (el.tagName !== "SPAN" || el.parentElement !== layer) return false;
            const r = el.getBoundingClientRect();
            const y = (r.top + r.height / 2 - lb.top) / lb.height;
            return (y < 0.07 || y > 0.93) && (el.textContent ?? "").trim().length < 70;
          };
          const all = sentencesIn(layer, lang ?? "en", { skip: margin });
          lang ??= detectLang(all.map((s) => s.text).join(" "));
          return { lang, sentences: all };
        },
        show: (s: Sentence) => {
          const layer = textLayer.current;
          if (!layer) return;
          const lb = layer.getBoundingClientRect();
          const rects = [...s.range.getClientRects()]
            .filter((r) => r.width > 1 && r.height > 1)
            .map((r) => ({ x: (r.left - lb.left) / lb.width, y: (r.top - lb.top) / lb.height, w: r.width / lb.width, h: r.height / lb.height }));
          setReading(mergeRects(rects));
          // Zoomed in: keep the sentence on screen.
          const el = box.current;
          const top = rects[0] ? lb.top + rects[0].y * lb.height : null;
          if (el && top !== null) {
            const view = el.getBoundingClientRect();
            if (top < view.top + 40 || top > view.bottom - 80) el.scrollBy({ top: top - view.top - view.height / 3, behavior: "smooth" });
          }
        },
        clear: () => setReading(null),
      };
    },
  };

  // A passage selected on this page: where it sits, as fractions of the page, so its highlight
  // stays put at any zoom.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const check = () => {
      const sel = document.getSelection();
      const layer = textLayer.current;
      if (!sel || sel.isCollapsed || !sel.rangeCount || !layer || !layer.contains(sel.anchorNode)) return select.current(null);
      const text = cleanPassage(sel.toString());
      if (!text) return select.current(null);
      const box = layer.getBoundingClientRect();
      const rects = mergeRects(
        [...sel.getRangeAt(0).getClientRects()]
          .filter((r) => r.width > 1 && r.height > 1 && r.height < box.height * 0.2)
          .map((r) => ({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height })),
      );
      select.current({ text, page: current, rects, where: `p. ${current}` });
    };
    const onChange = () => {
      clearTimeout(t);
      t = setTimeout(check, 150);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      clearTimeout(t);
      select.current(null);
    };
  }, [current]);

  useEffect(() => {
    if (total) onProgress(current / total, String(current), `Page ${current} of ${total}`);
    box.current?.scrollTo({ top: 0 });
    // onProgress is recreated each render; the page number is what matters.
  }, [current, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render the page crisply for this screen, fitted to the window.
  useEffect(() => {
    if (!doc || !width || !canvas.current) return;
    let task: RenderTask | null = null;
    let text: { cancel: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const p = await doc.getPage(current);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const fit = Math.min((width - 48) / base.width, (height - 32) / base.height);
      const scale = Math.max(fit, 0.3) * zoom;
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: scale * dpr });
      const c = canvas.current!;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      c.style.width = `${Math.floor(viewport.width / dpr)}px`;
      c.style.height = `${Math.floor(viewport.height / dpr)}px`;
      // Zooming keeps the same spot of the page in the middle of the screen.
      const el = box.current;
      if (el && focus.current) {
        el.scrollTo({ left: focus.current.x * el.scrollWidth - el.clientWidth / 2, top: focus.current.y * el.scrollHeight - el.clientHeight / 2 });
        focus.current = null;
      }
      task = p.render({ canvas: c, viewport });
      // The selectable text, sized to the page as shown.
      const layer = textLayer.current;
      if (layer) {
        const { pdfjs } = await import("./pdf");
        if (cancelled) return;
        layer.replaceChildren();
        delete layer.dataset.page;
        layer.style.setProperty("--total-scale-factor", String(scale));
        const t = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: layer, viewport: p.getViewport({ scale }) });
        text = t;
        await t.render().catch(() => {});
        if (!cancelled) layer.dataset.page = String(current);
      }
      await task.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [doc, current, width, height, zoom]);

  // Zoomed in, the page can be dragged around with the mouse; on touch screens fingers already scroll it.
  const canDrag = zoom > 1;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!canDrag || !el || e.pointerType !== "mouse" || e.button !== 0) return;
    // Pressing on text selects it; dragging from anywhere else moves the page.
    if ((e.target as HTMLElement).closest(".textLayer span")) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!drag.current || !el) return;
    el.scrollTo({ left: drag.current.left - (e.clientX - drag.current.x), top: drag.current.top - (e.clientY - drag.current.y) });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <div
      ref={box}
      className={cn("absolute inset-0 overflow-auto", canDrag && (dragging ? "cursor-grabbing select-none" : "cursor-grab"))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="flex min-h-full min-w-fit items-center justify-center p-4">
        <div className="relative">
          <canvas ref={canvas} draggable={false} className="block rounded-sm bg-white shadow-float" style={night ? { filter: "invert(0.88) hue-rotate(180deg)" } : undefined} />
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {marks
              .filter((a) => a.page === current && a.rects?.length)
              .flatMap((a) =>
                a.rects!.map((r, i) => (
                  <div
                    key={`${a.id}-${i}`}
                    className="absolute rounded-[2px]"
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                      background: MARKS[a.color].fill,
                      opacity: night ? 0.3 : 0.4,
                      mixBlendMode: night ? "normal" : "multiply",
                    }}
                  />
                )),
              )}
          </div>
          {reading && (
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {reading.map((r, i) => (
                <div
                  key={i}
                  className="absolute rounded-[3px] transition-all duration-200"
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: "#60a5fa", opacity: night ? 0.3 : 0.28, mixBlendMode: night ? "normal" : "multiply" }}
                />
              ))}
            </div>
          )}
          <div ref={textLayer} className="textLayer" style={{ ["--scale-round-x" as string]: "1px", ["--scale-round-y" as string]: "1px" }} />
        </div>
      </div>
      {/* Above the page-turn strips at the sides, so "+" never turns the page. */}
      <div className="fixed bottom-20 right-6 z-20 flex items-center gap-1 rounded-full bg-black/60 p-1 text-white shadow-float backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => setZoom((z) => z - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out" className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40">
          <Minus className="size-4" />
        </button>
        <button onClick={() => setZoom(() => 1)} title="Back to 100%" className="min-w-12 text-[12px] tabular">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => setZoom((z) => z + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40">
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------- EPUB ---------- */

function EpubView({
  blob,
  start,
  theme,
  nav,
  onProgress,
  onFail,
  marks,
  onSelect,
  onMarkClick,
}: {
  blob: Blob;
  start?: string;
  theme: { bg: string; fg: string };
  nav: MutableRefObject<Nav>;
  onProgress: Progress;
  onFail: () => void;
  marks: Annotation[];
  onSelect: OnSelect;
  onMarkClick: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const report = useRef(onProgress);
  report.current = onProgress;
  const select = useRef(onSelect);
  select.current = onSelect;
  const markClick = useRef(onMarkClick);
  markClick.current = onMarkClick;
  const [ready, setReady] = useState(false);
  // Which highlights are drawn in the book, by annotation id.
  const drawn = useRef(new Map<string, string>());
  // Where you are, for notes and quotes: the chapter's name, else how far in.
  const place = useRef({ cfi: "", where: "" });

  useEffect(() => {
    let book: EpubBook | null = null;
    let alive = true;
    let shown = false;
    (async () => {
      const { default: ePub, EpubCFI } = await import("epubjs");
      const data = await blob.arrayBuffer();
      // Closed (or reopened) while the file was being read: don't draw a second copy of the book.
      if (!alive || !host.current) return;
      book = ePub(data);
      const r = book.renderTo(host.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto" });
      rendition.current = r;
      r.themes.default({
        body: { "font-family": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif', "line-height": "1.7", "font-size": "112%" },
        p: { "text-align": "justify", hyphens: "auto" },
        a: { color: "inherit" },
      });
      r.themes.override("color", theme.fg);
      r.themes.override("background", "transparent");

      let located = false;
      r.on("relocated", (loc: { start: { cfi: string; href: string; percentage: number; displayed: { page: number; total: number } }; atEnd: boolean }) => {
        const pct = loc.atEnd ? 1 : located ? book!.locations.percentageFromCfi(loc.start.cfi) : loc.start.percentage;
        const chapter = (book!.navigation?.get(loc.start.href) as { label?: string } | undefined)?.label?.trim();
        place.current = { cfi: loc.start.cfi, where: chapter || `${Math.round(pct * 100)}% in` };
        report.current(pct, loc.start.cfi, `Page ${loc.start.displayed.page} of ${loc.start.displayed.total} in this chapter`);
      });
      // Arrow keys inside the book's own frame.
      r.on("keyup", (e: KeyboardEvent) => {
        if (e.key === "ArrowRight") r.next();
        if (e.key === "ArrowLeft") r.prev();
      });
      // A passage selected in the book's own frame.
      r.on("selected", (cfiRange: string, contents: { window: Window; cfiFromRange: (range: Range) => string }) => {
        const sel = contents.window.getSelection();
        if (!sel?.rangeCount) return;
        // Triple-clicks and the like end the selection "before the next paragraph"; pin it to the text itself,
        // or the highlight comes out wrong.
        const range = toText(sel.getRangeAt(0));
        const text = cleanPassage(range.toString());
        if (!text) return;
        let cfi = cfiRange;
        try {
          cfi = contents.cfiFromRange(range);
        } catch {
          /* keep epub.js's own */
        }
        select.current({ text, cfi, where: place.current.where });
      });
      r.hooks.content.register((contents: { document: Document; window: Window }) => {
        contents.document.addEventListener("selectionchange", () => {
          if (contents.window.getSelection()?.isCollapsed) select.current(null);
        });
      });
      const contentsList = () => (r.getContents() as unknown as { window: Window }[]) ?? [];
      const epub = book;
      type Contents = { document: Document; range: (cfi: string) => Range; cfiFromRange: (r: Range) => string };
      nav.current = {
        prev: () => r.prev(),
        next: () => r.next(),
        goTo: (a) => a.cfi && r.display(a.cfi),
        here: () => ({ text: "", cfi: place.current.cfi, where: place.current.where }),
        clear: () => contentsList().forEach((c) => c.window.getSelection()?.removeAllRanges()),
        readAloud: () => {
          const metaLang = (epub.packaging?.metadata as { language?: string } | undefined)?.language;
          let lang: Lang | null = null;
          let first = true;
          let contents: Contents | null = null;
          let shown: string | null = null;
          const location = () => r.currentLocation() as unknown as { start: { cfi: string; href: string }; end: { cfi: string } };
          return {
            next: async () => {
              if (first) {
                first = false;
                contents = (r.getContents() as unknown as Contents[])[0] ?? null;
                if (!contents) return null;
                // From the top of the page you're on.
                let from: { node: Node; offset: number } | undefined;
                try {
                  const start = contents.range(location().start.cfi);
                  from = { node: start.startContainer, offset: start.startOffset };
                } catch {
                  /* from the start of the chapter */
                }
                const sample = contents.document.body.textContent ?? "";
                lang ??= detectLang(sample, metaLang);
                return { lang, sentences: sentencesIn(contents.document.body, lang, { from }) };
              }
              // On to the next chapter.
              const section = epub.spine.get(location().start.href) as unknown as { next: () => { href: string } | undefined } | null;
              const following = section?.next();
              if (!following) return null;
              await r.display(following.href);
              contents = (r.getContents() as unknown as Contents[])[0] ?? null;
              if (!contents) return null;
              return { lang: lang ?? "en", sentences: sentencesIn(contents.document.body, lang ?? "en") };
            },
            show: (s: Sentence) => {
              if (!contents) return;
              let cfi: string;
              try {
                cfi = contents.cfiFromRange(s.range);
              } catch {
                return;
              }
              if (shown) r.annotations.remove(shown, "highlight");
              r.annotations.highlight(cfi, {}, () => {}, "haven-reading", { fill: "#60a5fa", "fill-opacity": "0.3", "mix-blend-mode": "multiply" });
              shown = cfi;
              // Turn the page when the sentence has gone past it.
              try {
                if (new EpubCFI().compare(cfi, location().end.cfi) > 0) void r.display(cfi);
              } catch {
                /* keep going */
              }
            },
            clear: () => {
              if (shown) r.annotations.remove(shown, "highlight");
              shown = null;
            },
          };
        },
      };
      await r.display(start || undefined);
      shown = true;
      if (alive) setReady(true);
      // Book-wide percentages need a location map; build it in the background.
      await book.ready;
      await book.locations.generate(1600);
      located = true;
      if (alive) r.reportLocation();
    })().catch(() => {
      // Failing to open is worth saying; failing to build the page map afterwards only affects percentages.
      if (alive && !shown) onFail();
    });
    return () => {
      alive = false;
      // Closing it while epub.js is still opening it makes epub.js throw; let it finish first.
      const b = book;
      if (b) void Promise.race([Promise.all([b.opened, b.loaded.navigation]), new Promise((r) => setTimeout(r, 5000))]).catch(() => {}).finally(() => b.destroy());
    };
    // Re-open only for a different file.
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rendition.current?.themes.override("color", theme.fg);
  }, [theme.fg]);

  // Draw the highlights (and take away deleted ones).
  useEffect(() => {
    const r = rendition.current;
    if (!r || !ready) return;
    const want = new Map(marks.filter((a) => a.cfi && a.text).map((a) => [a.id, a]));
    for (const [id, cfi] of drawn.current)
      if (!want.has(id)) {
        r.annotations.remove(cfi, "highlight");
        drawn.current.delete(id);
      }
    for (const a of want.values())
      if (!drawn.current.has(a.id)) {
        // A click on a highlight opens the list; a drag that starts on one is just selecting text.
        const onClick = () => {
          const contents = r.getContents() as unknown as { window: Window }[];
          if (contents.every((c) => c.window.getSelection()?.isCollapsed !== false)) markClick.current();
        };
        r.annotations.highlight(a.cfi!, { id: a.id }, onClick, "haven-mark", { fill: MARKS[a.color].fill, "fill-opacity": "0.4", "mix-blend-mode": "multiply" });
        drawn.current.set(a.id, a.cfi!);
      }
  }, [marks, ready]);

  return <div ref={host} className="absolute inset-0 mx-auto max-w-[1100px] px-6 py-6 sm:px-16" />;
}

/** Joins the pieces of a selection that sit on the same line into one rectangle per line. */
function mergeRects(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = out.find((o) => Math.abs(o.y + o.h / 2 - (r.y + r.h / 2)) < Math.min(o.h, r.h) / 2 && r.x <= o.x + o.w + 0.02);
    if (line) {
      const x2 = Math.max(line.x + line.w, r.x + r.w);
      const y2 = Math.max(line.y + line.h, r.y + r.h);
      line.x = Math.min(line.x, r.x);
      line.y = Math.min(line.y, r.y);
      line.w = x2 - line.x;
      line.h = y2 - line.y;
    } else out.push({ ...r });
  }
  return out.map((r) => ({ x: clamp(r.x), y: clamp(r.y), w: clamp(r.w), h: clamp(r.h) }));
}

/** The same selection, starting and ending inside text rather than between elements. */
function toText(range: Range): Range {
  const root = range.commonAncestorContainer;
  const scope = root.nodeType === Node.TEXT_NODE ? root.parentNode! : root;
  const walker = (scope.ownerDocument ?? (scope as Document)).createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n) && n.textContent?.trim()) texts.push(n as Text);
  if (!texts.length) return range;
  const first = texts[0];
  const last = texts[texts.length - 1];
  const out = range.cloneRange();
  if (range.startContainer !== first) out.setStart(first, 0);
  if (range.endContainer !== last) out.setEnd(last, last.length);
  return out;
}
