import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Book as EpubBook, Rendition } from "epubjs";
import { cn } from "@/lib/utils";
import { getFile } from "./files";
import { downloadBook } from "@/lib/sync";
import { useLibrary, type Book } from "./store";

type Paper = "paper" | "sepia" | "night";
const PAPERS: Record<Paper, { bg: string; fg: string; label: string }> = {
  paper: { bg: "#f7f5ef", fg: "#1b1a17", label: "Paper" },
  sepia: { bg: "#f0e5cc", fg: "#3b2f20", label: "Sepia" },
  night: { bg: "#131417", fg: "#d9d5cc", label: "Night" },
};
const PAPER_KEY = "haven:reader-paper";

type Nav = { prev: () => void; next: () => void };
type Progress = (progress: number, location: string, label?: string) => void;

/** Full-screen reader. Saves your place as you go and counts the time spent reading. */
export function Reader({ book, onClose }: { book: Book; onClose: () => void }) {
  const { update, setProgress, addReadingTime } = useLibrary();
  const live = useLibrary((s) => s.books.find((b) => b.id === book.id)) ?? book;
  const [blob, setBlob] = useState<Blob | null | undefined>(undefined);
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem(PAPER_KEY) as Paper) || "paper");
  const [label, setLabel] = useState("");
  const nav = useRef<Nav>({ prev: () => {}, next: () => {} });

  useEffect(() => {
    // Books added on another device are fetched from your account the first time they're opened here.
    getFile(book.id)
      .then(async (b) => b ?? (await downloadBook(book.id)) ?? null)
      .then(setBlob);
    update(book.id, { lastOpenedAt: Date.now(), status: book.status === "to-read" ? "reading" : book.status });
    // Count reading time in 15-second ticks while the reader is visible.
    const t = setInterval(() => document.visibilityState === "visible" && addReadingTime(book.id, 15), 15_000);
    return () => clearInterval(t);
    // Only when a different book is opened.
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "PageDown") nav.current.next();
      if (e.key === "ArrowLeft" || e.key === "PageUp") nav.current.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        {blob === undefined && <Centered>Opening…</Centered>}
        {blob === null && <Centered>This book's file is missing from this browser. Remove it and add it again.</Centered>}
        {blob && live.format === "pdf" && <PdfView blob={blob} start={Number(book.location) || 1} night={paper === "night"} nav={nav} onProgress={onProgress} />}
        {blob && live.format === "epub" && <EpubView blob={blob} start={book.location} theme={theme} nav={nav} onProgress={onProgress} />}

        <button onClick={() => nav.current.prev()} aria-label="Previous page" className="group absolute inset-y-0 left-0 hidden w-16 items-center justify-center sm:flex">
          <span className="rounded-full p-2 opacity-25 transition-opacity group-hover:opacity-70" style={{ background: `${theme.fg}14` }}>
            <ChevronLeft className="size-5" />
          </span>
        </button>
        <button onClick={() => nav.current.next()} aria-label="Next page" className="group absolute inset-y-0 right-0 hidden w-16 items-center justify-center sm:flex">
          <span className="rounded-full p-2 opacity-25 transition-opacity group-hover:opacity-70" style={{ background: `${theme.fg}14` }}>
            <ChevronRight className="size-5" />
          </span>
        </button>
      </div>

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

function Centered({ children }: { children: string }) {
  return <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-[15px] opacity-60">{children}</div>;
}

/* ---------- PDF ---------- */

function PdfView({ blob, start, night, nav, onProgress }: { blob: Blob; start: number; night: boolean; nav: MutableRefObject<Nav>; onProgress: Progress }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(start);
  const [zoom, setZoom] = useState(1);
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
    })();
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
  };

  useEffect(() => {
    if (total) onProgress(current / total, String(current), `Page ${current} of ${total}`);
    box.current?.scrollTo({ top: 0 });
    // onProgress is recreated each render; the page number is what matters.
  }, [current, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render the page crisply for this screen, fitted to the window.
  useEffect(() => {
    if (!doc || !width || !canvas.current) return;
    let task: RenderTask | null = null;
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
      task = p.render({ canvas: c, viewport });
      await task.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, current, width, height, zoom]);

  return (
    <div ref={box} className="absolute inset-0 overflow-auto">
      <div className="flex min-h-full min-w-fit items-center justify-center p-4">
        <canvas ref={canvas} className="rounded-sm bg-white shadow-float" style={night ? { filter: "invert(0.88) hue-rotate(180deg)" } : undefined} />
      </div>
      <div className="fixed bottom-20 right-6 flex items-center gap-1 rounded-full bg-black/60 p-1 text-white shadow-float backdrop-blur">
        <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out" className="rounded-full p-1.5 hover:bg-white/15">
          <Minus className="size-4" />
        </button>
        <button onClick={() => setZoom(1)} className="min-w-12 text-[12px] tabular">{Math.round(zoom * 100)}%</button>
        <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Zoom in" className="rounded-full p-1.5 hover:bg-white/15">
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------- EPUB ---------- */

function EpubView({ blob, start, theme, nav, onProgress }: { blob: Blob; start?: string; theme: { bg: string; fg: string }; nav: MutableRefObject<Nav>; onProgress: Progress }) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const report = useRef(onProgress);
  report.current = onProgress;

  useEffect(() => {
    let book: EpubBook | null = null;
    let alive = true;
    (async () => {
      const { default: ePub } = await import("epubjs");
      if (!alive || !host.current) return;
      book = ePub(await blob.arrayBuffer());
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
      r.on("relocated", (loc: { start: { cfi: string; percentage: number; displayed: { page: number; total: number } }; atEnd: boolean }) => {
        const pct = loc.atEnd ? 1 : located ? book!.locations.percentageFromCfi(loc.start.cfi) : loc.start.percentage;
        report.current(pct, loc.start.cfi, `Page ${loc.start.displayed.page} of ${loc.start.displayed.total} in this chapter`);
      });
      // Arrow keys inside the book's own frame.
      r.on("keyup", (e: KeyboardEvent) => {
        if (e.key === "ArrowRight") r.next();
        if (e.key === "ArrowLeft") r.prev();
      });
      nav.current = { prev: () => r.prev(), next: () => r.next() };
      await r.display(start || undefined);
      // Book-wide percentages need a location map; build it in the background.
      await book.ready;
      await book.locations.generate(1600);
      located = true;
      if (alive) r.reportLocation();
    })().catch(() => {});
    return () => {
      alive = false;
      book?.destroy();
    };
    // Re-open only for a different file.
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rendition.current?.themes.override("color", theme.fg);
  }, [theme.fg]);

  return <div ref={host} className="absolute inset-0 mx-auto max-w-[1100px] px-6 py-6 sm:px-16" />;
}
