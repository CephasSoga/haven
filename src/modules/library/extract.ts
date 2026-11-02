import { uid } from "@/lib/utils";
import type { Book } from "./store";

const COVER_WIDTH = 360;

/** Shrinks any image source into a small JPEG data URL for the shelf. */
async function toCover(src: CanvasImageSource & { width: number; height: number }) {
  const canvas = document.createElement("canvas");
  const scale = COVER_WIDTH / src.width;
  canvas.width = COVER_WIDTH;
  canvas.height = Math.round(src.height * scale);
  canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function titleFromFilename(name: string) {
  return name
    .replace(/\.(pdf|epub)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatOf(file: File): Book["format"] | null {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type === "application/epub+zip" || /\.epub$/i.test(file.name)) return "epub";
  return null;
}

/** Reads title, author, page count and a cover from a PDF or EPUB. Never throws: falls back to the filename. */
export async function describe(file: File): Promise<Book> {
  const format = formatOf(file)!;
  const base: Book = {
    id: uid(),
    title: titleFromFilename(file.name),
    format,
    size: file.size,
    progress: 0,
    status: "to-read",
    addedAt: Date.now(),
    readingSeconds: 0,
  };
  try {
    return format === "pdf" ? await describePdf(file, base) : await describeEpub(file, base);
  } catch {
    return base;
  }
}

async function describePdf(file: File, base: Book): Promise<Book> {
  const { pdfjs } = await import("./pdf");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: (COVER_WIDTH * 1.5) / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    // PDF.js draws on animation frames, which stop while the window is hidden — don't let the cover hold up adding the book.
    const task = page.render({ canvas, viewport });
    const drawn = await Promise.race([task.promise.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 8000))]).catch(() => false);
    if (!drawn) task.cancel();
    return {
      ...base,
      title: info.Title?.trim() || base.title,
      author: info.Author?.trim() || undefined,
      pages: doc.numPages,
      cover: drawn ? await toCover(canvas) : undefined,
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function describeEpub(file: File, base: Book): Promise<Book> {
  const { default: ePub } = await import("epubjs");
  const book = ePub(await file.arrayBuffer());
  try {
    const meta = await book.loaded.metadata;
    let cover: string | undefined;
    const url = await book.coverUrl();
    if (url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      cover = await toCover(img);
    }
    return { ...base, title: meta.title?.trim() || base.title, author: meta.creator?.trim() || undefined, cover };
  } finally {
    book.destroy();
  }
}
