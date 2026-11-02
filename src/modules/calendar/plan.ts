import { useEffect, useMemo, useState } from "react";
import { format, isPast, isThisWeek, isToday, isTomorrow, isYesterday } from "date-fns";
import { dayKey, parseDay } from "@/lib/dates";
import { schedule, type Plan, type TaskStatus } from "./scheduler";
import {
  TASK_TYPES,
  compareEvents,
  expandEvents,
  formatTime,
  fromMinutes,
  toMinutes,
  useCalendar,
  type CalendarEvent,
  type Priority,
  type Slot,
  type Task,
} from "./store";

/** Re-renders once a minute so the plan (and the "now" line) keep moving. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

let lastPlan: Plan | null = null;

/** The live auto-schedule. Re-plans whenever tasks, events, hours or the clock change. */
export function usePlan() {
  const events = useCalendar((s) => s.events);
  const tasks = useCalendar((s) => s.tasks);
  const prefs = useCalendar((s) => s.prefs);
  const now = useNow();
  return useMemo(() => {
    lastPlan = schedule({ tasks, events, prefs, now, previous: lastPlan });
    return lastPlan;
  }, [tasks, events, prefs, now]);
}

/** Something drawn on the calendar: an event occurrence, a slice of a task, or a bill or subscription payment. */
export type Block = {
  key: string;
  kind: "event" | "task" | "bill" | "renewal";
  id: string;
  title: string;
  date: string;
  start?: string;
  end?: string;
  color: string;
  location?: string;
  repeats?: boolean;
  priority?: Priority;
  status?: TaskStatus;
  done?: boolean;
  locked?: boolean;
  part?: number;
  parts?: number;
  /** Bills and renewals: how much leaves that day */
  amount?: number;
  overdue?: boolean;
};

export const isMoney = (b: Block) => b.kind === "bill" || b.kind === "renewal";

export function taskColor(t: Task) {
  return TASK_TYPES[t.type]?.color ?? "slate";
}

export function eventBlock(e: CalendarEvent): Block {
  return {
    key: `e:${e.id}:${e.date}`,
    kind: "event",
    id: e.id,
    title: e.title,
    date: e.date,
    start: e.start,
    end: e.end,
    color: e.color,
    location: e.location,
    repeats: !!e.repeat && e.repeat !== "none",
  };
}

/** Events and planned tasks for the given days, keyed by yyyy-MM-dd and sorted by time. */
export function buildBlocks(days: Date[], events: CalendarEvent[], tasks: Task[], plan: Plan) {
  const keys = new Set(days.map(dayKey));
  const map = new Map<string, Block[]>();
  const push = (b: Block) => map.set(b.date, [...(map.get(b.date) ?? []), b]);

  for (const list of expandEvents(events, days).values()) list.forEach((e) => push(eventBlock(e)));

  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const s of plan.slots) {
    const t = byId.get(s.taskId);
    if (!t || !keys.has(s.date)) continue;
    push({
      key: `t:${t.id}:${s.date}:${s.start}`,
      kind: "task",
      id: t.id,
      title: t.title,
      date: s.date,
      start: s.start,
      end: s.end,
      color: taskColor(t),
      priority: t.priority,
      status: plan.byTask.get(t.id)?.status,
      locked: !!t.locked,
      part: s.part,
      parts: s.parts,
    });
  }
  for (const t of tasks) {
    for (const s of t.done?.slots ?? []) {
      if (!keys.has(s.date)) continue;
      push({ key: `d:${t.id}:${s.date}:${s.start}`, kind: "task", id: t.id, title: t.title, date: s.date, start: s.start, end: s.end, color: taskColor(t), priority: t.priority, done: true });
    }
  }
  for (const list of map.values()) list.sort(compareEvents);
  return map;
}

export function dayLabel(key: string) {
  const d = parseDay(key);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  if (isYesterday(d)) return "Yesterday";
  return format(d, !isPast(d) && isThisWeek(d, { weekStartsOn: 1 }) ? "EEEE" : "EEE, MMM d");
}

export function slotLabel(s: Slot) {
  return `${dayLabel(s.date)} · ${formatTime(s.start)}`;
}

/** Where a task actually sat when you ticked it off: past slots kept, the current one cut at "now". */
export function slotsUntilNow(slots: Slot[], now = new Date()): Slot[] {
  const today = dayKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return slots.flatMap((s) => {
    if (s.date < today) return [s];
    if (s.date > today || toMinutes(s.start) >= nowMin) return [];
    return [{ ...s, end: fromMinutes(Math.min(toMinutes(s.end), Math.max(nowMin, toMinutes(s.start) + 5))) }];
  });
}
