import { addDays, format } from "date-fns";
import { create } from "zustand";
import { AiStopped, AiTooLong, askJson, assistantName, tokenBudget } from "@/lib/ai";
import { dayKey, monthKey, todayKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { uid } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { expandEvents, useCalendar } from "@/modules/calendar/store";
import { accountBalance, inMonth, spendByCategory, useFinance } from "@/modules/finances/store";
import { useNotes } from "@/modules/notes/store";
import { answerSchema, describe, problemWith, type Action } from "./actions";
import { useAssistant, type ChatMessage, type Proposal } from "./store";

/**
 * Sends your message — with the recent conversation and a summary of your calendar, tasks, money
 * and notes — to the AI chosen in Settings, and turns its answer into a reply plus proposals that
 * wait for your approval.
 */

const SYSTEM = `You are the assistant inside Haven, a personal app with a calendar (events and planned tasks), finances (accounts, categories, transactions) and notes. You help one person by answering questions about their data and by proposing changes they asked for.

- Only propose changes the person asked for, directly or clearly implied ("I spent 4500 on lunch" means: record an expense). Nothing is changed until they approve each proposal, so propose concretely and completely.
- Use ids exactly as listed. Never invent ids: to change, complete or delete something, it must be in the lists below. If you can't tell which item they mean, ask instead of guessing.
- Resolve relative dates ("tomorrow", "next Friday", "every Tuesday until Christmas") against the current date and time given. Times are 24-hour HH:mm.
- Amounts are in the person's currency as plain numbers (4500, 12.5). Expenses go in expense categories, income in income categories; pick the closest category, or "other-expense" / "other-income". When no account is named, use the first account.
- Events are fixed commitments with a time (or all day). Tasks are work the planner schedules for them, with a duration in minutes. "Remind me to call Sam" is a task, "Dinner with Sam at 8" is an event.
- Projects group related tasks toward one goal, with an optional deadline and stages (steps in order). To set one up, propose create_project with a short key (p1), then create_task for each of its tasks with "project" set to that key (or an existing project's id), "stage" to a stage name, and "after" to the titles of tasks that must be finished first. Give every task a realistic duration; split anything over 8 hours.
- For a change to an existing event or task, give its complete new version, keeping the fields they didn't mention as they are.
- Answer questions from the data provided; say so when it isn't there. Keep replies short, warm and plain, in the language the person writes in. Don't list the proposals in the reply — they're shown separately.
- Each answer holds a limited number of changes (given with the request). When more are needed (say, every task of a long plan), propose the first ones in order and set "more" to true; you'll be asked for the next ones until all are proposed.`;

/** How much of your data to include: all of it normally, a trimmed summary on a small per-minute allowance (Groq's free plan). */
const sizes = () =>
  tokenBudget() < 20000
    ? { past: 3, ahead: 21, transactions: 12, notes: 20, preview: 40, turns: 6, answer: 2500, batch: 6 }
    : { past: 14, ahead: 42, transactions: 40, notes: 80, preview: 80, turns: 12, answer: 8000, batch: 30 };

function context() {
  const size = sizes();
  const now = new Date();
  const today = todayKey();
  const { events, tasks } = useCalendar.getState();
  const { accounts, categories, transactions } = useFinance.getState();
  const { currency, weekStartsOn, name } = useSettings.getState();
  const notes = useNotes.getState().notes;
  const money = (c: number) => formatMoney(c, currency);

  // Events: the ones around now (every occurrence for the next 6 weeks), plus the series behind them.
  const days = Array.from({ length: size.past + size.ahead }, (_, i) => addDays(now, i - size.past));
  const occurrences = [...expandEvents(events, days).values()].flat();
  const seen = new Set(occurrences.map((e) => e.id));
  const eventLines = events
    .filter((e) => seen.has(e.id))
    .map((e) => {
      const repeat = e.repeat && e.repeat !== "none" ? ` | repeats ${e.repeat}${e.days?.length ? ` on days ${e.days.join(",")}` : ""}${e.until ? ` until ${e.until}` : ""}` : "";
      return `${e.id} | ${e.title} | ${e.date} | ${e.start ? `${e.start}-${e.end ?? ""}` : "all day"}${e.location ? ` | at ${e.location}` : ""}${repeat}`;
    });
  const upcoming = occurrences
    .filter((e) => e.date >= today && e.date <= dayKey(addDays(now, 14)))
    .map((e) => `${e.date} ${e.start ?? "all day"} ${e.title} (id ${e.id})`);

  const { projects } = useCalendar.getState();
  const projectName = new Map(projects.map((p) => [p.id, p]));
  const open = tasks.filter((t) => !t.done);
  const taskLines = open.map((t) => {
    const p = t.projectId ? projectName.get(t.projectId) : undefined;
    const stage = p && t.stageId ? p.stages.find((s) => s.id === t.stageId)?.name : undefined;
    return `${t.id} | ${t.title} | ${t.duration} min | ${t.priority} | ${t.schedule}${t.deadline ? ` | due ${t.deadline}` : ""}${t.startDate ? ` | from ${t.startDate}` : ""}${p ? ` | project ${p.name}${stage ? ` / ${stage}` : ""}` : ""}`;
  });
  const projectLines = projects
    .filter((p) => p.status === "active" || p.status === "paused")
    .map((p) => `${p.id} | ${p.name} | ${p.status}${p.deadline ? ` | due ${p.deadline}` : ""}${p.stages.length ? ` | stages: ${p.stages.map((s) => s.name).join(" → ")}` : ""} | ${tasks.filter((t) => t.projectId === p.id && !t.done).length} open tasks`);

  const month = inMonth(transactions, monthKey(now));
  const spend = spendByCategory(month);
  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, size.transactions);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));

  return [
    `Now: ${format(now, "EEEE d MMMM yyyy, HH:mm")} (today is ${today}; weeks start on ${weekStartsOn ? "Monday" : "Sunday"}).`,
    name && `The person's name: ${name}.`,
    `Currency: ${currency}.`,
    "",
    `EVENTS (id | title | first date | time | …):\n${eventLines.join("\n") || "(none)"}`,
    `Coming up in the next two weeks:\n${upcoming.join("\n") || "(nothing)"}`,
    "",
    `PROJECTS (id | name | status | …):\n${projectLines.join("\n") || "(none)"}`,
    `OPEN TASKS (id | title | duration | priority | hours | …):\n${taskLines.join("\n") || "(none)"}`,
    "",
    `ACCOUNTS (id | name | balance):\n${accounts.map((a) => `${a.id} | ${a.name} | ${money(accountBalance(a, transactions))}`).join("\n") || "(none)"}`,
    `CATEGORIES (id | name | kind):\n${categories.map((c) => `${c.id} | ${c.name} | ${c.kind}`).join("\n")}`,
    `This month's spending by category: ${[...spend].map(([id, c]) => `${catName.get(id) ?? id} ${money(c)}`).join(", ") || "nothing yet"}.`,
    `Latest transactions (date | kind | amount | category | account | note):\n${recent.map((t) => `${t.date} | ${t.kind} | ${money(t.amount)} | ${catName.get(t.categoryId) ?? "—"} | ${accName.get(t.accountId) ?? "—"} | ${t.note ?? ""}`).join("\n") || "(none)"}`,
    "",
    `NOTES (id | title | beginning):\n${notes
      .slice(0, size.notes)
      .map((n) => `${n.id} | ${n.title || "Untitled"} | ${n.body.replace(/\s+/g, " ").slice(0, size.preview)}`)
      .join("\n") || "(none)"}`,
  ]
    .filter((l) => typeof l === "string")
    .join("\n");
}

function conversation(history: ChatMessage[]) {
  return history
    .slice(-sizes().turns)
    .map((m) => {
      if (m.role === "user") return `Person: ${m.text}`;
      const done = (m.proposals ?? []).map((p) => `${p.action.kind} (${p.status})`).join(", ");
      return `You: ${m.text}${done ? ` [proposed: ${done}]` : ""}`;
    })
    .join("\n");
}

/** While a long answer comes in parts: how far it's got, by chat ("12 changes so far"). */
export const useProgress = create<Record<string, string>>(() => ({}));
const setProgress = (chatId: string, text: string | null) =>
  useProgress.setState((s) => {
    const next = { ...s };
    if (text) next[chatId] = text;
    else delete next[chatId];
    return next;
  }, true);

/** "New task: Draft chapter 2" — short enough to remind the AI what it already proposed. */
const brief = (a: Action) => {
  try {
    if (a.kind === "create_project" && a.project) return `New project: ${a.project.name} (key ${a.project.key}; stages: ${a.project.stages.join(", ") || "none"})`;
    const d = describe(a);
    return `${d.verb}: ${d.title}${a.task?.project ? ` (project ${a.task.project})` : ""}`.slice(0, 110);
  } catch {
    return a.kind;
  }
};

/** Most answers needed in one go, so a runaway can't go on forever. */
const MAX_ROUNDS = 15;

/** Requests in flight, by chat, so each can be stopped. */
const inFlight = new Map<string, AbortController>();

/** Stops a chat's request in progress. */
export function stop(chatId: string) {
  inFlight.get(chatId)?.abort();
}

/** Sends a message in a chat and adds the assistant's answer (or why it failed) to it. */
export async function send(chatId: string, text: string) {
  const store = useAssistant.getState();
  if (store.pending[chatId]) return;
  const history = store.chats.find((c) => c.id === chatId)?.messages ?? [];
  store.add(chatId, { role: "user", text });
  const controller = new AbortController();
  inFlight.set(chatId, controller);
  store.setPending(chatId, true);
  try {
    const base = [`YOUR DATA\n${context()}`, history.length ? `\nCONVERSATION SO FAR\n${conversation(history)}` : "", `\nTHE PERSON SAYS\n${text}`].join("\n");
    const ask = (limit: number, already: Action[]) =>
      askJson<{ reply: string; more: boolean; actions: Action[] }>({
        name: "assistant_answer",
        system: SYSTEM,
        user: already.length
          ? `${base}\n\nYOU HAVE ALREADY PROPOSED (don't repeat these):\n${already.map(brief).join("\n")}\n\nPropose the next changes: at most ${limit} this time, in order. Set "more" to true if there are still others after these. Keep "reply" empty.`
          : `${base}\n\n(At most ${limit} changes in this answer.)`,
        schema: answerSchema(),
        // A chat should answer quickly; lower effort is much faster and plenty for this.
        effort: "low",
        maxTokens: sizes().answer,
        signal: controller.signal,
        timeoutMs: 90_000,
      });
    // A long list of changes comes in parts; each answer adds the next few.
    const actions: Action[] = [];
    let reply = "";
    let limit = sizes().batch;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let answer: { reply: string; more: boolean; actions: Action[] };
      try {
        answer = await ask(limit, actions);
      } catch (e) {
        // Didn't fit: ask for fewer at a time.
        if (e instanceof AiTooLong && limit > 1) {
          limit = Math.max(1, Math.floor(limit / 2));
          round--;
          continue;
        }
        // Halfway through a long list, keep what came so far rather than lose it all.
        if (actions.length && !(e instanceof AiStopped)) {
          reply = `${reply ? `${reply}\n\n` : ""}I could only propose part of it (${e instanceof Error ? e.message : String(e)}). Approve these, then ask me for the rest.`;
          break;
        }
        throw e;
      }
      if (round === 0) reply = answer.reply;
      const fresh = (answer.actions ?? []).filter((a) => !actions.some((b) => JSON.stringify(b) === JSON.stringify(a)));
      actions.push(...fresh);
      if (!answer.more || !fresh.length) break;
      setProgress(chatId, `${actions.length} change${actions.length > 1 ? "s" : ""} so far`);
    }
    const proposals: Proposal[] = actions.map((action) => {
      const problem = problemWith(action, actions);
      return { id: uid(), action, include: !problem, status: problem ? "skipped" : "pending", problem: problem ?? undefined };
    });
    useAssistant.getState().add(chatId, { role: "assistant", text: reply || (proposals.length ? "Here's what I'd do:" : "Done."), proposals: proposals.length ? proposals : undefined });
  } catch (e) {
    useAssistant.getState().add(chatId, { role: "assistant", text: e instanceof AiStopped ? "Stopped — nothing was changed." : e instanceof Error ? e.message : String(e), error: true });
  } finally {
    inFlight.delete(chatId);
    setProgress(chatId, null);
    useAssistant.getState().setPending(chatId, false);
  }
}

export { assistantName };
