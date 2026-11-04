import { format } from "date-fns";
import { formatMoney } from "@/lib/money";
import { parseDay, todayKey } from "@/lib/dates";
import { useSettings } from "@/store/settings";
import { PRIORITIES, repeatSummary, TASK_TYPES, timeRange, useCalendar, type CalendarEvent, type EventDraft, type Priority, type Repeat, type Task } from "@/modules/calendar/store";
import { TRANSFER, useFinance, type Transaction } from "@/modules/finances/store";
import { useNotes, type Note } from "@/modules/notes/store";

/**
 * What the assistant can do. The AI only *proposes* these; each is checked against your data,
 * described in plain words from the data itself (not the AI's own wording), and applied only once
 * you approve it — with an undo that puts back exactly what changed.
 */

export const KINDS = [
  "create_event",
  "update_event",
  "delete_event",
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "add_transaction",
  "create_note",
  "append_note",
] as const;
export type ActionKind = (typeof KINDS)[number];

type EventFields = {
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  location: string | null;
  notes: string | null;
  repeat: Repeat;
  days: number[] | null;
  until: string | null;
};
type TaskFields = {
  title: string;
  duration_minutes: number;
  priority: Priority;
  type: string;
  schedule: "work" | "personal";
  deadline: string | null;
  start_date: string | null;
  notes: string | null;
};
type TxFields = {
  kind: "expense" | "income" | "transfer";
  amount: number;
  category_id: string | null;
  account_id: string;
  to_account_id: string | null;
  date: string;
  note: string | null;
};

/** One proposed action, as the AI returns it. Fields that don't apply to its kind are null. */
export type Action = {
  kind: ActionKind;
  event: EventFields | null;
  event_id: string | null;
  task: TaskFields | null;
  task_id: string | null;
  transaction: TxFields | null;
  note: { title: string | null; body: string } | null;
  note_id: string | null;
};

/* ---------- The shape the AI must answer in ---------- */

const str = { type: "string" };
const nul = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const closed = (properties: Record<string, unknown>, description?: string) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
  ...(description ? { description } : {}),
});
const DAY = { type: "string", description: "yyyy-MM-dd" };
const TIME = { type: "string", description: "HH:mm, 24-hour" };

export const ANSWER_SCHEMA = closed({
  reply: { type: "string", description: "What you say back, briefly, in the user's language. If you need more details before acting, ask here and propose nothing." },
  actions: {
    type: "array",
    description: "Changes to propose. Empty when the user only asked a question or something is unclear.",
    items: closed({
      kind: { type: "string", enum: [...KINDS] },
      event: nul(
        closed(
          {
            title: str,
            date: { ...DAY, description: "yyyy-MM-dd — the (first) day" },
            start: nul(TIME),
            end: nul(TIME),
            location: nul(str),
            notes: nul(str),
            repeat: { type: "string", enum: ["none", "daily", "weekdays", "weekly", "monthly"] },
            days: nul({ type: "array", items: { type: "integer" }, description: "Weekly only: days of the week, 0 = Sunday … 6 = Saturday" }),
            until: nul({ ...DAY, description: "yyyy-MM-dd — last day of a repeating event" }),
          },
          "create_event: the new event. update_event: the complete event as it should be after the change.",
        ),
      ),
      event_id: nul({ ...str, description: "update_event / delete_event: an id from the list of events" }),
      task: nul(
        closed(
          {
            title: str,
            duration_minutes: { type: "integer" },
            priority: { type: "string", enum: Object.keys(PRIORITIES) },
            type: { type: "string", enum: Object.keys(TASK_TYPES) },
            schedule: { type: "string", enum: ["work", "personal"] },
            deadline: nul(DAY),
            start_date: nul(DAY),
            notes: nul(str),
          },
          "create_task: the new task. update_task: the complete task after the change.",
        ),
      ),
      task_id: nul({ ...str, description: "update_task / complete_task / delete_task: an id from the list of tasks" }),
      transaction: nul(
        closed({
          kind: { type: "string", enum: ["expense", "income", "transfer"] },
          amount: { type: "number", description: "In the user's currency, as a positive number (e.g. 4500 or 12.50)" },
          category_id: nul({ ...str, description: "Expense or income category id; null for transfers" }),
          account_id: { ...str, description: "Account id (for transfers: the account the money leaves)" },
          to_account_id: nul({ ...str, description: "Transfers only: the account the money goes to" }),
          date: DAY,
          note: nul(str),
        }),
      ),
      note: nul(closed({ title: nul(str), body: { ...str, description: "create_note: the note's text. append_note: the text to add at the end." } })),
      note_id: nul({ ...str, description: "append_note: an id from the list of notes" }),
    }),
  },
});

/* ---------- Checking a proposal against your data ---------- */

const isDay = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parseDay(d).getTime());
const isTime = (t: string | null | undefined) => !!t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Why a proposal can't be applied as it stands, or null when it's fine. */
export function problemWith(a: Action): string | null {
  const { events, tasks } = useCalendar.getState();
  const { accounts, categories } = useFinance.getState();
  const notes = useNotes.getState().notes;
  const needs = (ok: unknown, why: string) => (ok ? null : why);
  const eventOk = (e: EventFields | null) =>
    !e
      ? "No event details"
      : !e.title.trim()
        ? "The event has no title"
        : !isDay(e.date)
          ? "The date isn't valid"
          : (e.start && !isTime(e.start)) || (e.end && !isTime(e.end))
            ? "A time isn't valid"
            : e.start && e.end && e.end <= e.start
              ? "It ends before it starts"
              : e.until && (!isDay(e.until) || e.until < e.date)
                ? "The end date isn't valid"
                : null;
  const taskOk = (t: TaskFields | null) =>
    !t ? "No task details" : !t.title.trim() ? "The task has no title" : !(t.duration_minutes > 0) ? "The duration isn't valid" : (t.deadline && !isDay(t.deadline)) || (t.start_date && !isDay(t.start_date)) ? "A date isn't valid" : null;

  switch (a.kind) {
    case "create_event":
      return eventOk(a.event);
    case "update_event":
      return needs(events.some((e) => e.id === a.event_id), "That event doesn't exist") ?? eventOk(a.event);
    case "delete_event":
      return needs(events.some((e) => e.id === a.event_id), "That event doesn't exist");
    case "create_task":
      return taskOk(a.task);
    case "update_task":
      return needs(tasks.some((t) => t.id === a.task_id), "That task doesn't exist") ?? taskOk(a.task);
    case "complete_task":
    case "delete_task":
      return needs(tasks.some((t) => t.id === a.task_id), "That task doesn't exist");
    case "add_transaction": {
      const t = a.transaction;
      if (!t) return "No transaction details";
      if (!(t.amount > 0)) return "The amount isn't valid";
      if (!isDay(t.date)) return "The date isn't valid";
      if (!accounts.some((x) => x.id === t.account_id)) return "That account doesn't exist";
      if (t.kind === "transfer") return accounts.some((x) => x.id === t.to_account_id) && t.to_account_id !== t.account_id ? null : "The account to move money to isn't valid";
      return categories.some((c) => c.id === t.category_id && c.kind === t.kind) ? null : "That category doesn't fit";
    }
    case "create_note":
      return needs(a.note?.body.trim() || a.note?.title?.trim(), "The note is empty");
    case "append_note":
      return needs(notes.some((n) => n.id === a.note_id), "That note doesn't exist") ?? needs(a.note?.body.trim(), "Nothing to add");
  }
}

/* ---------- Saying what a proposal does, from the data ---------- */

export type Description = { verb: string; title: string; details: string[]; area: "calendar" | "task" | "money" | "note" };

const when = (date: string) => (date === todayKey() ? "Today" : format(parseDay(date), "EEE, MMM d"));

function eventDetails(e: EventFields) {
  const ws = useSettings.getState().weekStartsOn;
  const repeating = e.repeat !== "none";
  return [
    `${repeating ? "From " : ""}${when(e.date)}${e.start ? ` · ${timeRange({ start: e.start, end: e.end ?? undefined })}` : " · all day"}`,
    ...(repeating ? [repeatSummary({ date: e.date, repeat: e.repeat, days: e.days ?? undefined, until: e.until ?? undefined }, ws)] : []),
    ...(e.location ? [e.location] : []),
    ...(e.notes ? [`“${e.notes}”`] : []),
  ];
}

/** What changes between an event (or task) and its proposed version, in words. */
function changes(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>) {
  return Object.entries(labels)
    .filter(([k]) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map(([k, label]) => `${label}: ${before[k] ?? "—"} → ${after[k] ?? "—"}`);
}

export function describe(a: Action): Description {
  const { events, tasks } = useCalendar.getState();
  const { accounts, categories } = useFinance.getState();
  const currency = useSettings.getState().currency;
  const notes = useNotes.getState().notes;
  const event = events.find((e) => e.id === a.event_id);
  const task = tasks.find((t) => t.id === a.task_id);
  switch (a.kind) {
    case "create_event":
      return { area: "calendar", verb: "New event", title: a.event?.title ?? "", details: a.event ? eventDetails(a.event) : [] };
    case "update_event": {
      const after = a.event!;
      const d = changes(
        { title: event?.title, date: event?.date, start: event?.start, end: event?.end, location: event?.location, repeat: event?.repeat ?? "none" },
        { title: after?.title, date: after?.date, start: after?.start ?? undefined, end: after?.end ?? undefined, location: after?.location ?? undefined, repeat: after?.repeat },
        { title: "Title", date: "Date", start: "Starts", end: "Ends", location: "Place", repeat: "Repeats" },
      );
      return { area: "calendar", verb: "Change event", title: event?.title ?? "Unknown", details: d.length ? d : ["No visible change"] };
    }
    case "delete_event":
      return { area: "calendar", verb: "Delete event", title: event?.title ?? "Unknown", details: event ? [`${when(event.date)}${event.start ? ` · ${timeRange(event)}` : ""}${event.repeat && event.repeat !== "none" ? " · the whole series" : ""}`] : [] };
    case "create_task": {
      const t = a.task!;
      return {
        area: "task",
        verb: "New task",
        title: t?.title ?? "",
        details: t
          ? [
              `${t.duration_minutes} min · ${PRIORITIES[t.priority]?.label ?? t.priority} priority · ${t.schedule === "work" ? "work hours" : "personal time"}`,
              ...(t.deadline ? [`Due ${when(t.deadline)}`] : []),
              ...(t.start_date ? [`Not before ${when(t.start_date)}`] : []),
            ]
          : [],
      };
    }
    case "update_task": {
      const after = a.task!;
      const d = changes(
        { title: task?.title, duration: task?.duration, priority: task?.priority, deadline: task?.deadline },
        { title: after?.title, duration: after?.duration_minutes, priority: after?.priority, deadline: after?.deadline ?? undefined },
        { title: "Title", duration: "Minutes", priority: "Priority", deadline: "Due" },
      );
      return { area: "task", verb: "Change task", title: task?.title ?? "Unknown", details: d.length ? d : ["No visible change"] };
    }
    case "complete_task":
      return { area: "task", verb: "Mark done", title: task?.title ?? "Unknown", details: [] };
    case "delete_task":
      return { area: "task", verb: "Delete task", title: task?.title ?? "Unknown", details: [] };
    case "add_transaction": {
      const t = a.transaction!;
      const account = accounts.find((x) => x.id === t?.account_id)?.name ?? "?";
      const amount = t ? formatMoney(Math.round(t.amount * 100), currency) : "";
      if (t?.kind === "transfer")
        return { area: "money", verb: "Transfer", title: amount, details: [`${account} → ${accounts.find((x) => x.id === t.to_account_id)?.name ?? "?"}`, when(t.date), ...(t.note ? [`“${t.note}”`] : [])] };
      return {
        area: "money",
        verb: t?.kind === "income" ? "Income" : "Expense",
        title: amount,
        details: t ? [`${categories.find((c) => c.id === t.category_id)?.name ?? "?"} · ${account} · ${when(t.date)}`, ...(t.note ? [`“${t.note}”`] : [])] : [],
      };
    }
    case "create_note":
      return { area: "note", verb: "New note", title: a.note?.title || "Untitled", details: a.note?.body ? [a.note.body.length > 160 ? `${a.note.body.slice(0, 160)}…` : a.note.body] : [] };
    case "append_note":
      return { area: "note", verb: "Add to note", title: notes.find((n) => n.id === a.note_id)?.title || "Untitled", details: a.note?.body ? [a.note.body.length > 160 ? `${a.note.body.slice(0, 160)}…` : a.note.body] : [] };
  }
}

/* ---------- Applying, and undoing ---------- */

const toEvent = (e: EventFields): Omit<EventDraft, "color"> => ({
  title: e.title.trim(),
  date: e.date,
  start: e.start ?? undefined,
  end: e.start ? (e.end ?? undefined) : undefined,
  location: e.location?.trim() || undefined,
  notes: e.notes?.trim() || undefined,
  repeat: e.repeat === "none" ? undefined : e.repeat,
  days: e.repeat === "weekly" && e.days?.length ? e.days.filter((d) => d >= 0 && d <= 6) : undefined,
  until: e.repeat !== "none" ? (e.until ?? undefined) : undefined,
});

const toTask = (t: TaskFields) => ({
  title: t.title.trim(),
  duration: Math.max(5, Math.round(t.duration_minutes)),
  priority: t.priority in PRIORITIES ? t.priority : ("medium" as Priority),
  type: t.type in TASK_TYPES ? t.type : "admin",
  schedule: t.schedule,
  deadline: t.deadline ?? undefined,
  startDate: t.start_date ?? undefined,
  notes: t.notes?.trim() || undefined,
});

/** Carries out one approved action. Returns how to undo it. */
export function apply(a: Action): () => void {
  const cal = useCalendar;
  const fin = useFinance;
  const notesStore = useNotes;
  switch (a.kind) {
    case "create_event": {
      const before = new Set(cal.getState().events.map((e) => e.id));
      cal.getState().save({ ...toEvent(a.event!), color: "blue" });
      const id = cal.getState().events.find((e) => !before.has(e.id))?.id;
      return () => id && cal.getState().remove(id);
    }
    case "update_event": {
      const old = cal.getState().events.find((e) => e.id === a.event_id)!;
      cal.getState().save({ ...old, ...toEvent(a.event!), id: old.id, color: old.color });
      return () => cal.setState((s) => ({ events: s.events.map((e) => (e.id === old.id ? old : e)) }));
    }
    case "delete_event": {
      const old = cal.getState().events.find((e) => e.id === a.event_id)!;
      cal.getState().remove(old.id);
      return () => cal.setState((s) => ({ events: [...s.events, old] }));
    }
    case "create_task": {
      const id = cal.getState().saveTask(toTask(a.task!));
      return () => cal.getState().removeTask(id);
    }
    case "update_task": {
      const old = cal.getState().tasks.find((t) => t.id === a.task_id)!;
      cal.getState().saveTask({ ...old, ...toTask(a.task!) });
      return () => cal.setState((s) => ({ tasks: s.tasks.map((t) => (t.id === old.id ? old : t)) }));
    }
    case "complete_task": {
      const before: Task[] = cal.getState().tasks;
      cal.getState().completeTask(a.task_id!, []);
      // Completing a repeating task also creates its next one; undo removes that too.
      return () => cal.setState({ tasks: before });
    }
    case "delete_task": {
      const old = cal.getState().tasks.find((t) => t.id === a.task_id)!;
      cal.getState().removeTask(old.id);
      return () => cal.setState((s) => ({ tasks: [...s.tasks, old] }));
    }
    case "add_transaction": {
      const t = a.transaction!;
      const before = new Set(fin.getState().transactions.map((x) => x.id));
      fin.getState().saveTransaction({
        kind: t.kind,
        amount: Math.round(t.amount * 100),
        categoryId: t.kind === "transfer" ? TRANSFER : (t.category_id ?? ""),
        accountId: t.account_id,
        toAccountId: t.kind === "transfer" ? (t.to_account_id ?? undefined) : undefined,
        date: t.date,
        note: t.note?.trim() || undefined,
      } as Omit<Transaction, "id">);
      const id = fin.getState().transactions.find((x) => !before.has(x.id))?.id;
      return () => id && fin.getState().removeTransaction(id);
    }
    case "create_note": {
      const id = notesStore.getState().create({ title: a.note!.title?.trim() || "", body: a.note!.body.trim() });
      return () => notesStore.getState().remove(id);
    }
    case "append_note": {
      const old = notesStore.getState().notes.find((n) => n.id === a.note_id) as Note;
      notesStore.getState().update(old.id, { body: `${old.body.trimEnd()}\n\n${a.note!.body.trim()}` });
      return () => notesStore.setState((s) => ({ notes: s.notes.map((n) => (n.id === old.id ? old : n)) }));
    }
  }
}

export type { CalendarEvent };
