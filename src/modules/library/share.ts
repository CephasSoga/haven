import { downloadBook } from "@/lib/sync";
import { getFile } from "./files";
import type { Book } from "./store";

const MIME = { pdf: "application/pdf", epub: "application/epub+zip" } as const;

/** The book as a file named after its title — fetched from your account if this device doesn't have it yet. */
async function bookFile(book: Book): Promise<File | null> {
  const blob = (await getFile(book.id).catch(() => undefined)) ?? (await downloadBook(book.id).catch(() => undefined));
  if (!blob) return null;
  const name = `${book.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Book"}.${book.format}`;
  return new File([blob], name, { type: MIME[book.format] });
}

function saveFile(file: File) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export type ShareResult = "shared" | "saved" | "cancelled" | "missing";

/** Opens the system share sheet with the book file; where sharing files isn't possible, saves a copy instead. */
export async function shareBook(book: Book): Promise<ShareResult> {
  const file = await bookFile(book);
  if (!file) return "missing";
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: book.title, text: book.author ? `${book.title} — ${book.author}` : book.title });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  saveFile(file);
  return "saved";
}

export async function saveBookCopy(book: Book): Promise<ShareResult> {
  const file = await bookFile(book);
  if (!file) return "missing";
  saveFile(file);
  return "saved";
}

export const SHARE_MESSAGES: Record<ShareResult, string | null> = {
  shared: null,
  cancelled: null,
  saved: "A copy of the book was saved to your downloads.",
  missing: "This book's file isn't on this device or in your account.",
};
