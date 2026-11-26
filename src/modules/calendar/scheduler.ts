import { addDays, getDay } from "date-fns";
import { dayKey, parseDay } from "@/lib/dates";
import { PRIORITIES, expandEvents, fromMinutes, rangesOf, toMinutes, type CalendarEvent, type PlannerPrefs, type Project, type Slot, type Task } from "./store";

/**
 * The auto-planner. Given fixed events, flexible tasks and your hours, it lays tasks into free time:
 * most important first, earliest deadline next. It is a pure function — the UI simply re-runs it
 * whenever anything changes (or a minute passes), so the plan always reflects reality.
 *
 * Tasks can wait for others (directly, or because an earlier stage of their project isn't finished), take
 * their dates and deadline from their project or stage, and sit out while their project is on hold. The plan
 * reaches as far as the latest deadline, so a long project is planned to its end.
 */

/** blocked: waits for something that can't be planned (on hold, or no room). paused: its project is on hold. */
export type TaskStatus = "on-track" | "tight" | "late" | "unscheduled" | "done" | "blocked" | "paused";

/** The latest the planner looks ahead, however far deadlines are. */
const MAX_HORIZON = 400;

/** What a task inherits from its project and stage. */
export function effective(t: Task, projects: Map<string, Project>) {
  const p = t.projectId ? projects.get(t.projectId) : undefined;
  const stage = p && t.stageId ? p.stages.find((s) => s.id === t.stageId) : undefined;
  const later = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : (a ?? b));
  const deadline = t.deadline ?? stage?.deadline ?? p?.deadline;
  return {
    project: p,
    startDate: later(t.startDate, p?.startDate),
    deadline,
    hardDeadline: !!t.hardDeadline || (!t.deadline && !!p?.hardDeadline && !!deadline),
    onHold: !!p && p.status !== "active",
  };
}

/** The open tasks a task waits for: the ones it names, and (in a project taken stage by stage) every open task of an earlier stage. */
export function waitsFor(t: Task, open: Task[], projects: Map<string, Project>) {
  const openIds = new Set(open.map((x) => x.id));
  const out = new Set((t.blockedBy ?? []).filter((id) => id !== t.id && openIds.has(id)));
  const p = t.projectId ? projects.get(t.projectId) : undefined;
  if (p?.sequential && t.stageId) {
    const at = p.stages.findIndex((s) => s.id === t.stageId);
    if (at > 0) {
      const earlier = new Set(p.stages.slice(0, at).map((s) => s.id));
      for (const o of open) if (o.projectId === p.id && o.stageId && earlier.has(o.stageId)) out.add(o.id);
    }
  }
  return [...out];
}

export type TaskPlan = { status: TaskStatus; slots: Slot[] };

export type PlannedSlot = Slot & { taskId: string; part: number; parts: number };

export type Plan = {
  slots: PlannedSlot[];
  byTask: Map<string, TaskPlan>;
  /** The best thing to work on right now (or next) */
  next?: PlannedSlot;
  /** Tasks that will miss their deadline, don't fit at all, or wait on something that can't happen */
  atRisk: number;
  /** How many days ahead it looked */
  horizon: number;
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
  projects = [],
}: {
  tasks: Task[];
  events: CalendarEvent[];
  prefs: PlannerPrefs;
  now: Date;
  previous?: Plan | null;
  projects?: Project[];
}): Plan {
  const today = dayKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const anchor = Math.ceil(nowMin / 15) * 15;
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const eff = new Map(tasks.map((t) => [t.id, effective(t, byProject)]));

  // Look far enough ahead to reach the latest deadline or start date (plus a week), never less than you chose.
  const furthest = tasks
    .filter((t) => !t.done)
    .flatMap((t) => [eff.get(t.id)!.deadline, eff.get(t.id)!.startDate])
    .filter((d): d is string => !!d && d > today)
    .sort()
    .at(-1);
  const reach = furthest ? Math.round((parseDay(furthest).getTime() - parseDay(today).getTime()) / 86_400_000) + 7 : 0;
  const horizon = Math.min(MAX_HORIZON, Math.max(prefs.horizon, reach));
  const days = Array.from({ length: horizon }, (_, i) => addDays(parseDay(today), i));
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
  // Tasks of a project on hold stay off the plan until it's picked up again.
  const held = open.filter((t) => eff.get(t.id)!.onHold);
  const active = open.filter((t) => !eff.get(t.id)!.onHold);
  // A pin that has already passed without the task being done is released back to the planner.
  const locked = active.filter((t) => t.locked && !isPast(t.locked));
  const flexible = active.filter((t) => !t.locked || isPast(t.locked));
  const deps = new Map(open.map((t) => [t.id, waitsFor(t, open, byProject)]));
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
    const deadline = eff.get(t.id)!.deadline;
    const finish = slots.reduce<string | null>((m, s) => (m && m > s.date ? m : s.date), null);
    if (deadline && (deadline < today || remaining > 0 || (finish && finish > deadline))) return "late";
    if (remaining > 0) return "unscheduled";
    if (deadline && finish === deadline) return "tight";
    return "on-track";
  };

  /** When a list of slots ends: its last day and minute. */
  type End = { date: string; min: number };
  const endOf = (slots: Slot[]): End | null =>
    slots.reduce<End | null>((m, s) => {
      const e = { date: s.date, min: toMinutes(s.end) };
      return !m || e.date > m.date || (e.date === m.date && e.min > m.min) ? e : m;
    }, null);

  const place = (boost: Map<string, number>) => {
    const busy = new Map<string, Interval[]>([...fixed].map(([k, v]) => [k, [...v]]));
    const byTask = new Map<string, TaskPlan>();
    // When each task will be finished, for the ones waiting on it ("never": it can't be, for now).
    const ends = new Map<string, End | "never">();
    for (const t of locked) ends.set(t.id, endOf([t.locked!])!);
    for (const t of held) ends.set(t.id, "never");

    const queue = [...flexible].sort(
      (a, b) =>
        PRIORITIES[a.priority].rank - (boost.get(a.id) ?? 0) - (PRIORITIES[b.priority].rank - (boost.get(b.id) ?? 0)) ||
        (eff.get(a.id)!.deadline ?? "9999").localeCompare(eff.get(b.id)!.deadline ?? "9999") ||
        a.createdAt - b.createdAt,
    );

    while (queue.length) {
      // The most important task whose blockers are all planned; if tasks wait on each other in a loop, the first anyway.
      let at = queue.findIndex((t) => deps.get(t.id)!.every((d) => ends.has(d)));
      if (at < 0) at = 0;
      const t = queue.splice(at, 1)[0];
      const blockers = deps.get(t.id)!.map((d) => ends.get(d)).filter((e) => e !== undefined);
      if (blockers.includes("never")) {
        byTask.set(t.id, { status: "blocked", slots: [] });
        ends.set(t.id, "never");
        continue;
      }
      // Not before the last of its blockers is done.
      const after = (blockers as End[]).reduce<End | null>((m, e) => (!m || e.date > m.date || (e.date === m.date && e.min > m.min) ? e : m), null);
      const startDate = eff.get(t.id)!.startDate;
      const pre = sticky.get(t.id);
      const slots: Slot[] = pre ? [pre] : [];
      let remaining = t.duration - (pre ? len(pre) : 0);
      const minChunk = t.chunk ? Math.min(t.chunk, t.duration) : t.duration;

      for (let i = 0; i < keys.length && remaining > 0; i++) {
        const key = keys[i];
        if (startDate && key < startDate) continue;
        if (after && key < after.date) continue;
        // A day can have several stretches of hours (e.g. early morning and evening); try each in turn.
        for (const range of rangesOf(prefs[t.schedule][getDay(days[i])])) {
          if (remaining <= 0) break;
          const win: Interval = [...range];
          if (key === today) win[0] = Math.max(win[0], anchor);
          if (after && key === after.date) win[0] = Math.max(win[0], after.min);
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
      ends.set(t.id, remaining > 0 ? "never" : (endOf(slots) ?? { date: today, min: anchor }));
    }
    return byTask;
  };

  // Hard deadlines win over priority: if one would be missed, promote it and plan again.
  const boost = new Map<string, number>();
  let byTask = place(boost);
  for (let pass = 0; pass < 6; pass++) {
    const behind = flexible.filter((t) => {
      const e = eff.get(t.id)!;
      return e.hardDeadline && e.deadline && e.deadline >= today && byTask.get(t.id)?.status === "late" && (boost.get(t.id) ?? 0) < 4;
    });
    if (!behind.length) break;
    for (const t of behind) boost.set(t.id, (boost.get(t.id) ?? 0) + 1);
    byTask = place(boost);
  }

  for (const t of locked) byTask.set(t.id, { status: statusFor(t, [t.locked!], 0), slots: [t.locked!] });
  for (const t of held) byTask.set(t.id, { status: "paused", slots: [] });
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
      return s === "late" || s === "unscheduled" || s === "blocked";
    }).length,
    horizon,
  };
}
