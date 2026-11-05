import { addDays, format } from "date-fns";
import { askJson, assistantName, tokenBudget } from "@/lib/ai";
import { dayKey, monthKey, todayKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { uid } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { expandEvents, useCalendar } from "@/modules/calendar/store";
import { accountBalance, inMonth, spendByCategory, useFinance } from "@/modules/finances/store";
import { useNotes } from "@/modules/notes/store";
import { ANSWER_SCHEMA, problemWith, type Action } from "./actions";
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
- For a change to an existing event or task, give its complete new version, keeping the fields they didn't mention as they are.
- Answer questions from the data provided; say so when it isn't there. Keep replies short, warm and plain, in the language the person writes in. Don't list the proposals in the reply — they're shown separately.`;

/** How much of your data to include: all of it normally, a trimmed summary on a small per-minute allowance (Groq's free plan). */
const sizes = () =>
  tokenBudget() < 20000
    ? { past: 3, ahead: 21, transactions: 12, notes: 20, preview: 40, turns: 6, answer: 2500 }
    : { past: 14, ahead: 42, transactions: 40, notes: 80, preview: 80, turns: 12, answer: 8000 };

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

  const open = tasks.filter((t) => !t.done);
  const taskLines = open.map(
    (t) => `${t.id} | ${t.title} | ${t.duration} min | ${t.priority} | ${t.schedule}${t.deadline ? ` | due ${t.deadline}` : ""}${t.startDate ? ` | from ${t.startDate}` : ""}`,
  );

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

/** Sends a message and adds the assistant's answer (or the reason it failed) to the conversation. */
export async function send(text: string) {
  const store = useAssistant.getState();
  const history = store.messages;
  store.add({ role: "user", text });
  try {
    const answer = await askJson<{ reply: string; actions: Action[] }>({
      name: "assistant_answer",
      system: SYSTEM,
      user: [
        `YOUR DATA\n${context()}`,
        history.length ? `\nCONVERSATION SO FAR\n${conversation(history)}` : "",
        `\nTHE PERSON SAYS\n${text}`,
      ].join("\n"),
      schema: ANSWER_SCHEMA,
      effort: "medium",
      maxTokens: sizes().answer,
    });
    const proposals: Proposal[] = (answer.actions ?? []).map((action) => {
      const problem = problemWith(action);
      return { id: uid(), action, include: !problem, status: problem ? "skipped" : "pending", problem: problem ?? undefined };
    });
    useAssistant.getState().add({ role: "assistant", text: answer.reply || (proposals.length ? "Here's what I'd do:" : "Done."), proposals: proposals.length ? proposals : undefined });
  } catch (e) {
    useAssistant.getState().add({ role: "assistant", text: e instanceof Error ? e.message : String(e), error: true });
  }
}

export { assistantName };
