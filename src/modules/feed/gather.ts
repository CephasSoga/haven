import { format } from "date-fns";
import { AiError, aiReady, askJson, assistantName } from "@/lib/ai";
import { todayKey } from "@/lib/dates";
import { uid } from "@/lib/utils";
import { fetchFeed, REGIONS, TOPICS, urls, type Candidate, type Region, type Topic } from "./sources";
import type { CustomSource, Edition, FeedItem, Interest, Section } from "./store";

/**
 * Builds the morning edition without any API key:
 *  1. fetch every section's feeds (Google News + Bing News + your own feeds) in parallel,
 *  2. merge reports of the same story from different outlets,
 *  3. rank stories by how widely they're covered, how prominently, and how recently,
 *  4. optionally ask Claude for a short written overview.
 */

type Plan = { section: Section; feeds: string[] };

// Bing has no topic feeds; these localised searches stand in for them (and bring images).
const TOPIC_WORDS: Record<string, Partial<Record<Topic, string>>> = {
  en: { WORLD: "world news", BUSINESS: "business", TECHNOLOGY: "technology", SCIENCE: "science", HEALTH: "health", SPORTS: "sports", ENTERTAINMENT: "entertainment" },
  fr: { WORLD: "actualité internationale", BUSINESS: "économie", TECHNOLOGY: "technologie", SCIENCE: "science", HEALTH: "santé", SPORTS: "sport", ENTERTAINMENT: "culture" },
  de: { WORLD: "Weltnachrichten", BUSINESS: "Wirtschaft", TECHNOLOGY: "Technologie", SCIENCE: "Wissenschaft", HEALTH: "Gesundheit", SPORTS: "Sport", ENTERTAINMENT: "Kultur" },
  es: { WORLD: "internacional", BUSINESS: "economía", TECHNOLOGY: "tecnología", SCIENCE: "ciencia", HEALTH: "salud", SPORTS: "deportes", ENTERTAINMENT: "cultura" },
};

function plan(opts: { region: Region; showTop: boolean; topics: Topic[]; interests: Interest[]; sources: CustomSource[] }): Plan[] {
  const { region: r } = opts;
  const words = TOPIC_WORDS[r.hl.slice(0, 2)] ?? TOPIC_WORDS.en;
  const out: Plan[] = [];
  if (opts.showTop) out.push({ section: { id: "top", label: "Top stories", emoji: "📰" }, feeds: [urls.googleTop(r), urls.bingTop(r)] });
  for (const i of opts.interests) {
    const q = i.detail?.trim() || i.name;
    out.push({ section: { id: i.id, label: i.name, emoji: i.emoji }, feeds: [urls.googleSearch(q, r), urls.bingSearch(q, r)] });
  }
  for (const t of opts.topics) {
    const feeds = [urls.googleTopic(t, r)];
    if (words[t]) feeds.push(urls.bingSearch(words[t]!, r));
    out.push({ section: { id: `topic:${t}`, label: TOPICS[t].label, emoji: TOPICS[t].emoji }, feeds });
  }
  for (const s of opts.sources) out.push({ section: { id: `src:${s.id}`, label: s.name, emoji: "📰" }, feeds: [s.url] });
  return out;
}

/* ---------- Same story, different outlets ---------- */

const STOP = new Set(
  (
    "the a an and or but of to in on at for with from by as is are was were be been has have had will would can could after before over under about into than this that these those it its his her their our your not new says say said how why what who when where which more most up out off amid via vs " +
    "le la les un une des du de et ou mais en au aux sur pour par avec dans est sont a ont été sera plus ce cette ces son sa ses leur leurs qui que quoi dont où pas ne il elle ils elles nous vous après avant selon face contre " +
    "der die das ein eine und oder aber von zu im in am auf für mit aus bei ist sind war nicht wie was wer nach vor über " +
    "el la los las un una y o pero de del en al por para con es son fue no como qué quién tras ante sobre"
  ).split(" "),
);

export function tokens(title: string) {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function similar(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= 2 && shared / Math.min(a.size, b.size) >= 0.5;
}

type Story = { members: Candidate[]; words: Set<string>; score: number };

export function cluster(cands: Candidate[], now = Date.now()): Story[] {
  const stories: Story[] = [];
  for (const c of [...cands].sort((a, b) => a.rank - b.rank)) {
    const words = tokens(c.title);
    if (words.size < 2) continue;
    const home = stories.find((s) => similar(s.words, words));
    if (home) {
      home.members.push(c, ...(c.group ?? []));
      for (const w of words) home.words.add(w);
    } else stories.push({ members: [c, ...(c.group ?? [])], words: new Set(words), score: 0 });
  }
  for (const s of stories) {
    const outlets = new Set(s.members.map((m) => m.source.toLowerCase())).size;
    const prominence = s.members.reduce((sum, m) => sum + 1 / (1 + m.rank / 8), 0);
    const newest = Math.max(...s.members.map((m) => m.published ?? 0));
    const hours = newest ? (now - newest) / 3_600_000 : 24;
    const recency = hours < 3 ? 3 : hours < 8 ? 2 : hours < 16 ? 1 : hours < 30 ? 0.3 : 0;
    const hasImage = s.members.some((m) => m.image) ? 0.5 : 0;
    s.score = outlets * 3 + prominence * 2 + recency + hasImage;
  }
  return stories.sort((a, b) => b.score - a.score);
}

function toItem(s: Story, sectionId: string): FeedItem {
  // Headline from the most prominent report; image and summary from whichever report has them.
  const byRank = [...s.members].sort((a, b) => a.rank - b.rank);
  const head = byRank[0];
  const rich = s.members.find((m) => m.image && m.snippet) ?? s.members.find((m) => m.snippet) ?? head;
  // Prefer a direct publisher link over Google's redirect.
  const direct = s.members.find((m) => !/news\.google\./.test(m.url)) ?? head;
  const outlets = new Map<string, Candidate>();
  for (const m of byRank) if (!outlets.has(m.source.toLowerCase())) outlets.set(m.source.toLowerCase(), m);
  const newest = Math.max(...s.members.map((m) => m.published ?? 0));
  return {
    id: uid(),
    interestId: sectionId,
    title: head.title,
    summary: rich.snippet ?? "",
    source: direct.source,
    url: direct.url,
    publishedAt: newest || undefined,
    image: s.members.find((m) => m.image)?.image,
    coverage: outlets.size,
    related: [...outlets.values()].filter((m) => m.source !== direct.source).slice(0, 5).map((m) => ({ source: m.source, url: m.url })),
  };
}

/* ---------- Putting it together ---------- */

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function gather(
  opts: { region: string; showTop: boolean; topics: Topic[]; interests: Interest[]; sources: CustomSource[]; perInterest: number; aiBrief: boolean },
  onStep?: (s: string) => void,
): Promise<Edition> {
  const region = REGIONS.find((r) => r.id === opts.region) ?? REGIONS[0];
  const plans = plan({ ...opts, region });
  if (!plans.length) throw new AiError("Choose at least one section or interest first.");

  const jobs = plans.flatMap((p, pi) => p.feeds.map((url) => ({ pi, url })));
  let done = 0;
  let missingProxy = false;
  onStep?.(`Reading ${jobs.length} news feeds…`);
  const results = await pool(jobs, 6, async (j) => {
    try {
      return await fetchFeed(j.url);
    } catch (e) {
      if (e instanceof Error && e.message === "NO_PROXY") missingProxy = true;
      return [] as Candidate[];
    } finally {
      onStep?.(`Reading news feeds… ${++done} of ${jobs.length}`);
    }
  });
  if (missingProxy && results.every((r) => !r.length))
    throw new AiError("The news fetcher isn't running. Start Haven with “npm run dev” (or “npm run preview”) and open it from there.");
  if (results.every((r) => !r.length)) throw new AiError("No news could be fetched. Check your internet connection and try again.");

  onStep?.("Finding the stories everyone is covering…");
  const cutoff = Date.now() - 48 * 3_600_000;
  const perSection = plans.map((p, pi) => {
    const cands = jobs.flatMap((j, ji) => (j.pi === pi ? results[ji] : [])).filter((c) => !c.published || c.published >= cutoff);
    return { plan: p, stories: cluster(cands) };
  });

  // A story appears once: in the first section that has it.
  const placed: Set<string>[] = [];
  const items: FeedItem[] = [];
  let leadScore = -1;
  let lead: FeedItem | null = null;
  for (const { plan: p, stories } of perSection) {
    const take = p.section.id === "top" ? opts.perInterest + 2 : opts.perInterest;
    let n = 0;
    for (const s of stories) {
      if (n >= take) break;
      if (placed.some((w) => similar(w, s.words))) continue;
      placed.push(s.words);
      const item = toItem(s, p.section.id);
      items.push(item);
      n++;
      if (s.score > leadScore && (p.section.id === "top" || !opts.showTop)) (leadScore = s.score), (lead = item);
    }
  }
  if (!lead && items.length) lead = items[0];
  if (lead) lead.lead = true;

  onStep?.("Adding pictures and summaries…");
  await enrich(items, region);

  const all = results.flat();
  const edition: Edition = {
    date: todayKey(),
    generatedAt: Date.now(),
    via: "news",
    items,
    sections: plans.map((p) => p.section),
    stats: { stories: all.length, outlets: new Set(all.map((c) => c.source.toLowerCase())).size },
  };

  if (opts.aiBrief && aiReady() && items.length) {
    onStep?.("Writing your briefing…");
    try {
      Object.assign(edition, await brief(edition));
    } catch {
      /* the edition is still useful without the written overview */
    }
  }
  return edition;
}

/**
 * Google gives breadth but no pictures or summaries. For the stories you'll see first, look the
 * headline up on Bing News and borrow its image, summary and direct publisher link.
 */
async function enrich(items: FeedItem[], region: Region) {
  const seen = new Map<string, number>();
  const first = items.filter((i) => {
    const n = (seen.get(i.interestId) ?? 0) + 1;
    seen.set(i.interestId, n);
    return (i.lead || n <= 4) && (!i.image || !i.summary);
  });
  await pool(first.slice(0, 40), 6, async (item) => {
    const results = await fetchFeed(urls.bingSearch(item.title.slice(0, 140), region)).catch(() => [] as Candidate[]);
    const words = tokens(item.title);
    const match = results.find((r) => similar(tokens(r.title), words));
    if (!match) return;
    item.image ??= match.image;
    if (!item.summary && match.snippet) item.summary = match.snippet;
    if (/news\.google\./.test(item.url) && !/news\.google\./.test(match.url)) {
      item.url = match.url;
      item.source = match.source;
    }
    if (match.source !== item.source && !item.related?.some((r) => r.source === match.source)) item.related = [...(item.related ?? []), { source: match.source, url: match.url }];
  });
}

/* ---------- Optional: a written overview by Claude ---------- */

async function brief(edition: Edition): Promise<Partial<Edition>> {
  const label = new Map((edition.sections ?? []).map((s) => [s.id, s.label]));
  const top = [...edition.items].sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0)).slice(0, 30);
  const parsed = await askJson<{ brief: string; why: { id: string; why: string }[] }>({
    name: "morning_brief",
    system: "You write a calm, factual morning news overview for one reader, using only the headlines and summaries provided — never add facts that aren't in them. Write in the language most of the headlines are in.",
    user: [
      `Today is ${format(new Date(), "EEEE d MMMM yyyy")}. Headlines (id | section | outlets covering | headline — summary):`,
      ...top.map((i) => `${i.id} | ${label.get(i.interestId) ?? ""} | ${i.coverage ?? 1} | ${i.title}${i.summary ? ` — ${i.summary}` : ""}`),
      "",
      "Write the overview, and a 'why it matters' sentence for the 8 most significant stories.",
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["brief", "why"],
      properties: {
        brief: { type: "string", description: "3-5 sentence overview of this morning's news, most important first" },
        why: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "why"],
            properties: { id: { type: "string" }, why: { type: "string", description: "One sentence: why this matters" } },
          },
        },
      },
    },
    effort: "low",
    maxTokens: 4000,
  });
  const why = new Map(parsed.why.map((w) => [w.id, w.why]));
  return { brief: parsed.brief, items: edition.items.map((i) => (why.has(i.id) ? { ...i, why: why.get(i.id) } : i)), via: "claude", writer: assistantName() };
}
