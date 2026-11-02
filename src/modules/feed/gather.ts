import type Anthropic from "@anthropic-ai/sdk";
import { format } from "date-fns";
import { aiReady, AiError, baseRequest, client } from "@/lib/ai";
import { todayKey } from "@/lib/dates";
import { uid } from "@/lib/utils";
import type { Edition, FeedItem, Interest } from "./store";

/**
 * Prepares the morning edition. With an API key, Claude searches the live web for each interest
 * and writes a short briefing; without one, the hottest Hacker News stories stand in (tech only).
 */
export async function gather(interests: Interest[], perInterest: number, onStep?: (s: string) => void): Promise<Edition> {
  if (!interests.length) throw new AiError("Add a few interests first.");
  const items = aiReady() ? await withClaude(interests, perInterest, onStep) : await withHackerNews(interests, perInterest, onStep);
  return { date: todayKey(), generatedAt: Date.now(), via: aiReady() ? "claude" : "hackernews", items };
}

/* ---------- Claude + web search ---------- */

const PUBLISH: Anthropic.Beta.BetaTool = {
  name: "publish_briefing",
  description: "Publish the finished morning briefing. Call exactly once, after searching, with every story you selected.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["stories"],
    properties: {
      stories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["interest_id", "title", "summary", "why_it_matters", "source", "url", "published", "lead"],
          properties: {
            interest_id: { type: "string", description: "The id of the interest this story belongs to" },
            title: { type: "string", description: "A clear, neutral headline in your own words" },
            summary: { type: "string", description: "Two or three sentences: what happened, with concrete facts" },
            why_it_matters: { type: "string", description: "One sentence on why this matters to someone following this interest" },
            source: { type: "string", description: "Publication name, e.g. Reuters" },
            url: { type: "string", description: "The article URL exactly as it appeared in your search results" },
            published: { type: "string", description: "Publication date as YYYY-MM-DD, or an empty string if unknown" },
            lead: { type: "boolean", description: "True for exactly one story: the single most important of the morning" },
          },
        },
      },
    },
  },
};

const SYSTEM = `You are the editor of a personal morning news briefing. You find what genuinely matters today for one reader, using web search.

How to work:
- Search the live web for each interest. Focus on news from the last 24 hours; extend to 48 hours only when an interest is quiet.
- Prefer original reporting from reputable outlets. Skip press releases, listicles, rumours, sponsored content and duplicates of the same event.
- Rank by significance and momentum ("what people will be talking about today"), not by recency alone.
- Write in plain, calm English. Summaries state facts; no hype, no emoji.
- Only use URLs that appeared in your search results. Never invent or guess a URL.
- When you're done, call publish_briefing once with all stories.`;

async function withClaude(interests: Interest[], perInterest: number, onStep?: (s: string) => void) {
  const c = client();
  const list = interests.map((i) => `- id: ${i.id} — ${i.name}${i.detail ? ` (${i.detail})` : ""}`).join("\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Today is ${format(new Date(), "EEEE d MMMM yyyy")}. Prepare my morning briefing with up to ${perInterest} stories for each of these interests:\n${list}\n\nMark exactly one story overall as the lead.`,
    },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: Math.min(24, interests.length * 3 + 2) },
    PUBLISH,
  ];
  const seen = new Set<string>();
  const norm = (u: string) => u.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();

  onStep?.("Searching the news…");
  for (let turn = 0; turn < 6; turn++) {
    const res = await c.beta.messages.create({
      ...baseRequest(),
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools,
      messages,
    });
    if (res.stop_reason === "refusal") throw new AiError("Claude declined to prepare this briefing. Try rewording your interests.");

    for (const block of res.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === "web_search_result") seen.add(norm(r.url));
      }
    }

    const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "publish_briefing");
    if (call) {
      onStep?.("Writing your briefing…");
      return toItems(call.input, interests, seen, norm);
    }

    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
    // A long search can pause mid-turn; resending the conversation lets it carry on.
    if (res.stop_reason === "pause_turn") {
      onStep?.("Still reading…");
      continue;
    }
    messages.push({ role: "user", content: "Please publish the briefing now with the stories you found." });
  }
  throw new AiError("The briefing took too long to prepare. Try again, or with fewer interests.");
}

type RawStory = { interest_id: string; title: string; summary: string; why_it_matters: string; source: string; url: string; published: string; lead: boolean };

function toItems(input: unknown, interests: Interest[], seen: Set<string>, norm: (u: string) => string): FeedItem[] {
  const stories = ((input as { stories?: RawStory[] })?.stories ?? []).filter((s) => s && s.title && /^https?:\/\//.test(s.url));
  const ids = new Set(interests.map((i) => i.id));
  // Drop anything whose link didn't come from an actual search result.
  const verified = seen.size ? stories.filter((s) => seen.has(norm(s.url))) : stories;
  let leadSeen = false;
  return verified
    .filter((s) => ids.has(s.interest_id))
    .map((s) => {
      const lead = s.lead && !leadSeen;
      if (lead) leadSeen = true;
      return {
        id: uid(),
        interestId: s.interest_id,
        title: s.title,
        summary: s.summary,
        why: s.why_it_matters || undefined,
        source: s.source,
        url: s.url,
        published: s.published || undefined,
        lead,
      };
    });
}

/* ---------- Free fallback: Hacker News ---------- */

type HnHit = { objectID: string; title: string; url: string | null; points: number; num_comments: number; created_at: string };

async function withHackerNews(interests: Interest[], perInterest: number, onStep?: (s: string) => void) {
  const since = Math.floor(Date.now() / 1000) - 48 * 3600;
  const out: FeedItem[] = [];
  let best: { item: FeedItem; points: number } | null = null;
  for (const i of interests) {
    onStep?.(`Looking up ${i.name}…`);
    const q = encodeURIComponent(i.name);
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${q}&tags=story&numericFilters=created_at_i>${since},points>5&hitsPerPage=30`);
    if (!res.ok) continue;
    const hits = ((await res.json()).hits as HnHit[]).filter((h) => h.url).sort((a, b) => b.points - a.points).slice(0, perInterest);
    for (const h of hits) {
      const item: FeedItem = {
        id: uid(),
        interestId: i.id,
        title: h.title,
        summary: `${h.points} points and ${h.num_comments} comments on Hacker News.`,
        source: new URL(h.url!).hostname.replace(/^www\./, ""),
        url: h.url!,
        published: h.created_at.slice(0, 10),
      };
      out.push(item);
      if (!best || h.points > best.points) best = { item, points: h.points };
    }
  }
  if (best) best.item.lead = true;
  return out;
}
