import { because, inApp } from "@/lib/platform";

/**
 * Free audiobooks from LibriVox: public-domain books read by volunteers, in many languages. The
 * recordings live on the Internet Archive, whose free search and item APIs give the catalogue,
 * each book's chapters (one MP3 per chapter, with titles and lengths) and its cover.
 */

export class AudiobookError extends Error {}

export type Found = { id: string; title: string; author?: string; language?: string; seconds?: number; downloads?: number };
export type ChapterInfo = { title: string; url: string; seconds?: number };
export type BookInfo = Found & { description?: string; cover: string; chapters: ChapterInfo[] };

/** Languages offered for browsing, as the Archive labels them. */
export const LANGUAGES: { id: string; label: string; query: string }[] = [
  { id: "all", label: "All languages", query: "" },
  { id: "en", label: "English", query: "eng OR English" },
  { id: "fr", label: "French", query: "fre OR fra OR French" },
  { id: "es", label: "Spanish", query: "spa OR Spanish" },
  { id: "it", label: "Italian", query: "ita OR Italian" },
  { id: "pt", label: "Portuguese", query: "por OR Portuguese" },
  { id: "de", label: "German", query: "ger OR deu OR German" },
];

export const CATEGORIES: { id: string; label: string; query: string }[] = [
  { id: "popular", label: "Most listened", query: "" },
  { id: "mystery", label: "Mystery", query: "mystery OR detective OR crime" },
  { id: "adventure", label: "Adventure", query: "adventure" },
  { id: "scifi", label: "Science fiction", query: '"science fiction" OR fantasy' },
  { id: "romance", label: "Romance", query: "romance OR love" },
  { id: "children", label: "Children", query: "children OR fairy OR \"fairy tales\"" },
  { id: "poetry", label: "Poetry", query: "poetry OR poems" },
  { id: "history", label: "History", query: "history OR biography" },
  { id: "philosophy", label: "Philosophy", query: "philosophy OR religion" },
  { id: "short", label: "Short stories", query: '"short stories" OR "short story"' },
];

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    if (inApp) {
      const { fetch } = await import("@tauri-apps/plugin-http");
      res = await fetch(url, { connectTimeout: 15_000 });
    } else res = await fetch(url);
  } catch (e) {
    throw new AudiobookError(`Couldn't reach the Internet Archive${because(e)}. Check your internet connection.`);
  }
  if (!res.ok) throw new AudiobookError(`The Internet Archive answered ${res.status}. Try again in a moment.`);
  return res.json() as Promise<T>;
}

/** "13:06:44", "18:52" or "1132.5" → seconds */
function seconds(s?: string | number) {
  if (s === undefined || s === null || s === "") return undefined;
  if (typeof s === "number") return Math.round(s);
  if (!s.includes(":")) return Math.round(Number(s)) || undefined;
  return s.split(":").map(Number).reduce((t, n) => t * 60 + (n || 0), 0) || undefined;
}

/**
 * Some titles were stored with their accents mangled ("L'arrivÃ©e" for "L'arrivée": UTF-8 read as
 * Latin-1). Put them back when that's clearly what happened.
 */
// Accented letters as saved by Chinese-language software (GBK), seen in Latin-1: "¨¨" is "è".
const GBK_LATIN = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüê";

export function fixText(s: string) {
  if (/¨[¡-º]/.test(s)) s = s.replace(/¨([¡-º])/g, (_, c: string) => GBK_LATIN[c.charCodeAt(0) - 0xa1] ?? c);
  if (!/[ÃÂ][-¿]/.test(s) || [...s].some((c) => c.charCodeAt(0) > 255)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([...s].map((c) => c.charCodeAt(0))));
  } catch {
    return s;
  }
}

const first = (v: unknown) => {
  const x = (Array.isArray(v) ? v[0] : v) as string | undefined;
  return typeof x === "string" ? fixText(x) : x;
};
const clean = (s: string) => s.replace(/[*()[\]{}:^"\\]/g, " ").trim();

/** Searches (or browses, with no words) LibriVox's catalogue: most listened first. */
export async function searchBooks({ words = "", language = "all", category = "popular", page = 1 }: { words?: string; language?: string; category?: string; page?: number }) {
  const parts = ["collection:librivoxaudio"];
  const w = clean(words);
  if (w) parts.push(`(title:(${w}) OR creator:(${w}))`);
  const lang = LANGUAGES.find((l) => l.id === language);
  if (lang?.query) parts.push(`language:(${lang.query})`);
  const cat = CATEGORIES.find((c) => c.id === category);
  if (cat?.query) parts.push(`subject:(${cat.query})`);
  const qs = new URLSearchParams({ q: parts.join(" AND "), sort: "downloads desc", rows: "24", page: String(page), output: "json" });
  for (const f of ["identifier", "title", "creator", "language", "runtime", "downloads"]) qs.append("fl[]", f);
  const data = await getJson<{ response: { numFound: number; docs: Record<string, unknown>[] } }>(`https://archive.org/advancedsearch.php?${qs}`);
  const books: Found[] = data.response.docs.map((d) => ({
    id: String(d.identifier),
    title: String(first(d.title) ?? d.identifier),
    author: first(d.creator),
    language: first(d.language),
    seconds: seconds(first(d.runtime)),
    downloads: Number(d.downloads) || undefined,
  }));
  return { books, total: data.response.numFound };
}

export const coverOf = (id: string) => `https://archive.org/services/img/${encodeURIComponent(id)}`;

function plain(html: string, max = 1200) {
  const t = (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A book's details and chapters, in order. */
export async function bookDetails(id: string): Promise<BookInfo> {
  const data = await getJson<{ metadata?: Record<string, unknown>; files?: Record<string, string>[] }>(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!data.metadata) throw new AudiobookError("This audiobook isn't on the Internet Archive anymore.");
  const m = data.metadata;
  const files = data.files ?? [];
  // LibriVox puts each chapter up as a 64 kbps MP3 (smaller, plenty for speech); fall back to any MP3.
  let mp3 = files.filter((f) => f.format === "64Kbps MP3");
  if (!mp3.length) mp3 = files.filter((f) => /mp3/i.test(f.format ?? "") && f.source === "original");
  const order = (f: Record<string, string>) => Number(f.track?.split("/")[0]) || 0;
  mp3.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const chapters = mp3.map((f, i) => ({
    title: (f.title && fixText(f.title.trim())) || `Chapter ${i + 1}`,
    url: `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split("/").map(encodeURIComponent).join("/")}`,
    seconds: seconds(f.length),
  }));
  if (!chapters.length) throw new AudiobookError("This audiobook has no chapters to play.");
  // The Archive's description is often one line; LibriVox's own catalogue has the real summary.
  let summary: string | undefined;
  if (m.call_number && /^\d+$/.test(String(m.call_number)))
    summary = await getJson<{ books?: { description?: string }[] }>(`https://librivox.org/api/feed/audiobooks/?id=${m.call_number}&format=json`)
      .then((r) => (r.books?.[0]?.description ? plain(r.books[0].description) : undefined))
      .catch(() => undefined);
  return {
    id,
    title: String(first(m.title as string) ?? id),
    author: first(m.creator as string),
    language: first(m.language as string),
    seconds: seconds(first(m.runtime as string)) ?? chapters.reduce((t, c) => t + (c.seconds ?? 0), 0),
    description: summary ?? (m.description ? plain(String(first(m.description as string))) : undefined),
    cover: coverOf(id),
    chapters,
  };
}
