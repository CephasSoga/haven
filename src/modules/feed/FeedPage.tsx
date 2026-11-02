import { useEffect, useState, type ReactNode } from "react";
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowUpRight, BookmarkCheck, BookmarkPlus, Check, Layers, Newspaper, Plus, RefreshCw, Rss, Settings2, Sparkles, X } from "lucide-react";
import { Link } from "react-router";
import { Button, Card, Field, Input, Modal, PageHeader, Select, Switch } from "@/components/ui";
import { useAi } from "@/lib/ai";
import { parseDay, todayKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useNotes } from "@/modules/notes/store";
import { progress, refreshFeed } from "./scheduler";
import { hostOf, REGIONS, TOPICS, type Topic } from "./sources";
import { SUGGESTED, useFeed, type Edition, type FeedItem, type Section } from "./store";

const ACCENT = "#c0583f";

function editionLabel(date: string) {
  const d = parseDay(date);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d");
}

function ago(item: FeedItem) {
  if (item.publishedAt) return formatDistanceToNowStrict(item.publishedAt, { addSuffix: true });
  return item.published ? editionLabel(item.published) : "";
}

/** Keeps an article as a note, tagged #reading so saved articles are easy to find. */
function saveToNotes(item: FeedItem) {
  return useNotes.getState().create({
    title: item.title,
    color: "orange",
    body: [item.source, "", item.summary, ...(item.why ? ["", item.why] : []), "", item.url, "", "#reading"].filter((l, i, a) => l || a[i - 1]).join("\n"),
  });
}

export function FeedPage() {
  const { editions, running, error, patchItem, region } = useFeed();
  const [date, setDate] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [customizing, setCustomizing] = useState(false);

  // Follow a run started elsewhere (e.g. by the morning scheduler).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setStep(progress), 300);
    return () => clearInterval(t);
  }, [running]);

  const edition = editions.find((e) => e.date === (date ?? editions[0]?.date));
  const hasToday = editions.some((e) => e.date === todayKey());
  const refresh = () => {
    setDate(null);
    refreshFeed(setStep);
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={format(new Date(), "EEEE, MMMM d")}
        title={
          <>
            Your <em style={{ color: ACCENT }}>morning</em>
          </>
        }
        actions={
          editions.length > 0 && (
            <>
              {editions.length > 1 && (
                <Select value={edition?.date} onChange={(e) => setDate(e.target.value)} className="h-10 w-40 text-[14px]" aria-label="Edition">
                  {editions.map((e) => (
                    <option key={e.date} value={e.date}>
                      {editionLabel(e.date)}
                    </option>
                  ))}
                </Select>
              )}
              <Button onClick={() => setCustomizing(true)}>
                <Settings2 className="size-4" /> Customize
              </Button>
              <Button variant="primary" disabled={running} onClick={refresh}>
                <RefreshCw className={cn("size-4", running && "animate-spin")} /> {hasToday ? "Refresh" : "Today's edition"}
              </Button>
            </>
          )
        }
      />

      {error && !running && (
        <div className="flex items-center gap-3 rounded-2xl bg-neg/10 px-5 py-4 text-[14px] text-neg">
          <AlertTriangle className="size-4 shrink-0" /> {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {running ? (
          <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Preparing step={step} />
          </motion.div>
        ) : editions.length === 0 ? (
          <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Welcome onStart={refresh} />
          </motion.div>
        ) : edition ? (
          <motion.div key={edition.date + edition.generatedAt} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <EditionView edition={edition} regionLabel={REGIONS.find((r) => r.id === region)?.label} onPatch={(id, p) => patchItem(edition.date, id, p)} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <CustomizeDialog open={customizing} onClose={() => setCustomizing(false)} onApply={refresh} />
    </div>
  );
}

/* ---------- States ---------- */

function Preparing({ step }: { step: string }) {
  return (
    <Card className="relative overflow-hidden px-8 py-16 text-center">
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ background: "linear-gradient(110deg, transparent 30%, rgb(192 88 63 / 0.12) 50%, transparent 70%)", backgroundSize: "200% 100%" }}
        animate={{ backgroundPositionX: ["120%", "-120%"] }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
      />
      <div className="relative">
        <Newspaper className="mx-auto mb-4 size-8" style={{ color: ACCENT }} />
        <div className="font-serif text-3xl">Preparing your morning</div>
        <p className="mt-2 text-[14px] text-muted tabular">{step || "Getting started…"}</p>
      </div>
    </Card>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <Card className="relative overflow-hidden p-8 sm:p-10">
      <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-70 blur-3xl" style={{ background: "radial-gradient(circle, rgb(192 88 63 / 0.18), transparent 70%)" }} />
      <div className="relative">
        <h2 className="font-serif text-4xl leading-tight">What do you want to wake up to?</h2>
        <p className="mt-2 max-w-xl text-[15px] text-muted">
          Each morning Haven reads Google News, Bing News and any feeds you add, finds the stories most outlets are covering, and lays them out here. No account or key needed.
        </p>
        <div className="mt-8">
          <Preferences />
        </div>
        <Button variant="primary" className="mt-8 h-11 px-6" onClick={onStart}>
          Prepare my first edition
        </Button>
      </div>
    </Card>
  );
}

/* ---------- The edition ---------- */

function EditionView({ edition, regionLabel, onPatch }: { edition: Edition; regionLabel?: string; onPatch: (id: string, p: Partial<FeedItem>) => void }) {
  const lead = edition.items.find((i) => i.lead);
  // Older editions didn't record their sections; rebuild a plain list from the items.
  const sections: Section[] =
    edition.sections ?? [...new Set(edition.items.map((i) => i.interestId))].map((id) => ({ id, label: useFeed.getState().interests.find((x) => x.id === id)?.name ?? "Stories" }));

  if (!edition.items.length) {
    return (
      <Card className="px-6 py-14 text-center">
        <div className="font-serif text-2xl">A quiet morning</div>
        <p className="mt-2 text-[14px] text-muted">No stories came in. Check your connection, or broaden your interests, then refresh.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="-mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span>
          {edition.items.length} stories
          {edition.stats && <> · picked from {edition.stats.stories} reports by {edition.stats.outlets} outlets</>}
        </span>
        <span className="text-faint">·</span>
        <span>Prepared {formatDistanceToNowStrict(edition.generatedAt, { addSuffix: true })}</span>
        {regionLabel && (
          <>
            <span className="text-faint">·</span>
            <span>{regionLabel}</span>
          </>
        )}
      </div>

      {edition.brief && (
        <Card className="relative overflow-hidden p-6 sm:p-8">
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-cal">
            <Sparkles className="size-3.5" /> In brief
          </div>
          <p className="max-w-3xl font-serif text-[22px] leading-snug">{edition.brief}</p>
        </Card>
      )}

      {lead && <LeadStory item={lead} onPatch={(p) => onPatch(lead.id, p)} />}

      {sections.map((s) => {
        const items = edition.items.filter((i) => i.interestId === s.id && i !== lead);
        if (!items.length) return null;
        const [feature, ...rest] = items;
        return (
          <section key={s.id} className="flex flex-col gap-4">
            <h2 className="flex items-baseline gap-2.5 border-b border-line pb-3">
              {s.emoji && <span className="text-[22px]">{s.emoji}</span>}
              <span className="font-serif text-[32px] leading-none">{s.label}</span>
              <span className="ml-1 text-[13px] text-faint">{items.length}</span>
            </h2>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <FeatureStory item={feature} onPatch={(p) => onPatch(feature.id, p)} />
              <ul className="flex flex-col divide-y divide-line">
                {rest.map((it) => (
                  <li key={it.id}>
                    <CompactStory item={it} onPatch={(p) => onPatch(it.id, p)} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        );
      })}

      <p className="text-center text-[12px] text-faint">
        Gathered from Google News, Bing News{useFeed.getState().sources.length ? " and your feeds" : ""}
        {edition.via === "claude" ? " · overview written by Claude from these headlines" : ""}. Open the source before relying on a detail.
      </p>
    </div>
  );
}

/* ---------- Story pieces ---------- */

function Picture({ src, className }: { src?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cn("bg-sunken object-cover", className)} />;
}

function Coverage({ item }: { item: FeedItem }) {
  const [open, setOpen] = useState(false);
  if (!item.coverage || item.coverage < 2) return null;
  return (
    <span className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-muted hover:text-ink">
        <Layers className="size-3" /> {item.coverage} outlets
      </button>
      <AnimatePresence>
        {open && item.related?.length ? (
          <>
            <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute left-0 top-full z-40 mt-1.5 flex w-64 flex-col rounded-2xl border border-line bg-raised p-1.5 shadow-float"
            >
              <span className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Also covered by</span>
              {item.related.map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-[13px] hover:bg-sunken">
                  <span className="truncate">{r.source}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-faint" />
                </a>
              ))}
            </motion.span>
          </>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

function Meta({ item, children }: { item: FeedItem; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
      <span className="font-semibold text-ink">{item.source || hostOf(item.url)}</span>
      {ago(item) && <span>· {ago(item)}</span>}
      <Coverage item={item} />
      {children}
    </div>
  );
}

function SaveButton({ item, onPatch, compact }: { item: FeedItem; onPatch: (p: Partial<FeedItem>) => void; compact?: boolean }) {
  return item.savedPageId ? (
    <Link to={`/notes?id=${item.savedPageId}`} title="Saved to Notes" className="flex items-center gap-1.5 rounded-xl p-1.5 text-[13px] font-medium text-note hover:bg-sunken">
      <BookmarkCheck className="size-4" /> {!compact && "Saved"}
    </Link>
  ) : (
    <button onClick={() => onPatch({ savedPageId: saveToNotes(item) })} title="Save to Notes" aria-label="Save to Notes" className="flex items-center gap-1.5 rounded-xl p-1.5 text-[13px] font-medium text-muted hover:bg-sunken hover:text-ink">
      <BookmarkPlus className="size-4" /> {!compact && "Save"}
    </button>
  );
}

function Headline({ item, onPatch, className }: { item: FeedItem; onPatch: (p: Partial<FeedItem>) => void; className?: string }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => onPatch({ read: true })} className={cn("block font-serif leading-tight decoration-1 underline-offset-4 hover:underline", className)}>
      {item.title}
    </a>
  );
}

function LeadStory({ item, onPatch }: { item: FeedItem; onPatch: (p: Partial<FeedItem>) => void }) {
  return (
    <Card className={cn("relative overflow-hidden", item.read && "opacity-75")}>
      <div className={cn("grid", item.image && "xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
        {item.image && <Picture src={item.image} className="aspect-[16/9] h-full max-h-[420px] w-full xl:aspect-auto xl:max-h-none xl:min-h-[340px]" />}
        <div className="flex flex-col p-7 sm:p-9">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: ACCENT }}>
            Lead story
          </div>
          <Headline item={item} onPatch={onPatch} className="text-[32px] tracking-tight sm:text-[40px]" />
          {item.summary && <p className="mt-4 text-[16px] leading-relaxed text-muted">{item.summary}</p>}
          {item.why && <p className="mt-3 border-l-2 pl-4 text-[15px] italic" style={{ borderColor: `${ACCENT}80` }}>{item.why}</p>}
          <div className="mt-auto flex items-center justify-between gap-3 pt-6">
            <Meta item={item} />
            <SaveButton item={item} onPatch={onPatch} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function FeatureStory({ item, onPatch }: { item: FeedItem; onPatch: (p: Partial<FeedItem>) => void }) {
  return (
    <article className={cn("flex flex-col gap-3", item.read && "opacity-60")}>
      {item.image && <Picture src={item.image} className="aspect-[16/9] w-full rounded-2xl" />}
      <Headline item={item} onPatch={onPatch} className="text-[26px]" />
      {item.summary && <p className="text-[15px] leading-relaxed text-muted">{item.summary}</p>}
      {item.why && <p className="text-[14px] italic">{item.why}</p>}
      <div className="flex items-center justify-between gap-3">
        <Meta item={item} />
        <SaveButton item={item} onPatch={onPatch} compact />
      </div>
    </article>
  );
}

function CompactStory({ item, onPatch }: { item: FeedItem; onPatch: (p: Partial<FeedItem>) => void }) {
  return (
    <div className={cn("flex gap-4 py-3.5 first:pt-0", item.read && "opacity-55")}>
      <div className="min-w-0 flex-1">
        <Headline item={item} onPatch={onPatch} className="text-[18px]" />
        {item.summary && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">{item.summary}</p>}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <Meta item={item} />
          <div className="flex items-center">
            {!item.read && (
              <button onClick={() => onPatch({ read: true })} title="Mark as read" aria-label="Mark as read" className="rounded-xl p-1.5 text-faint hover:bg-sunken hover:text-ink">
                <Check className="size-4" />
              </button>
            )}
            <SaveButton item={item} onPatch={onPatch} compact />
          </div>
        </div>
      </div>
      {item.image && <Picture src={item.image} className="size-20 shrink-0 rounded-xl sm:h-20 sm:w-28" />}
    </div>
  );
}

/* ---------- Customizing ---------- */

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-all",
        on ? "border-transparent bg-primary text-on-primary" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Label({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="mb-2.5">
      <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</div>
      {hint && <div className="mt-0.5 text-[13px] text-muted">{hint}</div>}
    </div>
  );
}

/** Region, sections, interests and feeds — shared by the welcome screen and the Customize dialog. */
function Preferences() {
  const f = useFeed();
  const [name, setName] = useState("");
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const custom = f.interests;
  const unused = SUGGESTED.filter((s) => !custom.some((i) => i.name === s.name));

  return (
    <div className="flex flex-col gap-7">
      <div className="max-w-sm">
        <Label hint="Language and country of your news">Edition</Label>
        <Select value={f.region} onChange={(e) => f.setPrefs({ region: e.target.value })}>
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label>Sections</Label>
        <div className="flex flex-wrap gap-2">
          <Chip on={f.showTop} onClick={() => f.setPrefs({ showTop: !f.showTop })}>
            📰 Top stories
          </Chip>
          {(Object.keys(TOPICS) as Topic[]).map((t) => (
            <Chip key={t} on={f.topics.includes(t)} onClick={() => f.toggleTopic(t)}>
              {TOPICS[t].emoji} {TOPICS[t].label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <Label hint="Anything you follow — a team, a company, a place, a subject">Your interests</Label>
        <div className="flex flex-col gap-2">
          {custom.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-sunken/60 p-2">
              <input
                value={i.emoji ?? ""}
                onChange={(e) => f.updateInterest(i.id, { emoji: e.target.value.slice(-2) || undefined })}
                placeholder="✦"
                aria-label="Emoji"
                className="h-9 w-10 rounded-lg bg-surface text-center text-lg focus:outline-none"
              />
              <Input value={i.name} onChange={(e) => f.updateInterest(i.id, { name: e.target.value })} className="h-9 min-w-40 flex-1" />
              <Input
                value={i.detail ?? ""}
                onChange={(e) => f.updateInterest(i.id, { detail: e.target.value || undefined })}
                placeholder="Search words (optional) — e.g. Ligue 1 OR PSG"
                className="h-9 min-w-56 flex-[2] text-[13px]"
              />
              <button onClick={() => f.removeInterest(i.id)} aria-label={`Remove ${i.name}`} className="rounded-lg p-2 text-faint hover:bg-surface hover:text-neg">
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <form
          className="mt-2 flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) f.addInterest({ name: name.trim() });
            setName("");
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add an interest" className="h-10" />
          <Button type="submit">
            <Plus className="size-4" /> Add
          </Button>
        </form>
        {unused.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {unused.map((s) => (
              <button key={s.name} onClick={() => f.addInterest(s)} className="rounded-full bg-sunken px-3 py-1.5 text-[13px] text-muted hover:text-ink">
                {s.emoji} {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label hint="Any newspaper, blog or site that offers an RSS or Atom feed">Your feeds</Label>
        {f.sources.map((s) => (
          <div key={s.id} className="mb-1.5 flex items-center gap-2 rounded-xl bg-sunken/60 px-3 py-2 text-[13px]">
            <Rss className="size-4 text-faint" />
            <span className="font-medium">{s.name}</span>
            <span className="min-w-0 flex-1 truncate text-faint">{s.url}</span>
            <button onClick={() => f.removeSource(s.id)} aria-label={`Remove ${s.name}`} className="rounded-lg p-1 text-faint hover:text-neg">
              <X className="size-4" />
            </button>
          </div>
        ))}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^https?:\/\//.test(feedUrl.trim())) return;
            f.addSource({ name: feedName.trim() || hostOf(feedUrl.trim()), url: feedUrl.trim() });
            setFeedName("");
            setFeedUrl("");
          }}
        >
          <Input value={feedName} onChange={(e) => setFeedName(e.target.value)} placeholder="Name" className="h-10 w-40" />
          <Input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://… feed address" className="h-10 min-w-56 flex-1" />
          <Button type="submit">
            <Plus className="size-4" /> Add feed
          </Button>
        </form>
      </div>
    </div>
  );
}

function CustomizeDialog({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: () => void }) {
  const f = useFeed();
  const hasKey = useAi((s) => !!s.apiKey.trim());
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Customize your morning"
      accent={ACCENT}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <div className="flex-1" />
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onApply();
            }}
          >
            <RefreshCw className="size-4" /> Refresh with these settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <Preferences />
        <div className="grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
          <Field label="Prepare automatically from">{(id) => <Input id={id} type="time" value={f.time} onChange={(e) => e.target.value && f.setPrefs({ time: e.target.value })} />}</Field>
          <Field label="Stories per section">
            {(id) => (
              <Select id={id} value={f.perInterest} onChange={(e) => f.setPrefs({ perInterest: Number(e.target.value) })}>
                {[4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Switch label="Prepare a new edition automatically each morning" checked={f.auto} onChange={(v) => f.setPrefs({ auto: v })} />
        <div className="rounded-2xl border border-line p-4">
          <Switch label="Add a written overview by Claude (optional)" checked={f.aiBrief && hasKey} onChange={(v) => f.setPrefs({ aiBrief: v })} />
          <p className="mt-2 text-[13px] text-muted">
            {hasKey ? (
              "Claude reads the morning's headlines and writes a short “In brief” summary plus why the biggest stories matter. Costs a fraction of a cent per edition."
            ) : (
              <>
                Needs an Anthropic API key —{" "}
                <Link to="/settings" onClick={onClose} className="font-medium text-cal hover:underline">
                  add one in Settings
                </Link>
                . Everything else works without it.
              </>
            )}
          </p>
        </div>
      </div>
    </Modal>
  );
}
