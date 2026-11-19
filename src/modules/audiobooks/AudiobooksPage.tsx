import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { BookHeadphones, Bookmark, BookmarkCheck, ChevronLeft, Library, Loader2, Pause, Play, Search } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, IconButton, Input, PageHeader } from "@/components/ui";
import { ask } from "@/components/confirm";
import { cn } from "@/lib/utils";
import { Art, EpisodeRow } from "@/modules/podcasts/PodcastsPage";
import { length, usePodcasts } from "@/modules/podcasts/store";
import { play, pause, usePlayer } from "@/modules/podcasts/player";
import { deleteAudiobook, pauseAudiobook, useAudiobooks, type Audiobook } from "@/modules/library/audiobook";
import { NATURAL } from "@/modules/library/voices";
import { useLibrary } from "@/modules/library/store";
import { bookDetails, CATEGORIES, coverOf, LANGUAGES, searchBooks, AudiobookError, type BookInfo, type Found } from "./sources";
import { chapterEpisode, madeEpisode, progressOf, useShelf, type ShelfBook } from "./store";

const ACCENT = "#c2410c";

export function AudiobooksPage() {
  const [params, setParams] = useSearchParams();
  const bookId = params.get("book");
  const mine = params.get("mine");
  const made = useAudiobooks((s) => (mine ? s.books[mine] : undefined));
  const back = () => setParams({}, { replace: true });

  return (
    <div className="flex flex-col gap-6">
      {made ? (
        <MadeView key={made.bookId} audiobook={made} onBack={back} />
      ) : bookId ? (
        <BookView key={bookId} id={bookId} onBack={back} />
      ) : (
        <Home openBook={(id) => setParams({ book: id })} openMine={(id) => setParams({ mine: id })} />
      )}
    </div>
  );
}

/* ---------- Home ---------- */

function Home({ openBook, openMine }: { openBook: (id: string) => void; openMine: (id: string) => void }) {
  const shelf = useShelf((s) => s.books);
  const made = useAudiobooks((s) => s.books);
  const listens = usePodcasts((s) => s.listens);
  const library = useLibrary((s) => s.books);

  // Books you're in the middle of, most recent first.
  const listening = useMemo(() => {
    const out: { key: string; title: string; author?: string; cover?: string; open: () => void; episodes: ReturnType<typeof chapterEpisode>[]; p: ReturnType<typeof progressOf> }[] = [];
    for (const b of Object.values(shelf)) {
      const episodes = b.chapters.map((_, i) => chapterEpisode(b, i));
      const p = progressOf(episodes, listens);
      out.push({ key: b.id, title: b.title, author: b.author, cover: b.cover, open: () => openBook(b.id), episodes, p });
    }
    for (const a of Object.values(made)) {
      const book = library.find((x) => x.id === a.bookId);
      const episodes = a.chapters.map((c, i) => (c.state === "ready" ? madeEpisode(a, i, book?.cover) : null)).filter((e): e is NonNullable<typeof e> => !!e);
      const p = progressOf(episodes, listens);
      if (p.started) out.push({ key: `mine-${a.bookId}`, title: book?.title ?? "A book", author: book?.author, cover: book?.cover, open: () => openMine(a.bookId), episodes, p });
    }
    return out.filter((x) => x.p.started && !x.p.finished).sort((a, b) => b.p.lastAt - a.p.lastAt);
  }, [shelf, made, listens, library]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = Object.values(shelf).filter((b) => !listening.some((l) => l.key === b.id));

  return (
    <>
      <PageHeader eyebrow="Read, watch & listen" title="Audiobooks" />
      {listening.length > 0 && (
        <Card>
          <CardHeader title="Continue listening" />
          <ul className="grid gap-2 p-3 sm:grid-cols-2">
            {listening.map((x) => (
              <li key={x.key} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-sunken/60">
                <button onClick={x.open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Art src={x.cover} className="size-16 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{x.title}</div>
                    {x.author && <div className="truncate text-[12px] text-muted">{x.author}</div>}
                    <div className="mt-0.5 text-[12px] text-muted">
                      Chapter {x.p.resume + 1} of {x.episodes.length}
                      {x.p.left ? ` · ${length(x.p.left)} left` : ""}
                    </div>
                  </div>
                </button>
                <PlayButton episode={x.episodes[x.p.resume]} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {Object.keys(made).length > 0 && <MadeList books={Object.values(made)} open={openMine} />}
      {saved.length > 0 && (
        <Card>
          <CardHeader title="Saved" subtitle="Books you've kept for later." />
          <Grid books={saved} open={openBook} />
        </Card>
      )}
      <Browse open={openBook} />
    </>
  );
}

function PlayButton({ episode }: { episode?: ReturnType<typeof chapterEpisode> }) {
  const playing = usePlayer((s) => s.playing && s.episode?.id === episode?.id);
  if (!episode) return null;
  return (
    <button
      onClick={() => (playing ? pause() : void play(episode))}
      aria-label={playing ? "Pause" : "Resume"}
      title={playing ? "Pause" : "Resume"}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-soft"
      style={{ background: ACCENT }}
    >
      {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
    </button>
  );
}

function Grid({ books, open }: { books: (Found | ShelfBook)[]; open: (id: string) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-5 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {books.map((b) => (
        <li key={b.id}>
          <button onClick={() => open(b.id)} className="group block w-full text-left" title={b.title}>
            <Art src={coverOf(b.id)} className="aspect-square w-full rounded-xl transition-transform group-hover:-translate-y-0.5" />
            <div className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{b.title}</div>
            <div className="truncate text-[12px] text-muted">
              {b.author ?? ""}
              {b.seconds ? `${b.author ? " · " : ""}${length(b.seconds)}` : ""}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Find and browse LibriVox. */
function Browse({ open }: { open: (id: string) => void }) {
  const [words, setWords] = useState("");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState(() => localStorage.getItem("haven:audiobooks-lang") ?? "all");
  const [category, setCategory] = useState("popular");
  const [page, setPage] = useState(1);
  const [books, setBooks] = useState<Found[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("haven:audiobooks-lang", language);
    } catch {
      /* only a preference */
    }
  }, [language]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(null);
    searchBooks({ words: query, language, category, page })
      .then((r) => {
        if (!alive) return;
        setBooks((prev) => (page === 1 ? r.books : [...prev, ...r.books]));
        setTotal(r.total);
      })
      .catch((e) => alive && setError(e instanceof AudiobookError ? e.message : "Couldn't load audiobooks. Try again."))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [query, language, category, page]);

  const reset = () => setPage(1);
  const chip = (active: boolean) => cn("shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors", active ? "bg-primary text-on-primary" : "bg-sunken text-muted hover:text-ink");

  return (
    <Card>
      <CardHeader title="Find an audiobook" subtitle="Free public-domain books from LibriVox, read by volunteers." />
      <div className="flex flex-col gap-3 px-4 pt-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            reset();
            setQuery(words.trim());
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={words} onChange={(e) => (setWords(e.target.value), !e.target.value && query && (reset(), setQuery("")))} placeholder="Title or author" className="pl-10" />
          </div>
          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>
        <div className="-mx-1 flex flex-wrap gap-1.5">
          {LANGUAGES.map((l) => (
            <button key={l.id} onClick={() => (reset(), setLanguage(l.id))} className={chip(language === l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="-mx-1 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => (reset(), setCategory(c.id))} className={chip(category === c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="px-6 pt-4 text-[13px] text-neg">{error}</p>}
      {!busy && !error && !books.length && <EmptyState icon={<BookHeadphones className="size-5" />} title="Nothing found" body="Try other words, another language or category." />}
      <Grid books={books} open={open} />
      {(busy || books.length < total) && (
        <div className="flex justify-center px-4 pb-5">
          {busy ? (
            <Loader2 className="size-5 animate-spin text-muted" />
          ) : (
            <Button size="sm" onClick={() => setPage((p) => p + 1)}>
              Show more
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/* ---------- A LibriVox book ---------- */

function BookView({ id, onBack }: { id: string; onBack: () => void }) {
  const saved = useShelf((s) => s.books[id]);
  const { save, remove } = useShelf();
  const listens = usePodcasts((s) => s.listens);
  const [info, setInfo] = useState<BookInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    bookDetails(id)
      .then((b) => {
        if (!alive) return;
        setInfo(b);
        // Keep a saved book's chapter list up to date.
        if (useShelf.getState().books[id]) save(b);
      })
      .catch((e) => alive && setError(e instanceof AudiobookError ? e.message : "This audiobook couldn't be loaded."));
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const book = info ?? saved;
  const episodes = book ? book.chapters.map((_, i) => chapterEpisode(book, i)) : [];
  const p = progressOf(episodes, listens);
  const start = () => {
    if (!book) return;
    // Playing it keeps it, so your place is remembered (on your other devices too).
    if (info) save(info);
    void play(episodes[p.started ? p.resume : 0]);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <IconButton label="Back to audiobooks" onClick={onBack} className="-ml-2">
          <ChevronLeft className="size-5" />
        </IconButton>
        <span className="text-[13px] font-medium text-muted">Audiobooks</span>
      </div>
      {!book && !error && (
        <div className="flex justify-center py-16 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {error && !book && <Card className="p-6 text-center text-[14px] text-neg">{error}</Card>}
      {book && (
        <>
          <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
            <Art src={book.cover} className="size-40 shrink-0 rounded-2xl shadow-card" />
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{book.title}</h1>
              {book.author && <p className="mt-1 text-muted">{book.author}</p>}
              <p className="mt-2 text-[13px] text-muted">
                {[book.language && languageName(book.language), book.seconds && length(book.seconds), `${book.chapters.length} chapters`, "LibriVox · public domain"].filter(Boolean).join(" · ")}
              </p>
              {info?.description && <p className="mt-3 line-clamp-5 text-[14px] text-muted">{info.description}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" onClick={start}>
                  <Play className="size-4" fill="currentColor" /> {p.started && !p.finished ? `Resume chapter ${p.resume + 1}` : "Play"}
                </Button>
                {saved ? (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (p.started && !(await ask({ title: `Remove ${book.title} from your audiobooks?`, body: "Where you are in it is forgotten.", confirmLabel: "Remove", danger: true }))) return;
                      remove(id);
                    }}
                  >
                    <BookmarkCheck className="size-4" /> Saved
                  </Button>
                ) : (
                  info && (
                    <Button onClick={() => save(info)}>
                      <Bookmark className="size-4" /> Save for later
                    </Button>
                  )
                )}
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Chapters" subtitle={p.started ? `${length(p.left)} left` : undefined} />
            <ul className="flex flex-col p-2 pt-3">
              {episodes.map((e) => (
                <EpisodeRow key={e.id} episode={e} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

const LANGUAGE_NAMES: Record<string, string> = { eng: "English", fre: "French", fra: "French", spa: "Spanish", ita: "Italian", por: "Portuguese", ger: "German", deu: "German", dut: "Dutch", lat: "Latin", rus: "Russian", chi: "Chinese", jpn: "Japanese" };
const languageName = (code: string) => LANGUAGE_NAMES[code.toLowerCase()] ?? code;

/* ---------- Books from your Library, made into audio ---------- */

const readyCount = (a: Audiobook) => a.chapters.filter((c) => c.state === "ready").length;

function MadeList({ books, open }: { books: Audiobook[]; open: (id: string) => void }) {
  const library = useLibrary((s) => s.books);
  return (
    <Card>
      <CardHeader title="From your Library" subtitle="Your own books, read by an on-device voice." />
      <ul className="flex flex-col p-2 pt-3">
        {[...books]
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((a) => {
            const book = library.find((b) => b.id === a.bookId);
            const making = a.chapters.find((c) => c.state === "making");
            return (
              <li key={a.bookId}>
                <button onClick={() => open(a.bookId)} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-sunken/60">
                  <Art src={book?.cover} className="h-14 w-10 shrink-0 rounded-md" />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{book?.title ?? "A book"}</div>
                    <div className="truncate text-[12px] text-muted">
                      {readyCount(a)} of {a.chapters.length} chapters ready
                      {making ? ` · making “${making.title}” ${Math.round((making.done ?? 0) * 100)}%` : a.paused ? " · paused" : ""}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
      </ul>
    </Card>
  );
}

function MadeView({ audiobook: a, onBack }: { audiobook: Audiobook; onBack: () => void }) {
  const book = useLibrary((s) => s.books.find((b) => b.id === a.bookId));
  const voice = NATURAL.find((v) => v.id === a.voice);
  const left = a.chapters.filter((c) => c.state !== "ready").length;
  const listened = a.chapters.reduce((n, c) => n + (c.seconds ?? 0), 0);

  return (
    <>
      <div className="flex items-center gap-2">
        <IconButton label="Back to audiobooks" onClick={onBack} className="-ml-2">
          <ChevronLeft className="size-5" />
        </IconButton>
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
          <Library className="size-3.5" /> From your Library
        </span>
      </div>
      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
        <Art src={book?.cover} className="h-40 w-28 shrink-0 rounded-xl shadow-card" />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{book?.title ?? "A book"}</h1>
          {book?.author && <p className="mt-1 text-muted">{book.author}</p>}
          <p className="mt-3 text-[14px] text-muted">
            Read by {voice?.label ?? a.voice} · {readyCount(a)} of {a.chapters.length} chapters ready{listened ? ` · ${length(listened)} so far` : ""}
            {left > 0 && (a.paused ? " · paused" : " · the rest is being made in the background")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {left > 0 && (
              <Button size="sm" onClick={() => pauseAudiobook(a.bookId, !a.paused)}>
                {a.paused ? <Play className="size-4" /> : <Pause className="size-4" />} {a.paused ? "Continue making" : "Pause making"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!(await ask({ title: "Delete this audiobook?", body: "Its audio is removed from this device. The book stays in your Library, and you can make the audio again.", confirmLabel: "Delete", danger: true }))) return;
                await deleteAudiobook(a.bookId);
                onBack();
              }}
            >
              Delete audio
            </Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Chapters" />
        <ul className="flex flex-col p-2 pt-3">
          {a.chapters.map((c, i) =>
            c.state === "ready" ? (
              <EpisodeRow key={i} episode={madeEpisode(a, i, book?.cover)} />
            ) : (
              <li key={i} className="flex items-center gap-3 rounded-2xl p-2.5 opacity-70">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-sunken text-muted">
                  {c.state === "making" ? <Loader2 className="size-4 animate-spin" /> : <span className="text-[12px] tabular">{i + 1}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{c.title}</div>
                  <div className={cn("text-[12px]", c.state === "error" ? "text-neg" : "text-muted")}>
                    {c.state === "making" ? `Being made… ${Math.round((c.done ?? 0) * 100)}%` : c.state === "error" ? `Couldn't be made: ${c.error ?? "unknown problem"}` : a.paused ? "Paused" : "Waiting its turn"}
                  </div>
                  {c.state === "making" && (
                    <div className="mt-1.5 h-1 w-40 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full" style={{ width: `${Math.round((c.done ?? 0) * 100)}%`, background: ACCENT }} />
                    </div>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      </Card>
    </>
  );
}
