import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowUpRight, BookmarkCheck, BookmarkPlus, Check, Newspaper, Plus, RefreshCw, Settings2, Sparkles, X } from "lucide-react";
import { Button, Card, Field, Input, Modal, PageHeader, Select, Switch } from "@/components/ui";
import { aiReady, useAi } from "@/lib/ai";
import { parseDay, todayKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useNotes } from "@/modules/notes/store";
import { progress, refreshFeed } from "./scheduler";
import { SUGGESTED, useFeed, type Edition, type FeedItem, type Interest } from "./store";

function editionLabel(date: string) {
  const d = parseDay(date);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d");
}

/** Keeps an article as a note, tagged #reading so saved articles are easy to find. */
function saveToNotes(item: FeedItem) {
  return useNotes.getState().create({
    title: item.title,
    color: "orange",
    body: [`${item.source}${item.published ? ` · ${item.published}` : ""}`, "", item.summary, ...(item.why ? ["", item.why] : []), "", item.url, "", "#reading"].join("\n"),
  });
}

export function FeedPage() {
  const { interests, editions, running, error, patchItem } = useFeed();
  const hasKey = useAi((s) => !!s.apiKey.trim());
  const [date, setDate] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [editing, setEditing] = useState(false);

  // Follow progress of a run started elsewhere (e.g. the morning scheduler).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setStep(progress), 400);
    return () => clearInterval(t);
  }, [running]);

  const edition = editions.find((e) => e.date === (date ?? editions[0]?.date));
  const today = editions.some((e) => e.date === todayKey());

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={format(new Date(), "EEEE, MMMM d")}
        title={
          <>
            Your <em className="text-[#c0583f]">morning</em>
          </>
        }
        actions={
          interests.length > 0 && (
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
              <Button onClick={() => setEditing(true)}>
                <Settings2 className="size-4" /> Interests
              </Button>
              <Button
                variant="primary"
                disabled={running}
                onClick={() => {
                  setDate(null);
                  refreshFeed(setStep);
                }}
              >
                <RefreshCw className={cn("size-4", running && "animate-spin")} /> {today ? "Refresh" : "Prepare today's edition"}
              </Button>
            </>
          )
        }
      />

      {interests.length === 0 ? (
        <Onboarding onDone={() => refreshFeed(setStep)} />
      ) : (
        <>
          {!hasKey && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-[14px] shadow-soft">
              <Sparkles className="size-4 text-cal" />
              <span className="flex-1 text-muted">
                Without an AI key, your feed comes from Hacker News — great for tech, thin for everything else. Add an Anthropic API key for a briefing curated from across the web.
              </span>
              <Link to="/settings" className="text-[13px] font-medium text-cal hover:underline">
                Add a key
              </Link>
            </div>
          )}

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
            ) : edition ? (
              <motion.div key={edition.date + edition.generatedAt} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <EditionView edition={edition} interests={interests} onPatch={(id, p) => patchItem(edition.date, id, p)} />
              </motion.div>
            ) : (
              <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className="flex flex-col items-center px-6 py-16 text-center">
                  <Newspaper className="mb-4 size-8 text-faint" />
                  <div className="font-serif text-3xl">Nothing to read yet</div>
                  <p className="mt-2 max-w-md text-[14px] text-muted">Your edition will be prepared at {useFeed.getState().time} each morning while Haven is open. Or get it now.</p>
                  <Button variant="primary" className="mt-6" onClick={() => refreshFeed(setStep)}>
                    Prepare today's edition
                  </Button>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      <InterestsDialog open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}

function Preparing({ step }: { step: string }) {
  return (
    <Card className="relative overflow-hidden px-8 py-16 text-center">
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ background: "linear-gradient(110deg, transparent 30%, var(--cal-soft) 50%, transparent 70%)", backgroundSize: "200% 100%" }}
        animate={{ backgroundPositionX: ["120%", "-120%"] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
      />
      <div className="relative">
        <Newspaper className="mx-auto mb-4 size-8 text-cal" />
        <div className="font-serif text-3xl">Preparing your morning</div>
        <p className="mt-2 text-[14px] text-muted">{step || "Getting started…"}</p>
        {aiReady() && <p className="mt-1 text-[12px] text-faint">Claude is reading today's news for you — this usually takes a minute or two.</p>}
      </div>
    </Card>
  );
}

function EditionView({ edition, interests, onPatch }: { edition: Edition; interests: Interest[]; onPatch: (id: string, p: Partial<FeedItem>) => void }) {
  const lead = edition.items.find((i) => i.lead);
  const sections = useMemo(
    () =>
      interests
        .map((i) => ({ interest: i, items: edition.items.filter((it) => it.interestId === i.id && it !== lead) }))
        .filter((s) => s.items.length),
    [interests, edition, lead],
  );

  if (!edition.items.length) {
    return (
      <Card className="px-6 py-14 text-center">
        <div className="font-serif text-2xl">A quiet morning</div>
        <p className="mt-2 text-[14px] text-muted">No stories matched your interests this time. Try broader interests, or refresh later.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {lead && <LeadStory item={lead} interest={interests.find((i) => i.id === lead.interestId)} onPatch={(p) => onPatch(lead.id, p)} />}

      {sections.map(({ interest, items }) => (
        <section key={interest.id} className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2.5 px-1">
            {interest.emoji && <span className="text-[22px]">{interest.emoji}</span>}
            <span className="font-serif text-3xl">{interest.name}</span>
            <span className="ml-1 text-[13px] text-faint">{items.length}</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((it, i) => (
              <motion.div key={it.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <StoryCard item={it} onPatch={(p) => onPatch(it.id, p)} />
              </motion.div>
            ))}
          </div>
        </section>
      ))}

      <p className="text-center text-[12px] text-faint">
        Prepared {formatDistanceToNowStrict(edition.generatedAt, { addSuffix: true })} ·{" "}
        {edition.via === "claude" ? "curated by Claude from a live web search — open the source before relying on a detail" : "from Hacker News"}
      </p>
    </div>
  );
}

function Actions({ item, onPatch }: { item: FeedItem; onPatch: (p: Partial<FeedItem>) => void }) {
  return (
    <div className="flex items-center gap-1">
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onPatch({ read: true })}
        className="flex h-8 items-center gap-1.5 rounded-xl bg-primary px-3 text-[13px] font-medium text-on-primary hover:opacity-90"
      >
        Read <ArrowUpRight className="size-3.5" />
      </a>
      {item.savedPageId ? (
        <Link to={`/notes?id=${item.savedPageId}`} className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-note hover:bg-sunken">
          <BookmarkCheck className="size-4" /> Saved
        </Link>
      ) : (
        <button onClick={() => onPatch({ savedPageId: saveToNotes(item) })} className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-muted hover:bg-sunken hover:text-ink">
          <BookmarkPlus className="size-4" /> Save to Notes
        </button>
      )}
      {!item.read && (
        <button onClick={() => onPatch({ read: true })} title="Mark as read" aria-label="Mark as read" className="ml-auto rounded-xl p-2 text-faint hover:bg-sunken hover:text-ink">
          <Check className="size-4" />
        </button>
      )}
    </div>
  );
}

function Meta({ item }: { item: FeedItem }) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-medium text-muted">
      <span className="flex size-5 items-center justify-center rounded-md bg-sunken text-[10px] font-bold uppercase text-ink">{item.source.slice(0, 1)}</span>
      <span className="truncate">{item.source}</span>
      {item.published && <span className="text-faint">· {editionLabel(item.published)}</span>}
    </div>
  );
}

function LeadStory({ item, interest, onPatch }: { item: FeedItem; interest?: Interest; onPatch: (p: Partial<FeedItem>) => void }) {
  return (
    <Card className={cn("relative overflow-hidden p-7 sm:p-10", item.read && "opacity-70")}>
      <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-80 blur-3xl" style={{ background: "radial-gradient(circle, rgb(192 88 63 / 0.18), transparent 70%)" }} />
      <div className="relative max-w-3xl">
        <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#c0583f]">
          Lead story {interest && <span className="font-medium normal-case tracking-normal text-faint">· {interest.emoji} {interest.name}</span>}
        </div>
        <h2 className="font-serif text-[34px] leading-[1.1] tracking-tight sm:text-[44px]">{item.title}</h2>
        <p className="mt-4 text-[16px] leading-relaxed text-muted">{item.summary}</p>
        {item.why && <p className="mt-3 border-l-2 border-[#c0583f]/50 pl-4 text-[15px] italic text-ink">{item.why}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Meta item={item} />
          <div className="flex-1" />
          <Actions item={item} onPatch={onPatch} />
        </div>
      </div>
    </Card>
  );
}

function StoryCard({ item, onPatch }: { item: FeedItem; onPatch: (p: Partial<FeedItem>) => void }) {
  return (
    <Card className={cn("flex h-full flex-col gap-3 p-5 transition-opacity", item.read && "opacity-55")}>
      <Meta item={item} />
      <h3 className="font-serif text-[22px] leading-tight">{item.title}</h3>
      <p className="text-[14px] leading-relaxed text-muted">{item.summary}</p>
      {item.why && <p className="text-[13px] italic text-ink/80">{item.why}</p>}
      <div className="mt-auto pt-2">
        <Actions item={item} onPatch={onPatch} />
      </div>
    </Card>
  );
}

/* ---------- Interests ---------- */

function Onboarding({ onDone }: { onDone: () => void }) {
  const { interests, addInterest, removeInterest } = useFeed();
  const [custom, setCustom] = useState("");
  const chosen = new Set(interests.map((i) => i.name));
  return (
    <Card className="relative overflow-hidden p-8 sm:p-10">
      <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-70 blur-3xl" style={{ background: "radial-gradient(circle, rgb(192 88 63 / 0.18), transparent 70%)" }} />
      <div className="relative max-w-2xl">
        <h2 className="font-serif text-4xl leading-tight">What do you want to wake up to?</h2>
        <p className="mt-2 text-[15px] text-muted">Pick a few interests. Each morning Haven gathers the stories that matter for them.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {SUGGESTED.map((s) => {
            const on = chosen.has(s.name);
            return (
              <button
                key={s.name}
                onClick={() => (on ? removeInterest(interests.find((i) => i.name === s.name)!.id) : addInterest(s))}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-all",
                  on ? "border-transparent bg-primary text-on-primary" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span>{s.emoji}</span> {s.name}
              </button>
            );
          })}
        </div>
        <form
          className="mt-4 flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) addInterest({ name: custom.trim() });
            setCustom("");
          }}
        >
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Something else — e.g. Cameroon, Formula 1, Rust" />
          <Button type="submit">
            <Plus className="size-4" /> Add
          </Button>
        </form>
        {interests.some((i) => !SUGGESTED.some((s) => s.name === i.name)) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {interests
              .filter((i) => !SUGGESTED.some((s) => s.name === i.name))
              .map((i) => (
                <span key={i.id} className="flex h-9 items-center gap-1.5 rounded-full bg-primary pl-4 pr-2 text-[14px] font-medium text-on-primary">
                  {i.name}
                  <button onClick={() => removeInterest(i.id)} aria-label={`Remove ${i.name}`} className="rounded-full p-1 hover:bg-white/15">
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
          </div>
        )}
        <Button variant="primary" className="mt-8 h-11 px-6" disabled={!interests.length} onClick={onDone}>
          Prepare my first edition
        </Button>
      </div>
    </Card>
  );
}

function InterestsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { interests, addInterest, updateInterest, removeInterest, time, perInterest, auto, setPrefs } = useFeed();
  const [name, setName] = useState("");
  const unused = SUGGESTED.filter((s) => !interests.some((i) => i.name === s.name));
  return (
    <Modal open={open} onClose={onClose} title="Your interests" accent="#c0583f" footer={<><div className="flex-1" /><Button variant="primary" onClick={onClose}>Done</Button></>}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          {interests.map((i) => (
            <div key={i.id} className="flex flex-col gap-2 rounded-2xl bg-sunken/60 p-3">
              <div className="flex items-center gap-2">
                <input
                  value={i.emoji ?? ""}
                  onChange={(e) => updateInterest(i.id, { emoji: e.target.value.slice(-2) || undefined })}
                  placeholder="✦"
                  aria-label="Emoji"
                  className="h-9 w-10 rounded-lg bg-surface text-center text-lg focus:outline-none"
                />
                <Input value={i.name} onChange={(e) => updateInterest(i.id, { name: e.target.value })} className="h-9 flex-1" />
                <button onClick={() => removeInterest(i.id)} aria-label={`Remove ${i.name}`} className="rounded-lg p-2 text-faint hover:bg-surface hover:text-neg">
                  <X className="size-4" />
                </button>
              </div>
              <Input
                value={i.detail ?? ""}
                onChange={(e) => updateInterest(i.id, { detail: e.target.value || undefined })}
                placeholder="Optional focus — e.g. “European startups, skip funding rumours”"
                className="h-9 text-[13px]"
              />
            </div>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) addInterest({ name: name.trim() });
            setName("");
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add an interest" />
          <Button type="submit">
            <Plus className="size-4" /> Add
          </Button>
        </form>
        {unused.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {unused.map((s) => (
              <button key={s.name} onClick={() => addInterest(s)} className="rounded-full bg-sunken px-3 py-1.5 text-[13px] text-muted hover:text-ink">
                {s.emoji} {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-5">
          <Field label="Prepare from">{(id) => <Input id={id} type="time" value={time} onChange={(e) => e.target.value && setPrefs({ time: e.target.value })} />}</Field>
          <Field label="Stories per interest">
            {(id) => (
              <Select id={id} value={perInterest} onChange={(e) => setPrefs({ perInterest: Number(e.target.value) })}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Switch label="Prepare automatically each morning" checked={auto} onChange={(v) => setPrefs({ auto: v })} />
      </div>
    </Modal>
  );
}
