import { askJson } from "@/lib/ai";
import { fold, KINDS, searchMit, searchOpenStax, searchOpenTextbooks, searchTed, searchWikibooks, SOURCES, type Found, type Lang } from "./sources";
import { LEVELS, type Goal } from "./store";

/*
 * "Plan it for me": the AI suggests what to search for and the milestones that mark progress, Haven searches
 * the real sources, and the AI then picks and orders from what was actually found. It never makes up links.
 */

export type Suggestion = {
  objectives: string[];
  picks: { found: Found; why: string }[];
  advice: string;
};

const goalText = (g: Goal) =>
  [
    `Goal: ${g.title}`,
    g.why && `Why / what they want to be able to do: ${g.why}`,
    `Topic: ${g.topic}`,
    `Level now: ${LEVELS[g.level]}`,
    g.targetDate && `Target date: ${g.targetDate} (today is ${new Date().toISOString().slice(0, 10)})`,
    `Time available: about ${Math.round(g.weeklyMinutes / 60)} hours a week`,
  ]
    .filter(Boolean)
    .join("\n");

const SEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["queries", "objectives"],
  properties: {
    queries: { type: "array", items: { type: "string" }, description: "2 or 3 short search phrases in English, 1–4 words each" },
    objectives: { type: "array", items: { type: "string" }, description: "3 to 6 concrete milestones, in order" },
  },
};

const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks", "advice"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "why"],
        properties: { number: { type: "integer" }, why: { type: "string", description: "One short sentence" } },
      },
    },
    advice: { type: "string", description: "Two or three sentences on how to go about it" },
  },
};

export async function suggestPlan(goal: Goal, lang: Lang, onStep?: (s: string) => void): Promise<Suggestion> {
  const language = lang === "fr" ? "French" : "English";
  onStep?.("Working out what to look for");
  const { queries, objectives } = await askJson<{ queries: string[]; objectives: string[] }>({
    name: "learning_search",
    system: `You help someone plan self-study with free online material (MIT OpenCourseWare, TED talks, open textbooks, Wikibooks).
Give 2–3 short English search phrases that will find good material for their goal at their level, and 3–6 concrete, checkable milestones in order (written in ${language}, each under 15 words, starting with a verb).`,
    user: goalText(goal),
    schema: SEARCH_SCHEMA,
    effort: "low",
    maxTokens: 1500,
  });

  onStep?.("Searching MIT, TED and open textbooks");
  const phrases = [...new Set([...queries.slice(0, 3), goal.topic].map((q) => q.trim()).filter(Boolean))];
  const english = (n: number) => (n < queries.length ? "en" : lang);
  // What to ask each source for, best first: whole MIT courses, then MIT lectures, talks and books.
  const asks: { rank: number; take: number; run: () => Promise<Found[]> }[] = phrases.flatMap((q, n) => [
    { rank: 0, take: 4, run: () => searchMit(q, ["course"], 6) },
    { rank: 1, take: 4, run: () => searchMit(q, ["video", "podcast"], 6) },
    { rank: 2, take: 2, run: () => searchTed(q, lang, 3) },
    { rank: 3, take: 2, run: () => (english(n) === "en" ? searchOpenStax(q) : Promise.resolve([])) },
    { rank: 4, take: 2, run: () => searchOpenTextbooks(q, english(n)) },
    { rank: 5, take: 2, run: () => searchWikibooks(q, english(n)) },
  ]);
  const lists = await Promise.all(asks.map(async (a) => ({ ...a, found: (await a.run().catch(() => [] as Found[])).slice(0, a.take) })));
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const { found: list } of lists.sort((a, b) => a.rank - b.rank))
    for (const f of list) {
      const key = fold(f.title);
      if (seen.has(f.id) || seen.has(key)) continue;
      seen.add(f.id);
      seen.add(key);
      found.push(f);
    }
  if (!found.length) return { objectives, picks: [], advice: "" };
  const candidates = found.slice(0, 32);

  onStep?.("Choosing and ordering the best of it");
  const list = candidates
    .map((f, i) => `${i + 1}. [${KINDS[f.kind].label}, ${SOURCES[f.source].short}${f.minutes ? `, ${f.minutes} min` : ""}] ${f.title}${f.by ? ` — ${f.by}` : ""}`)
    .join("\n");
  const { picks, advice } = await askJson<{ picks: { number: number; why: string }[]; advice: string }>({
    name: "learning_plan",
    system: `You build a study plan from a list of free material that was actually found. Pick only from the numbered list (never invent anything), 4–10 items that fit the goal, level and time available, in the order to study them: foundations first. Prefer whole courses and textbooks for depth, talks and videos for motivation or a first look. Skip anything off-topic. Write "why" and "advice" in ${language}.`,
    user: `${goalText(goal)}\n\nMilestones: ${objectives.join("; ")}\n\nFound:\n${list}`,
    schema: PICK_SCHEMA,
    effort: "low",
    maxTokens: 2500,
  });
  const chosen = new Set<number>();
  return {
    objectives,
    advice,
    picks: picks
      .filter((p) => Number.isInteger(p.number) && p.number >= 1 && p.number <= candidates.length && !chosen.has(p.number) && chosen.add(p.number))
      .map((p) => ({ found: candidates[p.number - 1], why: p.why })),
  };
}
