import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { addDays, differenceInCalendarDays, format, formatDistanceToNowStrict, isSameMonth, startOfWeek } from "date-fns";
import { AlertTriangle, Bell, BellRing, Check, Clapperboard, ExternalLink, Eye, EyeOff, Film, Gamepad2, MonitorPlay, Music2, RotateCw, Search, SlidersHorizontal, Tv } from "lucide-react";
import { Button, Card, EmptyState, Input, Modal, PageHeader, Segmented, Switch } from "@/components/ui";
import { dayKey, parseDay } from "@/lib/dates";
import { inApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { checkReleases } from "./check";
import { fetchGameGenres, testTmdb } from "./sources";
import { fromSubscriptions, linksFor, PLATFORMS, useMyPlatforms, type PlatformKind } from "./platforms";
import { useSubscriptions } from "@/modules/subscriptions/store";
import { KINDS, MOVIE_GENRES, MUSIC_GENRES, TV_GENRES, useReleases, useReleasesLocal, type Kind, type Release } from "./store";

const ICONS: Record<Kind, typeof Film> = { movie: Film, tv: Tv, music: Music2, game: Gamepad2 };
type Filter = "all" | Kind | "following";

export function ReleasesPage() {
  const { kinds, genres, follows } = useReleases();
  const { items, checkedAt, errors, fresh } = useReleasesLocal();
  const [filter, setFilter] = useState<Filter>("all");
  const [checking, setChecking] = useState(false);
  const [setup, setSetup] = useState(false);
  const picked = (Object.keys(kinds) as Kind[]).some((k) => kinds[k] && genres[k].length);

  const check = async () => {
    setChecking(true);
    try {
      await checkReleases({ quiet: true });
    } finally {
      setChecking(false);
    }
  };

  // First visit with genres but nothing fetched yet: look right away.
  useEffect(() => {
    if (picked && checkedAt === null) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  const today = dayKey(new Date());
  const shown = useMemo(() => {
    const list = filter === "following" ? Object.values(follows) : items.filter((i) => kinds[i.kind] && (filter === "all" || i.kind === filter));
    return [...new Map(list.map((i) => [i.id, i])).values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [items, follows, filter, kinds]);
  const recent = shown.filter((i) => i.date < today).reverse();
  const upcoming = shown.filter((i) => i.date >= today);
  const problems = (Object.entries(errors) as [Kind, string][]).filter(([k]) => kinds[k] && (filter === "all" || filter === k));
  const freshSet = new Set(fresh);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Releases"
        title="Releases"
        actions={
          <>
            {picked && (
              <Button onClick={check} disabled={checking}>
                <RotateCw className={cn("size-4", checking && "animate-spin")} /> {checking ? "Checking…" : "Check now"}
              </Button>
            )}
            <Button variant={picked ? undefined : "primary"} onClick={() => setSetup(true)}>
              <SlidersHorizontal className="size-4" /> Your genres
            </Button>
          </>
        }
      />

      {!picked ? (
        <Card>
          <EmptyState
            icon={<Clapperboard className="size-5" />}
            title="Never miss what you'd love"
            body="Pick your favourite genres of movies, TV shows, music and games. Haven checks every day and tells you when something new is announced — and on the day the things you follow come out."
            action={
              <Button variant="primary" onClick={() => setSetup(true)}>
                <SlidersHorizontal className="size-4" /> Pick your genres
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <Segmented<Filter>
              layoutId="release-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                ...(Object.keys(KINDS) as Kind[]).filter((k) => kinds[k] && genres[k].length).map((k) => ({ value: k as Filter, label: <span className="whitespace-nowrap">{KINDS[k].plural}</span> })),
                { value: "following", label: <span className="whitespace-nowrap">Following{Object.keys(follows).length ? ` · ${Object.keys(follows).length}` : ""}</span> },
              ]}
              className="min-w-max"
            />
          </div>

          {problems.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-2xl bg-note-soft px-4 py-3 text-[13px] text-note">
              {problems.map(([k, message]) => (
                <div key={k} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="font-medium">{KINDS[k].plural}:</span> {message}
                  </span>
                </div>
              ))}
            </div>
          )}

          {upcoming.length === 0 && recent.length === 0 ? (
            <Card>
              <EmptyState
                icon={filter === "following" ? <Bell className="size-5" /> : <Clapperboard className="size-5" />}
                title={checking || checkedAt === null ? "Looking for releases…" : filter === "following" ? "You're not following anything yet" : "Nothing found"}
                body={
                  filter === "following"
                    ? "Tap the bell on a release to be reminded on the day it comes out."
                    : checking || checkedAt === null
                      ? undefined
                      : "Nothing in these genres in the coming four months. Try adding a genre or two."
                }
              />
            </Card>
          ) : (
            <>
              {upcoming.length > 0 && <Timeline items={upcoming} fresh={freshSet} />}
              {recent.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Out recently</h2>
                  <Grid items={recent} fresh={freshSet} />
                </section>
              )}
            </>
          )}

          {checkedAt && (
            <p className="text-center text-[12px] leading-relaxed text-faint">
              Checked {formatDistanceToNowStrict(checkedAt, { addSuffix: true })} · Haven checks once a day and notifies you about new announcements
              {items.some((i) => (i.kind === "movie" || i.kind === "tv") && i.offers?.length) && (
                <>
                  <br />
                  Where-to-watch data by JustWatch, via TMDB
                </>
              )}
            </p>
          )}
        </>
      )}

      <SetupDialog
        open={setup}
        onClose={() => {
          setSetup(false);
          void check();
        }}
      />
    </div>
  );
}

/* ---------- Lists ---------- */

/** Groups coming releases into "This week", "Next week", then by month. */
function Timeline({ items, fresh }: { items: Release[]; fresh: Set<string> }) {
  const groups = useMemo(() => {
    const now = new Date();
    const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
    const nextWeek = addDays(thisWeek, 7);
    const later = addDays(thisWeek, 14);
    const out: { label: string; items: Release[] }[] = [];
    for (const i of items) {
      const d = parseDay(i.date);
      const label = d < nextWeek ? "This week" : d < later ? "Next week" : isSameMonth(d, now) ? "Later this month" : format(d, "MMMM yyyy");
      const g = out.at(-1);
      if (g?.label === label) g.items.push(i);
      else out.push({ label, items: [i] });
    }
    return out;
  }, [items]);
  return (
    <>
      {groups.map((g) => (
        <section key={g.label} className="flex flex-col gap-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{g.label}</h2>
          <Grid items={g.items} fresh={fresh} />
        </section>
      ))}
    </>
  );
}

function Grid({ items, fresh }: { items: Release[]; fresh: Set<string> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((r) => (
        <ReleaseCard key={r.id} release={r} isNew={fresh.has(r.id)} />
      ))}
    </div>
  );
}

function when(date: string) {
  const days = differenceInCalendarDays(parseDay(date), new Date());
  if (days === 0) return "Out today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return `In ${days} days · ${format(parseDay(date), "EEE")}`;
  if (days < 0 && days > -7) return `Out ${-days === 1 ? "yesterday" : `${-days} days ago`}`;
  return format(parseDay(date), days < 0 ? "MMM d" : "EEE, MMM d");
}

function ReleaseCard({ release: r, isNew }: { release: Release; isNew: boolean }) {
  const mine = useMyPlatforms();
  const links = linksFor(r, mine, dayKey(new Date()));
  const following = useReleases((s) => !!s.follows[r.id]);
  const toggleFollow = useReleases((s) => s.toggleFollow);
  const [broken, setBroken] = useState(false);
  const Icon = ICONS[r.kind];
  const square = r.kind === "music";
  return (
    <div className="group flex flex-col gap-2">
      <div className={cn("relative overflow-hidden rounded-2xl bg-sunken shadow-soft", square ? "aspect-square" : "aspect-[2/3]")}>
        {r.image && !broken ? (
          <img src={r.image} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-faint">
            <Icon className="size-7" />
            <span className="line-clamp-3 font-serif text-lg leading-tight text-muted">{r.title}</span>
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          <span className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
            <Icon className="size-3" /> {KINDS[r.kind].label}
          </span>
          {isNew && <span className="rounded-full bg-cal px-2 py-0.5 text-[11px] font-semibold text-white">New</span>}
        </div>
        <button
          onClick={() => toggleFollow(r)}
          aria-label={following ? "Stop following" : "Remind me when it's out"}
          title={following ? "Following — you'll be reminded on the day" : "Remind me when it's out"}
          className={cn(
            "absolute right-2 top-2 flex size-8 items-center justify-center rounded-full backdrop-blur transition-colors",
            following ? "bg-cal text-white" : "bg-black/55 text-white hover:bg-black/75",
          )}
        >
          {following ? <BellRing className="size-4" /> : <Bell className="size-4" />}
        </button>
      </div>
      <div className="min-w-0 px-0.5">
        <a href={r.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[14px] font-medium leading-snug hover:underline" title={r.overview}>
          {r.title}
        </a>
        {r.subtitle && <div className="truncate text-[12px] text-muted">{r.subtitle}</div>}
        <div className={cn("mt-0.5 text-[12px] font-medium", r.date === dayKey(new Date()) ? "text-cal" : "text-faint")}>{when(r.date)}</div>
        {links.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {links.slice(0, 3).map((l) => (
              <a
                key={l.platform.id}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                title={l.verified ? `Open on ${l.platform.name}` : `Search for it on ${l.platform.name}`}
                className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                {l.verified ? <MonitorPlay className="size-3" /> : <Search className="size-3" />}
                {l.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Choosing genres, and the keys the sources need ---------- */

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
        on ? "border-transparent bg-primary text-on-primary" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {on && <Check className="size-3.5" />}
      {children}
    </button>
  );
}

function SetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Kind | "platforms">("movie");
  const { kinds, genres, set, toggleGenre } = useReleases();
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Your genres"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
          <Segmented<Kind | "platforms">
            layoutId="release-setup"
            value={tab}
            onChange={setTab}
            options={[
              ...(Object.keys(KINDS) as Kind[]).map((k) => {
                const Icon = ICONS[k];
                return { value: k, label: <span className="flex items-center gap-1.5 whitespace-nowrap"><Icon className="size-3.5" /> {KINDS[k].plural}{genres[k].length ? ` · ${genres[k].length}` : ""}</span> };
              }),
              { value: "platforms" as const, label: <span className="flex items-center gap-1.5 whitespace-nowrap"><MonitorPlay className="size-3.5" /> Your platforms</span> },
            ]}
            className="min-w-max"
          />
        </div>

        {tab === "platforms" ? (
          <PlatformsTab />
        ) : (
          <>

        <div className="flex items-center justify-between gap-3">
          <div className="text-[14px] text-muted">
            {tab === "music" ? "New albums, from MusicBrainz — no key needed." : `From ${KINDS[tab].source}. Choose any number of genres.`}
          </div>
          <Switch checked={kinds[tab]} onChange={(on) => set({ kinds: { ...kinds, [tab]: on } })} label={kinds[tab] ? "On" : "Off"} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className={cn("flex flex-col gap-5", !kinds[tab] && "pointer-events-none opacity-40")}>
            {tab === "movie" && (
              <div className="flex flex-wrap gap-2">
                {MOVIE_GENRES.map(([id, name]) => (
                  <Chip key={id} on={genres.movie.includes(id)} onClick={() => toggleGenre("movie", id)}>
                    {name}
                  </Chip>
                ))}
              </div>
            )}
            {tab === "tv" && (
              <div className="flex flex-wrap gap-2">
                {TV_GENRES.map(([id, name]) => (
                  <Chip key={id} on={genres.tv.includes(id)} onClick={() => toggleGenre("tv", id)}>
                    {name}
                  </Chip>
                ))}
              </div>
            )}
            {tab === "music" && <MusicGenres />}
            {tab === "game" && <GameGenres />}
            {(tab === "movie" || tab === "tv") && <TmdbKey />}
            {tab === "game" && <IgdbKeys />}
          </motion.div>
        </AnimatePresence>
          </>
        )}
      </div>
    </Modal>
  );
}

const PLATFORM_GROUPS: [PlatformKind, string][] = [
  ["video", "Movies & TV"],
  ["music", "Music"],
  ["games", "Games"],
];

/** The services you pay for — read from Subscriptions until you change them here. */
function PlatformsTab() {
  const picked = useReleases((s) => s.platforms);
  const set = useReleases((s) => s.set);
  const subs = useSubscriptions((s) => s.subs);
  const mine = useMyPlatforms();
  const detected = fromSubscriptions(subs);
  const toggle = (id: string) => set({ platforms: mine.includes(id) ? mine.filter((p) => p !== id) : [...mine, id] });
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] text-muted">
        Releases show links to the services you pay for — included in your plan first, then to rent or buy.{" "}
        {picked === null
          ? detected.length
            ? "These come from your Subscriptions; change them here if they're not right."
            : "Add your streaming services in Subscriptions, or pick them here."
          : "You've chosen these yourself."}
      </p>
      {PLATFORM_GROUPS.map(([kind, label]) => (
        <div key={kind} className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.filter((p) => p.kind === kind).map((p) => (
              <Chip key={p.id} on={mine.includes(p.id)} onClick={() => toggle(p.id)}>
                {p.name}
              </Chip>
            ))}
          </div>
        </div>
      ))}
      {picked !== null && (
        <button onClick={() => set({ platforms: null })} className="self-start text-[13px] font-medium text-cal hover:underline">
          Use my Subscriptions instead{detected.length ? ` (${detected.map((d) => PLATFORMS.find((p) => p.id === d)?.name).join(", ")})` : ""}
        </button>
      )}
      <p className="text-[12px] leading-relaxed text-faint">
        Movies and shows: what's included, free, or to rent or buy in your country (from JustWatch, via TMDB — needs your TMDB key). Music: the album's page on Deezer and
        Apple Music; on other services, a search for it. Games: the game's page on each store.
      </p>
    </div>
  );
}

function MusicGenres() {
  const { genres, toggleGenre } = useReleases();
  const [custom, setCustom] = useState("");
  const all = [...new Set([...MUSIC_GENRES, ...genres.music])];
  const add = () => {
    const tag = custom.trim().toLowerCase();
    if (tag && !genres.music.includes(tag)) toggleGenre("music", tag);
    setCustom("");
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {all.map((g) => (
          <Chip key={g} on={genres.music.includes(g)} onClick={() => toggleGenre("music", g)}>
            {g}
          </Chip>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex gap-2"
      >
        <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Another genre, e.g. shoegaze" className="h-10 sm:w-64" />
        <Button type="submit" disabled={!custom.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

function GameGenres() {
  const { genres, toggleGenre } = useReleases();
  const { gameGenres, keys, set } = useReleasesLocal();
  const [error, setError] = useState<string | null>(null);
  const ready = !!(keys.igdbId.trim() && keys.igdbSecret.trim());

  useEffect(() => {
    if (!inApp || !ready || gameGenres.length) return;
    setError(null);
    fetchGameGenres()
      .then((list) => set({ gameGenres: list }))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ready, gameGenres.length, set]);

  if (!inApp) return <p className="text-[13px] text-muted">Games come from IGDB, which only answers the Haven apps — set them up in the Windows or Android app.</p>;
  if (!ready) return <p className="text-[13px] text-muted">Add your Twitch developer keys below, and IGDB's genres will appear here.</p>;
  if (error) return <p className="text-[13px] text-neg">{error}</p>;
  if (!gameGenres.length) return <p className="text-[13px] text-muted">Loading genres…</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {gameGenres.map((g) => (
        <Chip key={g.id} on={genres.game.includes(g.id)} onClick={() => toggleGenre("game", g.id)}>
          {g.name}
        </Chip>
      ))}
    </div>
  );
}

function KeyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} className="h-10 pr-10 font-mono text-[13px]" />
      <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? "Hide" : "Show"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-faint hover:text-ink">
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function Steps({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-sunken/50 p-4">
      <div className="mb-2 text-[13px] font-semibold">{title}</div>
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function TmdbKey() {
  const { keys, set } = useReleasesLocal();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Steps title="TMDB key (free) — for movies and TV">
      <ol className="list-decimal pl-5">
        <li>
          Create a free account at{" "}
          <a href="https://www.themoviedb.org/signup" target="_blank" rel="noreferrer" className="font-medium text-cal hover:underline">
            themoviedb.org <ExternalLink className="inline size-3" />
          </a>
          .
        </li>
        <li>
          In{" "}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="font-medium text-cal hover:underline">
            Settings → API <ExternalLink className="inline size-3" />
          </a>
          , request a key for personal use.
        </li>
        <li>Copy the “API Read Access Token” (or the shorter API key) and paste it here.</li>
      </ol>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <KeyInput value={keys.tmdb} onChange={(tmdb) => (set({ keys: { ...keys, tmdb } }), setStatus(null))} placeholder="eyJhbGciOi…" />
        </div>
        <Button
          disabled={!keys.tmdb.trim()}
          onClick={async () => {
            try {
              await testTmdb();
              setStatus({ ok: true, text: "Connected" });
            } catch (e) {
              setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
            }
          }}
        >
          Test
        </Button>
      </div>
      {status && <div className={cn("flex items-center gap-1.5", status.ok ? "text-pos" : "text-neg")}>{status.ok && <Check className="size-3.5" />} {status.text}</div>}
      <p className="text-[12px] text-faint">Saved on this device only.</p>
    </Steps>
  );
}

function IgdbKeys() {
  const { keys, set } = useReleasesLocal();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const change = (patch: Partial<typeof keys>) => {
    // New keys need a new sign-in and may unlock a different genre list.
    set({ keys: { ...keys, ...patch }, igdbToken: undefined, gameGenres: [] });
    setStatus(null);
  };
  return (
    <Steps title="Twitch developer keys (free) — for games, from IGDB">
      <ol className="list-decimal pl-5">
        <li>
          Sign in at{" "}
          <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer" className="font-medium text-cal hover:underline">
            dev.twitch.tv/console <ExternalLink className="inline size-3" />
          </a>{" "}
          (Twitch asks you to turn on two-factor sign-in first).
        </li>
        <li>
          “Register Your Application”: any name (e.g. Haven), OAuth redirect <span className="font-mono">http://localhost</span>, category “Application Integration”, client type
          “Confidential”.
        </li>
        <li>Open it, copy the Client ID, then press “New Secret” and copy the secret.</li>
      </ol>
      <div className="grid gap-2 sm:grid-cols-2">
        <KeyInput value={keys.igdbId} onChange={(igdbId) => change({ igdbId })} placeholder="Client ID" />
        <KeyInput value={keys.igdbSecret} onChange={(igdbSecret) => change({ igdbSecret })} placeholder="Client secret" />
      </div>
      {inApp && (
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={!keys.igdbId.trim() || !keys.igdbSecret.trim()}
            onClick={async () => {
              try {
                set({ gameGenres: await fetchGameGenres() });
                setStatus({ ok: true, text: "Connected" });
              } catch (e) {
                setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
              }
            }}
          >
            Test
          </Button>
          {status && <span className={cn("flex items-center gap-1.5", status.ok ? "text-pos" : "text-neg")}>{status.ok && <Check className="size-3.5" />} {status.text}</span>}
        </div>
      )}
      <p className="text-[12px] text-faint">Saved on this device only.</p>
    </Steps>
  );
}
