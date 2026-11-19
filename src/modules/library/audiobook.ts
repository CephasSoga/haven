import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ArrayBufferTarget, Muxer } from "webm-muxer";
import { notify } from "@/lib/notify";
import { getFile } from "./files";
import { useLibrary, type Book } from "./store";
import { textSentences } from "./sentences";
import { closeLane, detectLang, loadPiper, piperSpeak, type Lang } from "./voices";
import { useReadAloud } from "./readAloud";

/**
 * "Make an audiobook": a book's chapters made into audio in the background with a natural on-device
 * voice, then listened to in Audiobooks. Making the audio takes longer than listening to it on an
 * ordinary computer, so it goes one chapter at a time, steps aside while you're reading aloud live,
 * and picks up again where it stopped if Haven is closed. The audio stays on this device (it's
 * compressed — roughly 15 MB per hour — but still too big to sync).
 */

export type ChapterState = "waiting" | "making" | "ready" | "error";
export type Chapter = { title: string; state: ChapterState; /** 0…1 while making */ done?: number; seconds?: number; error?: string };
export type Audiobook = { bookId: string; voice: string; lang: Lang; chapters: Chapter[]; createdAt: number; paused?: boolean };

type State = {
  books: Record<string, Audiobook>;
  put: (a: Audiobook) => void;
  patchChapter: (bookId: string, i: number, patch: Partial<Chapter>) => void;
  patch: (bookId: string, patch: Partial<Audiobook>) => void;
  drop: (bookId: string) => void;
};

export const useAudiobooks = create<State>()(
  persist(
    (set) => ({
      books: {},
      put: (a) => set((s) => ({ books: { ...s.books, [a.bookId]: a } })),
      patchChapter: (bookId, i, patch) =>
        set((s) => {
          const a = s.books[bookId];
          if (!a) return s;
          return { books: { ...s.books, [bookId]: { ...a, chapters: a.chapters.map((c, k) => (k === i ? { ...c, ...patch } : c)) } } };
        }),
      patch: (bookId, patch) => set((s) => (s.books[bookId] ? { books: { ...s.books, [bookId]: { ...s.books[bookId], ...patch } } } : s)),
      drop: (bookId) =>
        set((s) => {
          const books = { ...s.books };
          delete books[bookId];
          return { books };
        }),
    }),
    {
      name: "haven:audiobooks",
      // A chapter being made when Haven closed starts over.
      onRehydrateStorage: () => (s) => {
        if (!s) return;
        for (const a of Object.values(s.books)) a.chapters = a.chapters.map((c) => (c.state === "making" ? { ...c, state: "waiting", done: 0 } : c));
      },
    },
  ),
);

/* ---------- Where the audio is kept (IndexedDB, this device only) ---------- */

let dbp: Promise<IDBDatabase> | null = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("haven-audiobooks", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("chapters");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void) {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction("chapters", mode);
    const req = fn(t.objectStore("chapters"));
    t.oncomplete = () => resolve((req ? req.result : undefined) as T);
    t.onerror = () => reject(t.error);
  });
}
const key = (bookId: string, i: number) => `${bookId}:${i}`;
export const chapterAudio = (bookId: string, i: number) => store<Blob | undefined>("readonly", (s) => s.get(key(bookId, i)));
const saveAudio = (bookId: string, i: number, blob: Blob) => store<void>("readwrite", (s) => s.put(blob, key(bookId, i)));

/** Deletes a book's audio. */
export async function deleteAudiobook(bookId: string) {
  if (job?.bookId === bookId) job.cancelled = true;
  const a = useAudiobooks.getState().books[bookId];
  useAudiobooks.getState().drop(bookId);
  if (a) await store<void>("readwrite", (s) => a.chapters.forEach((_, i) => s.delete(key(bookId, i)))).catch(() => {});
}

/* ---------- Chapters from the book ---------- */

type Part = { title: string; text: string };

async function epubParts(blob: Blob): Promise<{ parts: Part[]; lang?: string }> {
  const { default: ePub } = await import("epubjs");
  const book = ePub(await blob.arrayBuffer());
  try {
    await book.ready;
    const toc = (book.navigation?.toc ?? []) as { href: string; label: string; subitems?: unknown[] }[];
    const flat: { href: string; label: string }[] = [];
    const walk = (items: typeof toc) => items.forEach((t) => (flat.push(t), t.subitems && walk(t.subitems as typeof toc)));
    walk(toc);
    const titleFor = (href: string) => flat.find((t) => t.href.split("#")[0].endsWith(href.split("/").pop()!))?.label.trim();
    const parts: Part[] = [];
    const spine = book.spine as unknown as { each: (fn: (s: { href: string; linear: boolean; load: (r: unknown) => Promise<Element>; unload: () => void }) => void) => void };
    const sections: { href: string; linear: boolean; load: (r: unknown) => Promise<Element>; unload: () => void }[] = [];
    spine.each((s) => sections.push(s));
    for (const s of sections) {
      if (s.linear === false) continue;
      const el = await s.load(book.load.bind(book));
      const body = el.querySelector("body") ?? el;
      // Paragraph by paragraph, so pauses fall where they should.
      const blocks = [...body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote")];
      const text = (blocks.length ? blocks.map((b) => b.textContent ?? "") : [body.textContent ?? ""]).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
      s.unload();
      // Covers, title pages and the like are too short to be worth a chapter.
      if (text.length < 300) continue;
      parts.push({ title: titleFor(s.href) || `Part ${parts.length + 1}`, text });
    }
    return { parts, lang: (book.packaging?.metadata as { language?: string } | undefined)?.language };
  } finally {
    book.destroy();
  }
}

async function pdfParts(blob: Blob): Promise<{ parts: Part[] }> {
  const { pdfjs } = await import("./pdf");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    // Chapters from the PDF's own outline when it has one; otherwise 20 pages at a time.
    const starts: { page: number; title: string }[] = [];
    const outline = (await doc.getOutline().catch(() => null)) ?? [];
    for (const item of outline) {
      try {
        const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
        if (!dest?.[0]) continue;
        const page = (await doc.getPageIndex(dest[0] as Parameters<typeof doc.getPageIndex>[0])) + 1;
        if (!starts.some((s) => s.page === page)) starts.push({ page, title: item.title.trim() });
      } catch {
        /* an entry pointing nowhere */
      }
    }
    starts.sort((a, b) => a.page - b.page);
    if (!starts.length || starts[0].page > 1) starts.unshift({ page: 1, title: starts.length ? "Opening" : "" });
    if (starts.length === 1 && !starts[0].title) {
      starts.length = 0;
      for (let p = 1; p <= doc.numPages; p += 20) starts.push({ page: p, title: `Pages ${p}–${Math.min(doc.numPages, p + 19)}` });
    }
    const pageText = async (n: number) => {
      const page = await doc.getPage(n);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as { str: string; hasEOL?: boolean; transform: number[] }[]) {
        // Running heads, footers and page numbers in the margins stay out.
        const y = 1 - item.transform[5] / height;
        if ((y < 0.07 || y > 0.93) && item.str.trim().length < 70) continue;
        text += item.str + (item.hasEOL ? " " : "");
      }
      return text;
    };
    const parts: Part[] = [];
    for (const [i, s] of starts.entries()) {
      const end = (starts[i + 1]?.page ?? doc.numPages + 1) - 1;
      const pages: string[] = [];
      for (let p = s.page; p <= end; p++) pages.push(await pageText(p));
      const text = pages.join("\n").replace(/[ \t]+/g, " ").trim();
      if (text.length >= 200) parts.push({ title: s.title || `Pages ${s.page}–${end}`, text });
    }
    return { parts };
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** The chapters' texts (read again when it's their turn, rather than kept). */
async function partsOf(book: Book) {
  const blob = await getFile(book.id);
  if (!blob) throw new Error("This book's file isn't on this device.");
  return book.format === "epub" ? epubParts(blob) : pdfParts(blob);
}

/* ---------- Making the audio ---------- */

const RATE = 24_000; // Opus works at 24 kHz; Piper's voices speak at 16 or 22 kHz.

function resample(audio: Float32Array, from: number) {
  if (from === RATE) return audio;
  const out = new Float32Array(Math.round((audio.length * RATE) / from));
  const step = from / RATE;
  for (let i = 0; i < out.length; i++) {
    const x = i * step;
    const k = Math.floor(x);
    const t = x - k;
    out[i] = (audio[k] ?? 0) * (1 - t) + (audio[k + 1] ?? audio[k] ?? 0) * t;
  }
  return out;
}

/** Speech in, a small Opus file (WebM) out. */
function opusWriter() {
  const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: "A_OPUS", numberOfChannels: 1, sampleRate: RATE } });
  let failed: unknown = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failed = e) });
  encoder.configure({ codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate: 32_000 });
  let frames = 0;
  return {
    write(samples: Float32Array) {
      if (failed) throw failed;
      if (!samples.length) return;
      encoder.encode(new AudioData({ format: "f32", sampleRate: RATE, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: Math.round((frames / RATE) * 1e6), data: samples as Float32Array<ArrayBuffer> }));
      frames += samples.length;
    },
    get seconds() {
      return frames / RATE;
    },
    async finish() {
      await encoder.flush();
      encoder.close();
      if (failed) throw failed;
      muxer.finalize();
      return new Blob([muxer.target.buffer], { type: "audio/webm" });
    },
  };
}

const silence = (seconds: number) => new Float32Array(Math.round(RATE * seconds));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let job: { bookId: string; cancelled: boolean } | null = null;

async function makeChapter(a: Audiobook, i: number, part: Part, isCancelled: () => boolean) {
  const { patchChapter } = useAudiobooks.getState();
  patchChapter(a.bookId, i, { state: "making", done: 0, error: undefined });
  const sentences = textSentences(part.text, a.lang);
  const out = opusWriter();
  // The chapter's title first, then its text.
  const queue = [part.title, "\n", ...sentences];
  let next = piperSpeak(queue[0], a.voice, 1, "background");
  for (let k = 0; k < queue.length; k++) {
    if (isCancelled()) return false;
    // Live reading aloud comes first: wait while it's going.
    while (useReadAloud.getState().status !== "idle" && !isCancelled()) await sleep(1000);
    const item = queue[k];
    const current = item === "\n" ? null : next;
    // Start on the next sentence while this one is written.
    const following = queue.slice(k + 1).find((s) => s !== "\n");
    if (item !== "\n") next = following ? piperSpeak(following, a.voice, 1, "background") : Promise.resolve({ audio: new Float32Array(0), rate: RATE });
    if (item === "\n") {
      out.write(silence(0.45));
      continue;
    }
    const { audio, rate } = await current!;
    out.write(resample(audio, rate));
    out.write(silence(0.18));
    if (k % 4 === 0) patchChapter(a.bookId, i, { done: k / queue.length });
  }
  const blob = await out.finish();
  await saveAudio(a.bookId, i, blob);
  patchChapter(a.bookId, i, { state: "ready", done: 1, seconds: Math.round(out.seconds) });
  return true;
}

/** Works through the books waiting for audio, one chapter at a time. */
async function run() {
  if (job) return;
  for (;;) {
    const books = Object.values(useAudiobooks.getState().books).filter((a) => !a.paused && a.chapters.some((c) => c.state === "waiting"));
    if (!books.length) break;
    const a = books.sort((x, y) => x.createdAt - y.createdAt)[0];
    const book = useLibrary.getState().books.find((b) => b.id === a.bookId);
    if (!book) {
      await deleteAudiobook(a.bookId);
      continue;
    }
    const j = { bookId: a.bookId, cancelled: false };
    job = j;
    try {
      await loadPiper(a.voice, undefined, "background");
      const { parts } = await partsOf(book);
      for (const [i, c] of a.chapters.entries()) {
        const now = useAudiobooks.getState().books[a.bookId];
        if (j.cancelled || !now || now.paused) break;
        if (c.state !== "waiting" || !parts[i]) continue;
        try {
          await makeChapter(now, i, parts[i], () => j.cancelled || !!useAudiobooks.getState().books[a.bookId]?.paused);
        } catch (e) {
          useAudiobooks.getState().patchChapter(a.bookId, i, { state: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
      const done = useAudiobooks.getState().books[a.bookId];
      if (done && !j.cancelled && done.chapters.every((c) => c.state === "ready")) void notify("Audiobook ready", `${book.title} — every chapter is ready to listen to in Audiobooks.`);
    } catch (e) {
      // The voice or the book couldn't be read: pause it, with the reason on the first waiting chapter.
      const i = useAudiobooks.getState().books[a.bookId]?.chapters.findIndex((c) => c.state === "waiting") ?? -1;
      if (i >= 0) useAudiobooks.getState().patchChapter(a.bookId, i, { state: "error", error: e instanceof Error ? e.message : String(e) });
      useAudiobooks.getState().patch(a.bookId, { paused: true });
    } finally {
      job = null;
    }
  }
  // Nothing left to make: free the voice's memory.
  closeLane("background");
}

/** Lists a book's chapters and starts making their audio. */
export async function prepareAudiobook(book: Book, voice: string, lang?: Lang) {
  const { parts, lang: declared } = (await partsOf(book)) as { parts: Part[]; lang?: string };
  if (!parts.length) throw new Error("There's no text to read in this book. (A scanned PDF has only pictures of text.)");
  const language = lang ?? detectLang(parts.slice(0, 3).map((p) => p.text).join(" ").slice(0, 4000), declared);
  useAudiobooks.getState().put({ bookId: book.id, voice, lang: language, createdAt: Date.now(), chapters: parts.map((p) => ({ title: p.title, state: "waiting" })) });
  void run();
  return { chapters: parts.length, characters: parts.reduce((n, p) => n + p.text.length, 0), lang: language };
}

/** Peeks at a book: its chapters, length and language, before deciding. */
export async function describeBook(book: Book) {
  const { parts, lang } = (await partsOf(book)) as { parts: Part[]; lang?: string };
  const characters = parts.reduce((n, p) => n + p.text.length, 0);
  return { chapters: parts.length, characters, lang: detectLang(parts.slice(0, 3).map((p) => p.text).join(" ").slice(0, 4000), lang), hours: characters / 15 / 3600 };
}

export function pauseAudiobook(bookId: string, paused: boolean) {
  useAudiobooks.getState().patch(bookId, { paused });
  if (!paused) {
    // Chapters that failed get another go.
    const a = useAudiobooks.getState().books[bookId];
    a?.chapters.forEach((c, i) => c.state === "error" && useAudiobooks.getState().patchChapter(bookId, i, { state: "waiting", error: undefined }));
    void run();
  }
}

/** Picks up unfinished audiobooks a minute after Haven starts. */
export function useAudiobookRunner() {
  useEffect(() => {
    const t = setTimeout(() => void run(), 60_000);
    return () => clearTimeout(t);
  }, []);
}

/** As episodes for the podcast player. */
export const audiobookShowId = (bookId: string) => `book:${bookId}`;
export const audiobookEpisodeId = (bookId: string, i: number) => `book:${bookId}:${i}`;
export const audioUrl = (bookId: string, i: number) => `audiobook:${bookId}:${i}`;
