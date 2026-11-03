import { addDays, getDay } from "date-fns";
import { dayKey, parseDay } from "@/lib/dates";
import { PRIORITIES, expandEvents, fromMinutes, rangesOf, toMinutes, type CalendarEvent, type PlannerPrefs, type Slot, type Task } from "./store";

/**
 * The auto-planner. Given fixed events, flexible tasks and your hours, it lays tasks into free time:
 * most important first, earliest deadline next. It is a pure function — the UI simply re-runs it
 * whenever anything changes (or a minute passes), so the plan always reflects reality.
 */

export type TaskStatus = "on-track" | "tight" | "late" | "unscheduled" | "done";

export type TaskPlan = { status: TaskStatus; slots: Slot[] };

export type PlannedSlot = Slot & { taskId: string; part: number; parts: number };

export type Plan = {
  slots: PlannedSlot[];
  byTask: Map<string, TaskPlan>;
  /** The best thing to work on right now (or next) */
  next?: PlannedSlot;
  /** Tasks that will miss their deadline or don't fit at all */
  atRisk: number;
};

type Interval = [number, number];

/** Free stretches of `win` once `busy` intervals are removed. */
function freeIn([from, to]: Interval, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cur = from;
  for (const [s, e] of [...busy].sort((a, b) => a[0] - b[0])) {
    if (e <= cur) continue;
    if (s >= to) break;
    if (s > cur) out.push([cur, Math.min(s, to)]);
    cur = Math.max(cur, e);
    if (cur >= to) break;
  }
  if (cur < to) out.push([cur, to]);
  return out;
}

const len = (s: Slot) => toMinutes(s.end) - toMinutes(s.start);

export function schedule({
  tasks,
  events,
  prefs,
  now,
  previous,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  prefs: PlannerPrefs;
  now: Date;
  previous?: Plan | null;
}): Plan {
  const today = dayKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const anchor = Math.ceil(nowMin / 15) * 15;
  const days = Array.from({ length: prefs.horizon }, (_, i) => addDays(parseDay(today), i));
  const keys = days.map(dayKey);

  const isPast = (s: Slot) => s.date < today || (s.date === today && toMinutes(s.end) <= nowMin);

  // Fixed commitments: timed events (with breathing room) and tasks you pinned.
  const fixed = new Map<string, Interval[]>();
  const block = (map: Map<string, Interval[]>, key: string, iv: Interval) => map.set(key, [...(map.get(key) ?? []), iv]);
  const occ = expandEvents(events, days);
  for (const [key, list] of occ) {
    for (const e of list) {
      if (!e.start) continue; // all-day events don't block time
      const s = toMinutes(e.start);
      const end = e.end ? toMinutes(e.end) : s + 60;
      block(fixed, key, [s - prefs.buffer, end + prefs.buffer]);
    }
  }

  const open = tasks.filter((t) => !t.done);
  // A pin that has already passed without the task being done is released back to the planner.
  const locked = open.filter((t) => t.locked && !isPast(t.locked));
  const flexible = open.filter((t) => !t.locked || isPast(t.locked));
  for (const t of locked) block(fixed, t.locked!.date, [toMinutes(t.locked!.start), toMinutes(t.locked!.end)]);

  // Whatever you're in the middle of right now stays put instead of sliding forward every minute.
  const sticky = new Map<string, Slot>();
  for (const p of previous?.slots ?? []) {
    if (p.date !== today || toMinutes(p.start) > nowMin || toMinutes(p.end) <= nowMin) continue;
    if (!flexible.some((t) => t.id === p.taskId) || sticky.has(p.taskId)) continue;
    sticky.set(p.taskId, { date: p.date, start: p.start, end: p.end });
    block(fixed, p.date, [toMinutes(p.start), toMinutes(p.end)]);
  }

  const statusFor = (t: Task, slots: Slot[], remaining: number): TaskStatus => {
    const finish = slots.reduce<string | null>((m, s) => (m && m > s.date ? m : s.date), null);
    if (t.deadline && (t.deadline < today || remaining > 0 || (finish && finish > t.deadline))) return "late";
    if (remaining > 0) return "unscheduled";
    if (t.deadline && finish === t.deadline) return "tight";
    return "on-track";
  };

  const place = (boost: Map<string, number>) => {
    const busy = new Map<string, Interval[]>([...fixed].map(([k, v]) => [k, [...v]]));
    const byTask = new Map<string, TaskPlan>();

    const ordered = [...flexible].sort(
      (a, b) =>
        PRIORITIES[a.priority].rank - (boost.get(a.id) ?? 0) - (PRIORITIES[b.priority].rank - (boost.get(b.id) ?? 0)) ||
        (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") ||
        a.createdAt - b.createdAt,
    );

    for (const t of ordered) {
      const pre = sticky.get(t.id);
      const slots: Slot[] = pre ? [pre] : [];
      let remaining = t.duration - (pre ? len(pre) : 0);
      const minChunk = t.chunk ? Math.min(t.chunk, t.duration) : t.duration;

      for (let i = 0; i < keys.length && remaining > 0; i++) {
        const key = keys[i];
        if (t.startDate && key < t.startDate) continue;
        // A day can have several stretches of hours (e.g. early morning and evening); try each in turn.
        for (const range of rangesOf(prefs[t.schedule][getDay(days[i])])) {
          if (remaining <= 0) break;
          const win: Interval = [...range];
          if (key === today) win[0] = Math.max(win[0], anchor);
          if (win[0] >= win[1]) continue;

          for (const [a, b] of freeIn(win, busy.get(key) ?? [])) {
            if (remaining <= 0) break;
            const room = b - a;
            let take: number;
            if (!t.chunk) {
              if (room < remaining) continue;
              take = remaining;
            } else {
              take = Math.min(room, remaining);
              if (take < remaining) {
                if (take < minChunk) continue;
                // Never leave a leftover shorter than the minimum chunk.
                if (remaining - take < minChunk) take = remaining - minChunk;
                if (take < minChunk) continue;
              }
            }
            slots.push({ date: key, start: fromMinutes(a), end: fromMinutes(a + take) });
            block(busy, key, [a, a + take]);
            remaining -= take;
          }
        }
      }
      byTask.set(t.id, { status: statusFor(t, slots, remaining), slots });
    }
    return byTask;
  };

  // Hard deadlines win over priority: if one would be missed, promote it and plan again.
  const boost = new Map<string, number>();
  let byTask = place(boost);
  for (let pass = 0; pass < 6; pass++) {
    const behind = flexible.filter(
      (t) => t.hardDeadline && t.deadline && t.deadline >= today && byTask.get(t.id)?.status === "late" && (boost.get(t.id) ?? 0) < 4,
    );
    if (!behind.length) break;
    for (const t of behind) boost.set(t.id, (boost.get(t.id) ?? 0) + 1);
    byTask = place(boost);
  }

  for (const t of locked) byTask.set(t.id, { status: statusFor(t, [t.locked!], 0), slots: [t.locked!] });
  for (const t of tasks) if (t.done) byTask.set(t.id, { status: "done", slots: t.done.slots });

  const slots: PlannedSlot[] = [];
  for (const t of open) {
    const plan = byTask.get(t.id);
    if (!plan) continue;
    const sorted = [...plan.slots].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    plan.slots = sorted;
    sorted.forEach((s, i) => slots.push({ ...s, taskId: t.id, part: i + 1, parts: sorted.length }));
  }
  slots.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

  return {
    slots,
    byTask,
    next: slots.find((s) => !isPast(s)),
    atRisk: open.filter((t) => {
      const s = byTask.get(t.id)?.status;
      return s === "late" || s === "unscheduled";
    }).length,
  };
}
