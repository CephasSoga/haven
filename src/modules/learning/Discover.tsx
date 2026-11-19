import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Link2, Loader2, Search } from "lucide-react";
import { Button, Card, Input, Segmented } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ELSEWHERE, fromLink, LearnError, loadTed, overview, searchesFor, SOURCES, tedReady, type Found, type Kind, type Lang, type Overview, type SourceId } from "./sources";
import { useLearning } from "./store";
import { ResultRow } from "./parts";

type Filter = "all" | "course" | "watch" | "book" | "podcast";
const FILTERS: { value: Filter; label: string; kinds: Kind[] }[] = [
  { value: "all", label: "All", kinds: [] },
  { value: "course", label: "Courses", kinds: ["course"] },
  { value: "watch", label: "Videos & talks", kinds: ["video", "talk"] },
  { value: "book", label: "Books", kinds: ["book"] },
  { value: "podcast", label: "Podcasts", kinds: ["podcast"] },
];

const IDEAS = ["Linear algebra", "Machine learning", "Statistics", "Algorithms", "Philosophy", "Climate change", "Psychology", "Public speaking"];

type Section = { source: SourceId; state: "loading" | "done" | "error"; items: Found[]; error?: string };

/** Searching the free sources. With a goal, what's found goes straight into its plan. */
export function Discover({ goalId, initial }: { goalId?: string; initial?: string }) {
  const lang = useLearning((s) => s.lang);
  const setLang = useLearning((s) => s.setLang);
  const recent = useLearning((s) => s.recent);
  const remember = useLearning((s) => s.remember);
  const [q, setQ] = useState(initial ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [searched, setSearched] = useState<{ q: string; lang: Lang; filter: Filter } | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [about, setAbout] = useState<Overview | null>(null);
  const [tedProgress, setTedProgress] = useState<string | null>(null);
  const run = useRef(0);

  const search = (text = q, l = lang, f = filter) => {
    const query = text.trim();
    if (!query) return;
    setQ(query);
    remember(query);
    setSearched({ q: query, lang: l, filter: f });
  };

  useEffect(() => {
    if (initial?.trim()) search(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!searched) return;
    const me = ++run.current;
    const kinds = FILTERS.find((x) => x.value === searched.filter)!.kinds;
    const list = searchesFor(searched.q, searched.lang, kinds);
    setSections(list.map((s) => ({ source: s.source, state: "loading", items: [] })));
    setAbout(null);
    const patch = (source: SourceId, p: Partial<Section>) => me === run.current && setSections((all) => all.map((s) => (s.source === source ? { ...s, ...p } : s)));
    // TED's list comes down once; say so while it does.
    if (list.some((s) => s.source === "ted") && !tedReady())
      void loadTed((done, of) => me === run.current && setTedProgress(`Getting TED's list of talks, first time only (${done} of ${of})`))
        .catch(() => undefined)
        .finally(() => setTedProgress(null));
    for (const s of list)
      s.run().then(
        (items) => patch(s.source, { state: "done", items }),
        (e) => patch(s.source, { state: "error", error: e instanceof LearnError ? e.message : `Couldn't search ${SOURCES[s.source].name}.` }),
      );
    if (searched.filter === "all") overview(searched.q, searched.lang).then((o) => me === run.current && setAbout(o), () => undefined);
  }, [searched]);

  const shown = sections.filter((s) => s.state !== "done" || s.items.length);
  const nothing = searched && sections.length > 0 && sections.every((s) => s.state !== "loading") && !sections.some((s) => s.items.length);

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="A topic: linear algebra, stoicism, Python, climate…" className="pl-10" autoFocus={!initial} />
          </div>
          <Button type="submit" variant="primary" disabled={!q.trim()}>
            Search
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setFilter(f.value);
                if (searched) search(searched.q, lang, f.value);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                filter === f.value ? "border-ink bg-ink text-canvas" : "border-line text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <Segmented<Lang>
            layoutId={`learn-lang-${goalId ?? "all"}`}
            value={lang}
            onChange={(l) => {
              setLang(l);
              if (searched) search(searched.q, l, filter);
            }}
            options={[
              { value: "en", label: "English" },
              { value: "fr", label: "Français" },
            ]}
          />
        </div>
      </form>

      {!searched && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-muted">{recent.length ? "Recent searches" : "Ideas"}</span>
          <div className="flex flex-wrap gap-2">
            {(recent.length ? recent : IDEAS).map((r) => (
              <button key={r} onClick={() => search(r)} className="rounded-full border border-line px-3 py-1.5 text-[13px] hover:border-line-strong">
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {about && (
        <div className="flex gap-4 rounded-2xl bg-sunken p-4">
          {about.image && <img src={about.image} alt="" className="size-16 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" />}
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-muted">Wikipedia · {about.title}</div>
            <p className="mt-1 line-clamp-5 text-[14px] leading-relaxed">{about.extract}</p>
            <a href={about.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium hover:underline">
              Read the article <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </div>
      )}

      {tedProgress && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="size-4 animate-spin" /> {tedProgress}
        </p>
      )}

      {shown.map((s) => (
        <section key={s.source} className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[13px] font-semibold" style={{ color: SOURCES[s.source].color }}>
              {SOURCES[s.source].name}
            </h3>
            {s.state === "loading" && <Loader2 className="size-4 animate-spin text-faint" />}
          </div>
          {s.state === "error" && <p className="px-1 text-[13px] text-neg">{s.error}</p>}
          {s.items.length > 0 && (
            <ul className="flex flex-col">
              {s.items.map((f) => (
                <ResultRow key={f.id} found={f} goalId={goalId} />
              ))}
            </ul>
          )}
        </section>
      ))}

      {nothing && <p className="text-[14px] text-muted">Nothing found in the open catalogues. Try other words, English, or one of the sites below.</p>}

      {searched && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="text-[13px] text-muted">Search “{searched.q}” on other free platforms (opens in your browser)</span>
          <div className="flex flex-wrap gap-2">
            {ELSEWHERE.filter((e) => e.name !== "FUN MOOC" || searched.lang === "fr").map((e) => (
              <a
                key={e.name}
                href={e.url(searched.q, searched.lang)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[13px] hover:border-line-strong"
              >
                {e.name} <ArrowUpRight className="size-3.5 text-faint" />
              </a>
            ))}
          </div>
        </div>
      )}

      <AddLink goalId={goalId} />
    </div>
  );
}

/** Anything else: paste its address. */
function AddLink({ goalId }: { goalId?: string }) {
  const add = useLearning((s) => s.add);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [done, setDone] = useState(false);
  const valid = /^https?:\/\/\S+\.\S+/.test(url.trim());
  return (
    <Card className="p-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          add(fromLink(url.trim(), title), goalId);
          setUrl("");
          setTitle("");
          setDone(true);
          setTimeout(() => setDone(false), 2500);
        }}
      >
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <Link2 className="size-4 text-muted" /> Found something elsewhere? Add its link
        </span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="sm:flex-[3]" />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="sm:flex-[2]" />
          <Button type="submit" disabled={!valid} className={cn(done && "text-pos")}>
            {done ? "Added" : goalId ? "Add to plan" : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
