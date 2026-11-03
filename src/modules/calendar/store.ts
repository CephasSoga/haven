import { create } from "zustand";
import { persist } from "zustand/middleware";
import { addDays, addMonths, format, getDate, getDay } from "date-fns";
import { uid } from "@/lib/utils";
import { dayKey, parseDay, todayKey } from "@/lib/dates";

/* ---------- Events: fixed commitments ---------- */

export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export type CalendarEvent = {
  id: string;
  title: string;
  /** yyyy-MM-dd — for repeating events, the first occurrence */
  date: string;
  /** HH:mm — both absent means an all-day event */
  start?: string;
  end?: string;
  color: string;
  location?: string;
  notes?: string;
  repeat?: Repeat;
  /** Weekly events: the days of the week it happens on (0 = Sunday). Absent: the start date's weekday */
  days?: number[];
  /** yyyy-MM-dd — for repeating events, the last day it can happen; absent: no end */
  until?: string;
};

export type EventDraft = Omit<CalendarEvent, "id"> & { id?: string };

/* ---------- Tasks: flexible work the planner places for you ---------- */

export type Priority = "asap" | "high" | "medium" | "low";

export const PRIORITIES: Record<Priority, { label: string; color: string; rank: number }> = {
  asap: { label: "ASAP", color: "#e0555a", rank: 0 },
  high: { label: "High", color: "#ec7a3c", rank: 1 },
  medium: { label: "Medium", color: "#d99a1e", rank: 2 },
  low: { label: "Low", color: "#7a8394", rank: 3 },
};

export const TASK_TYPES: Record<string, { label: string; color: string }> = {
  deep: { label: "Deep work", color: "violet" },
  admin: { label: "Admin", color: "slate" },
  meeting: { label: "Meeting prep", color: "blue" },
  creative: { label: "Creative", color: "pink" },
  learning: { label: "Learning", color: "amber" },
  errand: { label: "Errand", color: "orange" },
  personal: { label: "Personal", color: "green" },
};

export type Slot = { date: string; start: string; end: string };

export type Task = {
  id: string;
  title: string;
  /** minutes */
  duration: number;
  priority: Priority;
  type: string;
  /** Which hours the planner may use */
  schedule: "work" | "personal";
  /** yyyy-MM-dd */
  deadline?: string;
  /** A hard deadline outranks priority when time gets tight */
  hardDeadline?: boolean;
  /** Don't schedule before this day */
  startDate?: string;
  /** Minimum chunk in minutes; absent means "do it in one sitting" */
  chunk?: number;
  repeat?: Repeat;
  /** Pinned to a time by you; the planner works around it */
  locked?: Slot;
  notes?: string;
  done?: { at: number; slots: Slot[] };
  createdAt: number;
};

export type TaskDraft = Omit<Task, "id" | "createdAt"> & { id?: string; createdAt?: number };

/* ---------- Planner preferences ---------- */

export type TimeRange = { start: string; end: string };
/**
 * A day's hours: `start`–`end`, plus any further stretches in `more` (e.g. 06:00–08:00 and 20:00–22:00).
 * Extra stretches sit beside the first rather than replacing it, so copies of Haven from before they
 * existed still read the day correctly.
 */
export type Hours = { on: boolean; start: string; end: string; more?: TimeRange[] };
/** Indexed by day of week, 0 = Sunday */
export type WeekHours = Hours[];

/** A day's hours as [start, end] minutes: in order, overlaps merged, empty or backwards stretches dropped. */
export function rangesOf(h: Hours | undefined): [number, number][] {
  if (!h?.on) return [];
  const all = [{ start: h.start, end: h.end }, ...(h.more ?? [])]
    .map((r) => [toMinutes(r.start), toMinutes(r.end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of all) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export type PlannerPrefs = {
  work: WeekHours;
  personal: WeekHours;
  /** Minutes kept free before and after events */
  buffer: number;
  /** How many days ahead the planner looks */
  horizon: number;
};

const weekdays = (start: string, end: string, weekend: Hours = { on: false, start, end }): WeekHours =>
  Array.from({ length: 7 }, (_, d) => (d === 0 || d === 6 ? { ...weekend } : { on: true, start, end }));

export const DEFAULT_PREFS: PlannerPrefs = {
  work: weekdays("09:00", "17:30"),
  personal: weekdays("18:00", "21:30", { on: true, start: "10:00", end: "19:00" }),
  buffer: 10,
  horizon: 28,
};

/* ---------- Store ---------- */

type CalendarState = {
  events: CalendarEvent[];
  tasks: Task[];
  prefs: PlannerPrefs;
  save: (draft: EventDraft) => void;
  remove: (id: string) => void;
  saveTask: (draft: TaskDraft) => string;
  removeTask: (id: string) => void;
  /** `slots` is where the task sat when you finished it, kept as a record on the calendar */
  completeTask: (id: string, slots: Slot[]) => void;
  reopenTask: (id: string) => void;
  lockTask: (id: string, slot: Slot | undefined) => void;
  setPrefs: (patch: Partial<PlannerPrefs>) => void;
  replaceAll: (data: { events: CalendarEvent[]; tasks?: Task[]; prefs?: PlannerPrefs }) => void;
};

export const useCalendar = create<CalendarState>()(
  persist(
    (set, get) => ({
      events: [],
      tasks: [],
      prefs: DEFAULT_PREFS,
      save: (draft) =>
        set((s) => {
          if (draft.id) {
            return { events: s.events.map((e) => (e.id === draft.id ? ({ ...draft, id: draft.id } as CalendarEvent) : e)) };
          }
          return { events: [...s.events, { ...draft, id: uid() }] };
        }),
      remove: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
      saveTask: (draft) => {
        const id = draft.id ?? uid();
        const task: Task = { ...draft, id, createdAt: draft.createdAt ?? Date.now() };
        set((s) => ({
          tasks: draft.id ? s.tasks.map((t) => (t.id === id ? task : t)) : [...s.tasks, task],
        }));
        return id;
      },
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      completeTask: (id, slots) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task || task.done) return;
        const next = task.repeat && task.repeat !== "none" ? nextOccurrence(task) : null;
        set((s) => ({
          tasks: [...s.tasks.map((t) => (t.id === id ? { ...t, done: { at: Date.now(), slots }, locked: undefined } : t)), ...(next ? [next] : [])],
        }));
      },
      reopenTask: (id) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: undefined } : t)) })),
      lockTask: (id, slot) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, locked: slot } : t)) })),
      setPrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),
      replaceAll: ({ events, tasks = [], prefs }) => set((s) => ({ events, tasks, prefs: prefs ?? s.prefs })),
    }),
    {
      name: "haven:calendar",
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as Partial<CalendarState>;
        if (version < 2) return { ...s, tasks: [], prefs: DEFAULT_PREFS };
        return s;
      },
    },
  ),
);

/* ---------- Recurrence ---------- */

export const REPEAT_LABELS: Record<Repeat, string> = {
  none: "Does not repeat",
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Every week",
  monthly: "Every month",
};

export function occursOn(e: CalendarEvent, key: string, day: Date) {
  if (key < e.date) return false;
  if (e.until && e.repeat && e.repeat !== "none" && key > e.until) return false;
  switch (e.repeat ?? "none") {
    case "none":
      return key === e.date;
    case "daily":
      return true;
    case "weekdays":
      return getDay(day) !== 0 && getDay(day) !== 6;
    case "weekly":
      return e.days?.length ? e.days.includes(getDay(day)) : getDay(day) === getDay(parseDay(e.date));
    case "monthly":
      return getDate(day) === getDate(parseDay(e.date));
  }
}

/** The days of the week a weekly event happens on. */
export const weeklyDays = (e: Pick<CalendarEvent, "date" | "days">) => (e.days?.length ? e.days : [getDay(parseDay(e.date))]);

/** "Every Mon, Wed and Fri, from Nov 3 to Dec 19, 2026" — how an event repeats, in words. */
export function repeatSummary(e: Pick<CalendarEvent, "date" | "repeat" | "days" | "until">, weekStartsOn: 0 | 1 = 1, { withStart = false } = {}) {
  const repeat = e.repeat ?? "none";
  if (repeat === "none") return REPEAT_LABELS.none;
  let text: string = REPEAT_LABELS[repeat];
  if (repeat === "weekly") {
    const order = (d: number) => (d - weekStartsOn + 7) % 7;
    const days = [...weeklyDays(e)].sort((a, b) => order(a) - order(b));
    const names = days.map((d) => format(addDays(new Date(2026, 0, 4), d), "EEE"));
    text =
      days.length === 7 ? "Every day" : days.length === 1 ? `Every ${format(addDays(new Date(2026, 0, 4), days[0]), "EEEE")}` : `Every ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }
  const start = parseDay(e.date);
  const end = e.until ? parseDay(e.until) : null;
  if (withStart && end) return `${text}, from ${format(start, start.getFullYear() === end.getFullYear() ? "MMM d" : "MMM d, yyyy")} to ${format(end, "MMM d, yyyy")}`;
  if (withStart) return `${text}, starting ${format(start, "MMM d, yyyy")}`;
  return end ? `${text}, until ${format(end, "MMM d, yyyy")}` : text;
}

/** Every event occurrence on the given days, keyed by yyyy-MM-dd. */
export function expandEvents(events: CalendarEvent[], days: Date[]) {
  const map = new Map<string, CalendarEvent[]>();
  for (const d of days) {
    const key = dayKey(d);
    const list = events.filter((e) => occursOn(e, key, d)).map((e) => (e.date === key ? e : { ...e, date: key }));
    if (list.length) map.set(key, list.sort(compareEvents));
  }
  return map;
}

function step(repeat: Repeat, from: Date) {
  switch (repeat) {
    case "daily":
      return addDays(from, 1);
    case "weekdays": {
      let d = addDays(from, 1);
      while (getDay(d) === 0 || getDay(d) === 6) d = addDays(d, 1);
      return d;
    }
    case "weekly":
      return addDays(from, 7);
    case "monthly":
      return addMonths(from, 1);
    default:
      return from;
  }
}

/** The next instance of a repeating task, shifted forward past today. */
function nextOccurrence(t: Task): Task {
  const today = todayKey();
  let start = parseDay(t.startDate ?? today);
  do start = step(t.repeat!, start);
  while (dayKey(start) <= today);
  const span = t.deadline && t.startDate ? (parseDay(t.deadline).getTime() - parseDay(t.startDate).getTime()) / 86_400_000 : null;
  return {
    ...t,
    id: uid(),
    createdAt: Date.now(),
    startDate: dayKey(start),
    deadline: t.deadline ? dayKey(addDays(start, span ?? 0)) : undefined,
    done: undefined,
    locked: undefined,
  };
}

/* ---------- Helpers ---------- */

export function compareEvents(a: { start?: string; title: string }, b: { start?: string; title: string }) {
  if (!a.start && b.start) return -1;
  if (a.start && !b.start) return 1;
  return (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title);
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number) {
  const clamped = Math.max(0, Math.min(24 * 60, min));
  if (clamped === 24 * 60) return "24:00";
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** "09:30" → "9:30 AM" (or "09:30") in the user's locale. */
export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h % 24, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function timeRange(e: { start?: string; end?: string }) {
  if (!e.start) return "All day";
  return e.end ? `${formatTime(e.start)} – ${formatTime(e.end)}` : formatTime(e.start);
}

export function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
