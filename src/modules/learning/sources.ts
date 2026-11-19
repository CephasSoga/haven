import { because, inApp } from "@/lib/platform";

/*
 * Where free learning material is found. Each source is searched from your device, with no account:
 *
 *   MIT Learn         MIT's own catalogue: OpenCourseWare courses and lectures, MITx, videos and podcasts.
 *   TED               Every TED and TEDx talk, from the lists TED publishes for search engines (its own
 *                     search is closed to apps). The list is fetched once, kept on the device and searched there.
 *   OpenStax          Rice University's free, peer-reviewed textbooks.
 *   Open Textbook     The University of Minnesota's library of open textbooks.
 *   Wikibooks         Open textbooks written by volunteers, in English and French.
 *   Wikipedia         A short overview of the topic, to start with.
 *
 * Khan Academy, Coursera, edX, freeCodeCamp and others have no open search, so they're offered as links
 * that open their own search in your browser.
 */

export class LearnError extends Error {}

export type Kind = "course" | "video" | "talk" | "book" | "podcast" | "article";
export type SourceId = "mit" | "ted" | "openstax" | "otl" | "wikibooks" | "wikipedia" | "web";
export type Lang = "en" | "fr";

export const KINDS: Record<Kind, { label: string; plural: string; verb: string }> = {
  course: { label: "Course", plural: "Courses", verb: "Study" },
  video: { label: "Video", plural: "Videos", verb: "Watch" },
  talk: { label: "Talk", plural: "Talks", verb: "Watch" },
  book: { label: "Book", plural: "Books", verb: "Read" },
  podcast: { label: "Podcast", plural: "Podcasts", verb: "Listen to" },
  article: { label: "Article", plural: "Articles", verb: "Read" },
};

export const SOURCES: Record<SourceId, { name: string; short: string; color: string; site?: string }> = {
  mit: { name: "MIT OpenCourseWare & MIT Learn", short: "MIT", color: "#a31f34", site: "https://learn.mit.edu" },
  ted: { name: "TED & TEDx talks", short: "TED", color: "#e62b1e", site: "https://www.ted.com" },
  openstax: { name: "OpenStax textbooks", short: "OpenStax", color: "#f47641", site: "https://openstax.org" },
  otl: { name: "Open Textbook Library", short: "Open Textbook", color: "#7a0019", site: "https://open.umn.edu/opentextbooks" },
  wikibooks: { name: "Wikibooks", short: "Wikibooks", color: "#9b3b9b", site: "https://www.wikibooks.org" },
  wikipedia: { name: "Wikipedia", short: "Wikipedia", color: "#555b66", site: "https://www.wikipedia.org" },
  web: { name: "The web", short: "Link", color: "#6b7280" },
};

/** Something found. `id` is stable for the same material (source + its own key). */
export type Found = {
  id: string;
  source: SourceId;
  kind: Kind;
  title: string;
  url: string;
  /** Who made it: speaker, author, department */
  by?: string;
  description?: string;
  image?: string;
  minutes?: number;
  lang?: string;
};

/** Platforms without an open search: a link to their own search page. */
export const ELSEWHERE: { name: string; url: (q: string, lang: Lang) => string }[] = [
  { name: "Khan Academy", url: (q, lang) => `https://${lang === "fr" ? "fr" : "www"}.khanacademy.org/search?page_search_query=${encodeURIComponent(q)}` },
  { name: "Coursera", url: (q) => `https://www.coursera.org/search?query=${encodeURIComponent(q)}` },
  { name: "edX", url: (q) => `https://www.edx.org/search?q=${encodeURIComponent(q)}` },
  { name: "Class Central", url: (q) => `https://www.classcentral.com/search?q=${encodeURIComponent(q)}&free=true` },
  { name: "freeCodeCamp", url: (q) => `https://www.freecodecamp.org/news/search/?query=${encodeURIComponent(q)}` },
  { name: "FUN MOOC", url: (q) => `https://www.fun-mooc.fr/fr/cours/?query=${encodeURIComponent(q)}` },
  { name: "YouTube", url: (q, lang) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q} ${lang === "fr" ? "cours" : "lecture"}`)}` },
  { name: "TED", url: (q) => `https://www.ted.com/search?q=${encodeURIComponent(q)}` },
];

/* ---------- Fetching ---------- */

/**
 * Natively in the apps. In a browser, sites that don't allow pages to read them (MIT, TED, the Open Textbook
 * Library) go through Haven's own small fetcher.
 */
async function fetchOut(url: string, name: string, open: boolean): Promise<Response> {
  let res: Response;
  try {
    if (inApp) {
      const { fetch } = await import("@tauri-apps/plugin-http");
      res = await fetch(url, { connectTimeout: 15_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; Haven learning)" } });
    } else if (open) res = await fetch(url);
    else {
      res = await fetch(`/api/feed?url=${encodeURIComponent(url)}`, { headers: { "X-Haven": "1" } });
      if (res.status === 404) throw new LearnError(`${name} can only be searched in the Haven app (or with Haven's own server).`);
    }
  } catch (e) {
    if (e instanceof LearnError) throw e;
    throw new LearnError(`Couldn't reach ${name}${because(e)}. Check your internet connection.`);
  }
  if (!res.ok) throw new LearnError(`${name} answered ${res.status}. Try again in a moment.`);
  return res;
}

const getJson = async <T,>(url: string, name: string, open = true) => (await fetchOut(url, name, open)).json() as Promise<T>;

/** Text that may arrive gzipped (TED's lists are .xml.gz files). */
async function getText(url: string, name: string, open = true) {
  const res = await fetchOut(url, name, open);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

/* ---------- Small helpers ---------- */

const plain = (html?: string | null) =>
  (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const clip = (s: string, n = 260) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

/** "PT1H16M36S" → 77 */
export function isoMinutes(d?: string | null) {
  const m = d?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return undefined;
  const total = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60;
  return total ? Math.max(1, Math.round(total)) : undefined;
}

/** Lowercase, no accents: "Équations" → "equations" */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/* ---------- MIT Learn ---------- */

type MitResult = {
  id: number;
  title: string;
  url?: string;
  description?: string | null;
  resource_type: string;
  image?: { url?: string } | null;
  offered_by?: { name?: string } | null;
  platform?: { name?: string } | null;
  departments?: { name?: string }[];
  free?: boolean;
  video?: { duration?: string } | null;
  podcast_episode?: { duration?: string } | null;
  duration?: string;
  languages?: string[] | null;
};

const MIT_KINDS: Record<string, Kind> = { course: "course", program: "course", learning_path: "course", video: "video", video_playlist: "video", podcast_episode: "podcast", podcast: "podcast", document: "article" };

export async function searchMit(q: string, kinds?: Kind[], limit = 20): Promise<Found[]> {
  const qs = new URLSearchParams({ q, limit: String(limit), free: "true" });
  const types = kinds?.length ? Object.entries(MIT_KINDS).filter(([, k]) => kinds.includes(k)).map(([t]) => t) : [];
  for (const t of types) qs.append("resource_type", t);
  if (kinds?.length && !types.length) return [];
  const data = await getJson<{ results?: MitResult[] }>(`https://api.learn.mit.edu/api/v1/learning_resources_search/?${qs}`, "MIT Learn", false);
  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      id: `mit:${r.id}`,
      source: "mit" as const,
      kind: MIT_KINDS[r.resource_type] ?? "video",
      title: plain(r.title),
      url: r.url!,
      by: [r.offered_by?.name, r.departments?.[0]?.name].filter(Boolean).join(" · ") || r.platform?.name,
      description: clip(plain(r.description)) || undefined,
      image: r.image?.url || undefined,
      minutes: isoMinutes(r.video?.duration) ?? isoMinutes(r.podcast_episode?.duration) ?? isoMinutes(r.duration),
      lang: "en",
    }));
}

/* ---------- OpenStax ---------- */

type StaxBook = {
  id: number;
  title: string;
  meta: { slug: string; html_url?: string; locale?: string };
  book_state: string;
  cover_url?: string;
  description?: string;
  webview_rex_link?: string;
  book_subjects?: { subject_name?: string }[];
};

let staxBooks: { at: number; books: StaxBook[] } | null = null;

export async function searchOpenStax(q: string): Promise<Found[]> {
  if (!staxBooks || Date.now() - staxBooks.at > 86_400_000) {
    const qs = new URLSearchParams({ type: "books.Book", fields: "title,cover_url,description,book_state,webview_rex_link,book_subjects", limit: "250" });
    const data = await getJson<{ items?: StaxBook[] }>(`https://openstax.org/apps/cms/api/v2/pages/?${qs}`, "OpenStax");
    staxBooks = { at: Date.now(), books: (data.items ?? []).filter((b) => b.book_state === "live") };
  }
  const want = words(q);
  if (!want.length) return [];
  return staxBooks.books
    .map((b) => {
      const title = fold(b.title);
      const rest = fold(`${(b.book_subjects ?? []).map((s) => s.subject_name).join(" ")} ${plain(b.description)}`);
      let score = 0;
      for (const w of want) score += title.includes(w) ? 3 : rest.includes(w) ? 1 : -2;
      return { b, score };
    })
    // Most of the words have to be there (in the title, or at least in the description).
    .filter((x) => x.score >= want.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ b }) => ({
      id: `openstax:${b.id}`,
      source: "openstax" as const,
      kind: "book" as const,
      title: b.title,
      url: b.webview_rex_link || b.meta.html_url || `https://openstax.org/details/books/${b.meta.slug}`,
      by: "OpenStax · Rice University",
      description: clip(plain(b.description)) || undefined,
      image: b.cover_url,
      lang: b.meta.locale ?? "en",
    }));
}

/* ---------- Open Textbook Library ---------- */

type OtlBook = { id: number; title: string; url: string; description?: string; language?: string; contributors?: { first_name?: string; last_name?: string }[]; copyright_year?: number };

export async function searchOpenTextbooks(q: string, lang: Lang): Promise<Found[]> {
  const data = await getJson<{ data?: OtlBook[] }>(`https://open.umn.edu/opentextbooks/textbooks.json?q=${encodeURIComponent(q)}`, "the Open Textbook Library", false);
  const wanted = lang === "fr" ? ["fre", "fra"] : ["eng"];
  const all = data.data ?? [];
  // Books in your language first; others after.
  return [...all.filter((b) => wanted.includes(b.language ?? "")), ...all.filter((b) => !wanted.includes(b.language ?? ""))].slice(0, 8).map((b) => ({
    id: `otl:${b.id}`,
    source: "otl" as const,
    kind: "book" as const,
    title: b.title,
    url: b.url,
    by: (b.contributors ?? []).slice(0, 2).map((c) => [c.first_name, c.last_name].filter(Boolean).join(" ")).join(", ") || undefined,
    description: clip(plain(b.description)) || undefined,
    lang: b.language?.slice(0, 2),
  }));
}

/* ---------- Wikibooks and Wikipedia ---------- */

export async function searchWikibooks(q: string, lang: Lang): Promise<Found[]> {
  const qs = new URLSearchParams({ action: "query", list: "search", srsearch: q, srlimit: "20", format: "json", origin: "*" });
  const data = await getJson<{ query?: { search?: { title: string; snippet?: string; pageid: number }[] } }>(`https://${lang}.wikibooks.org/w/api.php?${qs}`, "Wikibooks");
  // Chapters ("Calculus/Limits") are shown as their book, once.
  const seen = new Set<string>();
  const out: Found[] = [];
  for (const r of data.query?.search ?? []) {
    const book = r.title.split("/")[0];
    if (seen.has(book)) continue;
    seen.add(book);
    out.push({
      id: `wikibooks:${lang}:${book}`,
      source: "wikibooks",
      kind: "book",
      title: book,
      url: `https://${lang}.wikibooks.org/wiki/${encodeURIComponent(book.replace(/ /g, "_"))}`,
      by: "Wikibooks",
      description: book === r.title ? clip(plain(r.snippet)) || undefined : `Chapter: ${r.title.slice(book.length + 1)}`,
      lang,
    });
    if (out.length >= 6) break;
  }
  return out;
}

export type Overview = { title: string; extract: string; url: string; image?: string };

/** Wikipedia's opening lines on the topic. */
export async function overview(q: string, lang: Lang): Promise<Overview | null> {
  const qs = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: q, gsrlimit: "1", prop: "extracts|pageimages|info", exintro: "1", explaintext: "1",
    exsentences: "3", inprop: "url", pithumbsize: "240", format: "json", origin: "*",
  });
  const data = await getJson<{ query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string; thumbnail?: { source?: string } }> } }>(
    `https://${lang}.wikipedia.org/w/api.php?${qs}`,
    "Wikipedia",
  );
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page?.extract || !page.fullurl) return null;
  return { title: page.title, extract: page.extract, url: page.fullurl, image: page.thumbnail?.source };
}

/* ---------- TED ---------- */

/**
 * TED's own lists for search engines, kept on this device (refreshed every two weeks):
 *  - the main TED talks (about 8,000) with title, description, picture, length and subtitle languages;
 *  - every TED and TEDx talk's address (about 100,000), whose words give speaker and title.
 */
type TedTalk = { slug: string; title: string; by?: string; about: string; image?: string; minutes?: number; year?: string; fr: boolean };
type TedIndex = { v: 2; at: number; main: TedTalk[]; more: string[]; speakers: string[] };

const DB = "haven-learning";
let dbPromise: Promise<IDBDatabase> | null = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("cache");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void) {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction("cache", mode);
    const req = fn(t.objectStore("cache"));
    t.oncomplete = () => resolve((req ? req.result : undefined) as T);
    t.onerror = () => reject(t.error);
  });
}

type TedLoaded = { main: (TedTalk & { text: string })[]; more: string[]; speakers: Set<string> };
let ted: TedLoaded | null = null;
let tedLoading: Promise<void> | null = null;
const TED_FRESH = 14 * 86_400_000;

const locs = (xml: string, kind: string) => [...xml.matchAll(new RegExp(`<loc>https://www\\.ted\\.com/${kind}/([^<]+)</loc>`, "g"))].map((m) => m[1]);
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^]*?)</${name}>`))?.[1];
const unxml = (s?: string) => (s ?? "").replace(/<!\[CDATA\[([^]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** The main talks, from the video list. */
function mainTalks(xml: string): TedTalk[] {
  const out: TedTalk[] = [];
  for (const m of xml.matchAll(/<url>([^]*?)<\/url>/g)) {
    const block = m[1];
    const slug = tag(block, "loc")?.match(/\/talks\/([^<?#]+)/)?.[1];
    const title = unxml(tag(block, "video:title"));
    if (!slug || !title) continue;
    // The address is the speaker's name followed by the title: what's left in front is who gave it.
    const titleWords = words(title).join("_");
    const by = titleWords && slug.endsWith(`_${titleWords}`) ? titleCase(slug.slice(0, -titleWords.length - 1).replace(/_/g, " ")) : undefined;
    const secs = Number(tag(block, "video:duration"));
    out.push({
      slug,
      title,
      by,
      about: clip(unxml(tag(block, "video:description")), 300),
      image: tag(block, "video:thumbnail_loc"),
      minutes: secs ? Math.max(1, Math.round(secs / 60)) : undefined,
      year: tag(block, "video:publication_date")?.slice(0, 4),
      fr: /language:fr"/.test(tag(block, "video:tag") ?? ""),
    });
  }
  return out;
}

const loaded = (i: TedIndex): TedLoaded => ({
  main: i.main.map((t) => ({ ...t, text: fold(`${t.title} ${t.by ?? ""} ${t.about}`) })),
  more: i.more,
  speakers: new Set(i.speakers),
});

/** Fetches TED's lists (about 5 MB in all, once) unless a recent copy is on the device. */
export function loadTed(onProgress?: (done: number, of: number) => void) {
  if (ted) return Promise.resolve();
  tedLoading ??= (async () => {
    const kept = await idb<TedIndex | undefined>("readonly", (s) => s.get("ted")).catch(() => undefined);
    const usable = kept?.v === 2 ? kept : undefined;
    if (usable && Date.now() - usable.at < TED_FRESH) {
      ted = loaded(usable);
      return;
    }
    try {
      const index = await getText("https://www.ted.com/sitemap.xml", "TED", false);
      const files = [...index.matchAll(/<loc>(https:\/\/www\.ted\.com\/sitemaps\/(?:videos|talks-\d+|speakers)\.xml(?:\.gz)?)<\/loc>/g)].map((m) => m[1]);
      if (!files.some((f) => f.includes("videos"))) throw new LearnError("TED's list of talks has changed shape; TED can't be searched for now.");
      let done = 0;
      onProgress?.(0, files.length);
      let main: TedTalk[] = [];
      const more: string[] = [];
      const speakers: string[] = [];
      // A few at a time, gently.
      for (let i = 0; i < files.length; i += 4)
        await Promise.all(
          files.slice(i, i + 4).map(async (f) => {
            const xml = await getText(f, "TED", false);
            if (f.includes("videos")) main = mainTalks(xml);
            else if (f.includes("speakers")) speakers.push(...locs(xml, "speakers"));
            else more.push(...locs(xml, "talks"));
            onProgress?.(++done, files.length);
          }),
        );
      const inMain = new Set(main.map((t) => t.slug));
      const index2: TedIndex = { v: 2, at: Date.now(), main, more: [...new Set(more)].filter((s) => !inMain.has(s)), speakers };
      ted = loaded(index2);
      await idb("readwrite", (s) => s.put(index2, "ted")).catch(() => undefined);
    } catch (e) {
      // An old copy beats none.
      if (usable) ted = loaded(usable);
      else throw e;
    }
  })().finally(() => {
    tedLoading = null;
  });
  return tedLoading;
}

export const tedReady = () => !!ted;

const titleCase = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Words a talk title often starts with, to tell a TEDx speaker's name from the title. */
const STARTERS = new Set(
  "how why what when where who which whose the a an my our your his her their this these that is are can do does did should would will was we i you it its to in on of for from with without one two three ten be being becoming beyond after before inside into let lets life living making learning finding building rethinking unlocking embracing breaking reimagining comment pourquoi quand ou qui que quoi le la les l un une des mon ma mes notre nos votre ce cette ces et est sommes etre faire vivre apprendre por como el los las una que".split(
    " ",
  ),
);

/** "gayatri_menon_how_can_schools_nurture_creativity" → { by: "Gayatri Menon", title: "How can schools nurture creativity" } */
function readSlug(slug: string, speakers: Set<string>) {
  const parts = slug.split("_");
  for (let n = Math.min(4, parts.length - 1); n >= 1; n--) {
    const who = parts.slice(0, n).join("_");
    if (speakers.has(who)) return { by: titleCase(parts.slice(0, n).join(" ")), title: sentence(parts.slice(n).join(" ")) };
  }
  const at = parts.findIndex((p, i) => i >= 2 && i <= 4 && STARTERS.has(p));
  if (at > 0) return { by: titleCase(parts.slice(0, at).join(" ")), title: sentence(parts.slice(at).join(" ")) };
  return { by: undefined, title: sentence(parts.join(" ")) };
}

/** Talks with every word searched for: main TED talks first (by title, speaker and description), then TEDx. */
export async function searchTed(q: string, lang: Lang = "en", limit = 12): Promise<Found[]> {
  await loadTed();
  if (!ted) return [];
  const want = words(q);
  if (!want.length) return [];
  const hits: { f: Found; score: number }[] = [];
  for (const t of ted.main) {
    let score = 0;
    const title = fold(`${t.title} ${t.by ?? ""}`);
    let all = true;
    for (const w of want) {
      if (title.includes(w)) score += 3;
      else if (t.text.includes(w)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (!all) continue;
    hits.push({
      score: score + 4 + (lang === "fr" && t.fr ? 1 : 0),
      f: {
        id: `ted:${t.slug}`,
        source: "ted",
        kind: "talk",
        title: t.title,
        by: [t.by, t.year].filter(Boolean).join(" · ") || undefined,
        description: [t.about, lang === "fr" && t.fr ? "Sous-titres en français." : ""].filter(Boolean).join(" "),
        image: t.image,
        minutes: t.minutes,
        url: `https://www.ted.com/talks/${t.slug}`,
      },
    });
  }
  for (const slug of ted.more) {
    const have = slug.split("_");
    let score = 0;
    let all = true;
    for (const w of want) {
      if (have.includes(w)) score += 2;
      else if (w.length >= 4 && have.some((h) => h.startsWith(w))) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (!all) continue;
    const { by, title } = readSlug(slug, ted.speakers);
    hits.push({ score: score - have.length * 0.05, f: { id: `ted:${slug}`, source: "ted", kind: "talk", title, by: by ? `${by} · TEDx` : "TEDx", url: `https://www.ted.com/talks/${slug}` } });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.f);
}

/* ---------- Everything at once ---------- */

export type SourceSearch = { source: SourceId; run: () => Promise<Found[]> };

/** One search per source, to run side by side (each shows as it arrives). */
export function searchesFor(q: string, lang: Lang, kinds: Kind[]): SourceSearch[] {
  const any = !kinds.length;
  const wants = (...k: Kind[]) => any || k.some((x) => kinds.includes(x));
  const out: SourceSearch[] = [];
  if (wants("course", "video", "podcast", "article")) out.push({ source: "mit", run: () => searchMit(q, any ? undefined : kinds) });
  if (wants("talk")) out.push({ source: "ted", run: () => searchTed(q, lang) });
  if (wants("book")) {
    out.push({ source: "openstax", run: () => (lang === "en" ? searchOpenStax(q) : Promise.resolve([])) });
    out.push({ source: "otl", run: () => searchOpenTextbooks(q, lang) });
    out.push({ source: "wikibooks", run: () => searchWikibooks(q, lang) });
  }
  return out;
}

/** A link you paste: its title, from the page itself when it can be read. */
export function fromLink(url: string, title?: string): Found {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const kind: Kind = /youtube\.com|youtu\.be|vimeo\.com/.test(host) ? "video" : /ted\.com/.test(host) ? "talk" : /podcast|spotify|apple\.com/.test(host) ? "podcast" : /coursera|edx|khanacademy|ocw\.mit|udemy|fun-mooc|openclassrooms/.test(host) ? "course" : "article";
  return { id: `web:${u.href}`, source: "web", kind, title: title?.trim() || host + (u.pathname.length > 1 ? decodeURIComponent(u.pathname).replace(/[-_/]+/g, " ") : ""), url: u.href, by: host };
}
