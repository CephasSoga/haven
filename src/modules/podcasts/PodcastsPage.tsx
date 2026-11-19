import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { formatDistanceToNowStrict, isThisYear, format } from "date-fns";
import { Check, ChevronLeft, ListEnd, ListPlus, ListX, Loader2, Pause, Play, Plus, Podcast as PodcastIcon, RefreshCw, Rss, Search } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, IconButton, Input, PageHeader } from "@/components/ui";
import { ask } from "@/components/confirm";
import { cn } from "@/lib/utils";
import { fetchShow, PodcastError, searchShows, type Found } from "./sources";
import { play, pause, refreshShows, usePlayer } from "./player";
import { clock, length, ref, usePodcastCache, usePodcasts, type Episode, type EpisodeRef, type Show } from "./store";

const ACCENT = "#9b5de5";

export function PodcastsPage() {
  const [params, setParams] = useSearchParams();
  const showId = params.get("show");
  const feed = params.get("feed");
  const shows = usePodcasts((s) => s.shows);
  const followed = shows.find((s) => s.id === showId);

  return (
    <div className="flex flex-col gap-6">
      {followed || feed ? (
        <ShowView key={followed?.id ?? feed} show={followed ?? null} feedUrl={followed?.feedUrl ?? feed!} onBack={() => setParams({}, { replace: true })} />
      ) : (
        <Home openShow={(id) => setParams({ show: id })} openFeed={(url) => setParams({ feed: url })} />
      )}
    </div>
  );
}

/* ---------- Home ---------- */

function Home({ openShow, openFeed }: { openShow: (id: string) => void; openFeed: (url: string) => void }) {
  const shows = usePodcasts((s) => s.shows);
  const queue = usePodcasts((s) => s.queue);
  const feeds = usePodcastCache((s) => s.feeds);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // Opening the page fetches anything not looked at in the last hour.
    if (shows.length) void refreshShows({ quiet: true, olderThan: 60 * 60_000 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = useMemo(
    () =>
      shows
        .flatMap((s) => (feeds[s.id]?.episodes ?? []).slice(0, 10))
        .sort((a, b) => b.published - a.published)
        .slice(0, 25),
    [shows, feeds],
  );

  return (
    <>
      <PageHeader
        eyebrow="Read, watch & listen"
        title="Podcasts"
        actions={
          shows.length > 0 && (
            <Button
              onClick={async () => {
                setRefreshing(true);
                await refreshShows({ quiet: true });
                setRefreshing(false);
              }}
              disabled={refreshing}
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} /> Check for new episodes
            </Button>
          )
        }
      />
      <Finder openShow={openShow} openFeed={openFeed} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          {queue.length > 0 && (
            <Card>
              <CardHeader title="Up next" subtitle="Plays on its own when the current episode ends." />
              <ul className="flex flex-col p-2 pt-3">
                {queue.map((e) => (
                  <EpisodeRow key={e.id} episode={e} showName />
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Latest episodes" subtitle={shows.length ? "From the shows you follow." : undefined} />
            {latest.length ? (
              <ul className="flex flex-col p-2 pt-3">
                {latest.map((e) => (
                  <EpisodeRow key={e.id} episode={e} showName />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<PodcastIcon className="size-5" />}
                title={shows.length ? "Fetching episodes…" : "No shows yet"}
                body={shows.length ? "They'll appear here in a moment." : "Search for a show above and follow it; its new episodes will show up here."}
              />
            )}
          </Card>
        </div>
        {shows.length > 0 && (
          <Card>
            <CardHeader title="Your shows" subtitle={`${shows.length} followed`} />
            <ul className="grid grid-cols-3 gap-3 p-4 lg:grid-cols-3">
              {[...shows]
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((s) => (
                  <li key={s.id}>
                    <ShowTile show={s} onClick={() => openShow(s.id)} />
                  </li>
                ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function ShowTile({ show, onClick }: { show: Show; onClick: () => void }) {
  const episodes = usePodcastCache((s) => s.feeds[show.id]?.episodes);
  const fresh = (episodes ?? []).filter((e) => e.published > show.seenAt).length;
  return (
    <button onClick={onClick} className="group relative block w-full text-left" title={show.title}>
      <Art src={show.artwork} className="aspect-square w-full rounded-xl transition-transform group-hover:-translate-y-0.5" />
      {fresh > 0 && <span className="absolute right-1 top-1 rounded-full px-1.5 text-[11px] font-semibold text-white shadow-soft" style={{ background: ACCENT }}>{fresh}</span>}
      <div className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-tight">{show.title}</div>
    </button>
  );
}

function Art({ src, className }: { src?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={cn("bg-sunken object-cover", className)} />
  ) : (
    <div className={cn("flex items-center justify-center bg-sunken text-faint", className)}>
      <PodcastIcon className="size-1/3" />
    </div>
  );
}

/** Search the directory, or paste a feed's address. */
function Finder({ openShow, openFeed }: { openShow: (id: string) => void; openFeed: (url: string) => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shows = usePodcasts((s) => s.shows);
  const follow = usePodcasts((s) => s.follow);
  const isUrl = /^https?:\/\/\S+$/i.test(term.trim());

  const run = async () => {
    const q = term.trim();
    if (!q) return;
    if (isUrl) return openFeed(q);
    setBusy(true);
    setError(null);
    try {
      setResults(await searchShows(q));
    } catch (e) {
      setError(e instanceof PodcastError ? e.message : "The search didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={term} onChange={(e) => (setTerm(e.target.value), !e.target.value && setResults(null))} placeholder="Find a show, or paste its RSS address" className="pl-10" />
        </div>
        <Button type="submit" variant="primary" disabled={!term.trim() || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : isUrl ? <Rss className="size-4" /> : <Search className="size-4" />}
          {isUrl ? "Open feed" : "Search"}
        </Button>
      </form>
      {error && <p className="mt-3 text-[13px] text-neg">{error}</p>}
      {results && (
        <ul className="mt-4 flex flex-col gap-1">
          {!results.length && <li className="px-2 py-4 text-center text-[14px] text-muted">No shows found. Try other words, or paste the show's RSS address.</li>}
          {results.map((r) => {
            const mine = shows.some((s) => s.id === r.id);
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-sunken/60">
                <button onClick={() => (mine ? openShow(r.id) : openFeed(r.feedUrl))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Art src={r.artwork} className="size-12 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.title}</div>
                    {r.author && <div className="truncate text-[13px] text-muted">{r.author}</div>}
                  </div>
                </button>
                {mine ? (
                  <span className="flex items-center gap-1 px-2 text-[13px] text-muted">
                    <Check className="size-4" /> Following
                  </span>
                ) : (
                  <Button size="sm" onClick={() => (follow(r), void refreshShows({ quiet: true, olderThan: 60 * 60_000 }))}>
                    <Plus className="size-4" /> Follow
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------- One show ---------- */

function ShowView({ show, feedUrl, onBack }: { show: Show | null; feedUrl: string; onBack: () => void }) {
  const { follow, unfollow, updateShow, listens, setPlayed } = usePodcasts();
  const cached = usePodcastCache((s) => (show ? s.feeds[show.id] : undefined));
  const [loaded, setLoaded] = useState<{ info: Found; episodes: Episode[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setParams] = useSearchParams();

  // Fetch the feed: always for a show you're only looking at, and for yours when it's over an hour old.
  useEffect(() => {
    if (show && cached && Date.now() - cached.fetchedAt < 60 * 60_000) return;
    let alive = true;
    setBusy(true);
    fetchShow(feedUrl)
      .then((r) => {
        if (!alive) return;
        setLoaded({ info: r.show, episodes: r.episodes });
        if (show) {
          usePodcastCache.getState().put(show.id, r.episodes);
          updateShow(show.id, { title: r.show.title, author: r.show.author, artwork: r.show.artwork ?? show.artwork, description: r.show.description, link: r.show.link });
        }
      })
      .catch((e) => alive && setError(e instanceof PodcastError ? e.message : "This show's feed couldn't be read."))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [feedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a show you follow means you've seen what's new in it.
  useEffect(() => {
    if (show) return () => updateShow(show.id, { seenAt: Date.now() });
  }, [show?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const info = show ?? loaded?.info;
  const episodes = (show ? cached?.episodes : undefined) ?? loaded?.episodes ?? [];
  const unplayed = episodes.filter((e) => !listens[e.id]?.played).length;

  return (
    <>
      <div className="flex items-center gap-2">
        <IconButton label="Back to podcasts" onClick={onBack} className="-ml-2">
          <ChevronLeft className="size-5" />
        </IconButton>
        <span className="text-[13px] font-medium text-muted">Podcasts</span>
      </div>
      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
        <Art src={info?.artwork} className="size-32 shrink-0 rounded-2xl shadow-card sm:size-40" />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{info?.title ?? (busy ? "Loading…" : "Podcast")}</h1>
          {info?.author && <p className="mt-1 text-muted">{info.author}</p>}
          {info?.description && <p className="mt-3 line-clamp-4 text-[14px] text-muted">{info.description}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {show ? (
              <>
                {unplayed > 0 && (
                  <Button size="sm" onClick={() => episodes.forEach((e) => !listens[e.id]?.played && setPlayed(e.id, true))}>
                    <Check className="size-4" /> Mark all played
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!(await ask({ title: `Unfollow ${show.title}?`, body: "It leaves your shows and Up next. Notes you took on it stay in Notes.", confirmLabel: "Unfollow", danger: true }))) return;
                    unfollow(show.id);
                    usePodcastCache.getState().drop(show.id);
                    onBack();
                  }}
                >
                  Unfollow
                </Button>
              </>
            ) : (
              loaded && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    follow(loaded.info);
                    usePodcastCache.getState().put(loaded.info.id, loaded.episodes);
                    setParams({ show: loaded.info.id }, { replace: true });
                  }}
                >
                  <Plus className="size-4" /> Follow
                </Button>
              )
            )}
          </div>
        </div>
      </Card>
      {error && !episodes.length && <Card className="p-6 text-center text-[14px] text-neg">{error}</Card>}
      {episodes.length > 0 && (
        <Card>
          <CardHeader title="Episodes" subtitle={`${episodes.length} latest${unplayed ? ` · ${unplayed} not played` : ""}`} />
          <ul className="flex flex-col p-2 pt-3">
            {episodes.map((e) => (
              <EpisodeRow key={e.id} episode={e} isNew={!!show && e.published > show.seenAt} />
            ))}
          </ul>
        </Card>
      )}
      {busy && !episodes.length && !error && (
        <div className="flex justify-center py-10 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
    </>
  );
}

/* ---------- An episode ---------- */

function when(ms: number) {
  if (!ms) return "";
  if (Date.now() - ms < 7 * 86_400_000) return formatDistanceToNowStrict(ms, { addSuffix: true });
  return format(ms, isThisYear(ms) ? "MMM d" : "MMM d, yyyy");
}

function EpisodeRow({ episode, showName, isNew }: { episode: Episode | EpisodeRef; showName?: boolean; isNew?: boolean }) {
  const listen = usePodcasts((s) => s.listens[episode.id]);
  const inQueue = usePodcasts((s) => s.queue.some((e) => e.id === episode.id));
  const show = usePodcasts((s) => s.shows.find((x) => x.id === episode.showId));
  const { enqueue, dequeue, setPlayed } = usePodcasts.getState();
  const current = usePlayer((s) => s.episode?.id === episode.id);
  const playing = usePlayer((s) => s.playing && s.episode?.id === episode.id);
  const position = usePlayer((s) => (s.episode?.id === episode.id ? s.position : null));
  const [open, setOpen] = useState(false);
  const description = "description" in episode ? episode.description : undefined;

  const total = listen?.duration ?? episode.duration ?? 0;
  const at = position ?? listen?.position ?? 0;
  const started = !listen?.played && at > 5;
  const left = total && started ? Math.max(0, total - at) : 0;

  return (
    <li className={cn("group flex gap-3 rounded-2xl p-2.5 hover:bg-sunken/60", listen?.played && "opacity-60")}>
      <Art src={episode.artwork || show?.artwork} className="size-12 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <button onClick={() => setOpen(!open)} className="block w-full text-left">
          <div className="flex items-start gap-1.5">
            {isNew && !listen?.played && <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: ACCENT }} title="New" />}
            <span className={cn("text-[14px] font-medium leading-snug", !open && "line-clamp-2")}>{episode.title}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
            {showName && show && <span className="truncate font-medium">{show.title}</span>}
            {showName && show && <span>·</span>}
            <span>{when(episode.published)}</span>
            {total > 0 && <span>· {started ? `${length(left)} left` : length(total)}</span>}
            {listen?.played && (
              <span className="flex items-center gap-0.5">
                · <Check className="size-3" /> Played
              </span>
            )}
          </div>
          {started && total > 0 && (
            <div className="mt-1.5 h-1 w-40 max-w-full overflow-hidden rounded-full bg-sunken">
              <div className="h-full" style={{ width: `${Math.min(100, (at / total) * 100)}%`, background: ACCENT }} />
            </div>
          )}
          {open && description && <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted">{description}</p>}
        </button>
      </div>
      <div className="flex shrink-0 items-start gap-0.5">
        <button
          onClick={() => (playing ? pause() : void play(ref(episode as Episode)))}
          aria-label={playing ? "Pause" : started ? `Resume at ${clock(at)}` : "Play"}
          title={playing ? "Pause" : started ? `Resume at ${clock(at)}` : "Play"}
          className={cn("flex size-9 items-center justify-center rounded-full transition-colors", current ? "text-white" : "bg-sunken text-ink hover:bg-line")}
          style={current ? { background: ACCENT } : undefined}
        >
          {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
        </button>
        <span className="flex flex-col gap-0.5 sm:flex-row">
          <IconButton
            label={inQueue ? "Remove from Up next" : "Add to Up next"}
            onClick={() => (inQueue ? dequeue(episode.id) : enqueue(ref(episode as Episode)))}
            className={cn("size-9", inQueue && "text-ink")}
          >
            {inQueue ? <ListX className="size-4" /> : <ListPlus className="size-4" />}
          </IconButton>
          <IconButton label={listen?.played ? "Mark as not played" : "Mark as played"} onClick={() => setPlayed(episode.id, !listen?.played)} className="size-9 max-sm:hidden">
            {listen?.played ? <ListEnd className="size-4" /> : <Check className="size-4" />}
          </IconButton>
        </span>
      </div>
    </li>
  );
}
