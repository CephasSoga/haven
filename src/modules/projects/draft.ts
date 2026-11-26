import { AiTooLong, askJson, tokenBudget } from "@/lib/ai";
import { todayKey } from "@/lib/dates";
import { PRIORITIES, type Priority } from "@/modules/calendar/store";
import type { TaskSpec } from "./logic";

/*
 * "Draft with AI": from a description, or a whole plan pasted in, the AI proposes the project's stages and
 * tasks (with how long each takes and what has to come first). You review it before anything is created.
 * A long plan comes in rounds, so it fits even a small per-minute allowance.
 */

export type Draft = { name: string; description: string; stages: string[]; tasks: (TaskSpec & { stage?: number })[] };

const SYSTEM = `You plan projects for one person, as an expert project manager would. From what they describe (or a plan they paste), produce the project: a short name, a one-line description, its stages in order (2–6, or none for a small project), and its tasks.

- Tasks are concrete pieces of work someone can sit down and do, each with a realistic duration in minutes (15 to 480; split anything longer).
- Give each task its stage (index into the stages, or -1 if there are none) and what must be finished before it can start ("after": indexes of earlier tasks; keep this to real dependencies).
- Order tasks the way they'll be done. Use the person's language. If they pasted a plan, keep its tasks (don't invent a different plan); add durations and order.`;

const schema = (first: boolean) => ({
  type: "object",
  additionalProperties: false,
  required: [...(first ? ["name", "description", "stages"] : []), "tasks", "more"],
  properties: {
    ...(first
      ? {
          name: { type: "string" },
          description: { type: "string" },
          stages: { type: "array", items: { type: "string" } },
        }
      : {}),
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "minutes", "stage", "after", "priority"],
        properties: {
          title: { type: "string" },
          minutes: { type: "integer" },
          stage: { type: "integer" },
          after: { type: "array", items: { type: "integer" } },
          priority: { type: "string", enum: Object.keys(PRIORITIES) },
        },
      },
    },
    more: { type: "boolean", description: "true when there are more tasks than this answer holds" },
  },
});

type Out = { name?: string; description?: string; stages?: string[]; tasks: { title: string; minutes: number; stage: number; after: number[]; priority: Priority }[]; more: boolean };

export async function draftProject(text: string, opts: { deadline?: string; onStep?: (s: string) => void; signal?: AbortSignal } = {}): Promise<Draft> {
  const small = tokenBudget() < 20000;
  let limit = small ? 10 : 40;
  const draft: Draft = { name: "", description: "", stages: [], tasks: [] };
  const context = `Today is ${todayKey()}.${opts.deadline ? ` The project is due by ${opts.deadline}.` : ""}\n\nTHE PROJECT\n${text.trim()}`;
  for (let round = 0; round < 12; round++) {
    const first = round === 0;
    const sofar = draft.tasks.map((t, i) => `${i}. ${t.title}`).join("\n");
    let out: Out;
    try {
      out = await askJson<Out>({
        name: "project_draft",
        system: SYSTEM,
        user: first
          ? `${context}\n\n(At most ${limit} tasks in this answer; set "more" if there are others.)`
          : `${context}\n\nSTAGES: ${draft.stages.map((s, i) => `${i}. ${s}`).join(", ") || "(none)"}\n\nTASKS SO FAR (indexes for "after"):\n${sofar}\n\nGive the next tasks: at most ${limit}, numbered on from ${draft.tasks.length}. Set "more" if there are still others.`,
        schema: schema(first),
        effort: "low",
        maxTokens: small ? 3000 : 12000,
        signal: opts.signal,
        timeoutMs: 120_000,
      });
    } catch (e) {
      if (e instanceof AiTooLong && limit > 2) {
        limit = Math.ceil(limit / 2);
        round--;
        continue;
      }
      if (draft.tasks.length) break;
      throw e;
    }
    if (first) {
      draft.name = out.name?.trim() || "New project";
      draft.description = out.description?.trim() ?? "";
      draft.stages = (out.stages ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    }
    const base = draft.tasks.length;
    const fresh = (out.tasks ?? []).filter((t) => t.title?.trim() && !draft.tasks.some((d) => d.title.toLowerCase() === t.title.trim().toLowerCase()));
    fresh.forEach((t, i) =>
      draft.tasks.push({
        title: t.title.trim(),
        duration: Math.min(480, Math.max(15, Math.round((t.minutes || 60) / 5) * 5)),
        priority: t.priority in PRIORITIES ? t.priority : "medium",
        stage: t.stage >= 0 && t.stage < draft.stages.length ? t.stage : undefined,
        // Only earlier tasks can come first.
        after: (t.after ?? []).filter((j) => Number.isInteger(j) && j >= 0 && j < base + i),
      }),
    );
    opts.onStep?.(`${draft.tasks.length} tasks so far`);
    if (!out.more || !fresh.length || draft.tasks.length >= 150) break;
  }
  return draft;
}
