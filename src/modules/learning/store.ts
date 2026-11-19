import { create } from "zustand";
import { persist } from "zustand/middleware";
import { addMinutes, startOfWeek } from "date-fns";
import { dayKey } from "@/lib/dates";
import { uid } from "@/lib/utils";
import { fromMinutes, toMinutes, useCalendar, type Task } from "@/modules/calendar/store";
import { useFocus } from "@/modules/focus/store";
import { groupFor, useNotes } from "@/modules/notes/store";
import { KINDS, type Found, type Kind, type Lang, type SourceId } from "./sources";

/** Something to learn from, saved for later or part of a goal's plan. */
export type Resource = {
  id: string;
  /** The found item's own id (source + key), to spot it again */
  ref: string;
  source: SourceId;
  kind: Kind;
  title: string;
  url: string;
  by?: string;
  description?: string;
  image?: string;
  /** How long it takes, if known (minutes) */
  minutes?: number;
  /** Absent: saved for later */
  goalId?: string;
  /** Order within the goal's plan */
  order: number;
  addedAt: number;
  doneAt?: number;
  /** The Calendar task it was planned as */
  taskId?: string;
  /** Why it's in the plan (from the coach) */
  why?: string;
};

export type Objective = { id: string; text: string; doneAt?: number };

export type Level = "beginner" | "intermediate" | "advanced";
export const LEVELS: Record<Level, string> = { beginner: "Beginner", intermediate: "Some basics", advanced: "Advanced" };

/** Regular study time, kept as a repeating Calendar event (which brings its reminders). */
export type Sessions = { days: number[]; time: string; minutes: number; eventId?: string };

export type Goal = {
  id: string;
  title: string;
  /** What you'll be able to do: the point of it */
  why?: string;
  /** Words to search for material */
  topic: string;
  level: Level;
  /** yyyy-MM-dd */
  targetDate?: string;
  /** Time you mean to spend each week */
  weeklyMinutes: number;
  /** Which hours the planner may use for its tasks */
  schedule: "work" | "personal";
  status: "active" | "paused" | "done";
  objectives: Objective[];
  sessions?: Sessions;
  color: string;
  createdAt: number;
  doneAt?: number;
  /** Time studied outside a focus session */
  logs: { at: number; minutes: number; resourceId?: string }[];
};

export type GoalDraft = Pick<Goal, "title" | "why" | "topic" | "level" | "targetDate" | "weeklyMinutes" | "schedule" | "color">;

type LearningState = {
  goals: Goal[];
  resources: Resource[];
  /** Language to search in */
  lang: Lang;
  recent: string[];
  setLang: (lang: Lang) => void;
  remember: (q: string) => void;
  addGoal: (draft: GoalDraft) => string;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  /** Adds what was found (once per goal, or once to "saved"); returns the resource's id */
  add: (found: Found, goalId?: string, why?: string) => string;
  updateResource: (id: string, patch: Partial<Resource>) => void;
  removeResource: (id: string) => void;
  move: (id: string, by: -1 | 1) => void;
  log: (goalId: string, minutes: number, resourceId?: string) => void;
  replaceAll: (data: Pick<LearningState, "goals" | "resources">) => void;
};

export const useLearning = create<LearningState>()(
  persist(
    (set, get) => ({
      goals: [],
      resources: [],
      lang: typeof navigator !== "undefined" && navigator.language.startsWith("fr") ? "fr" : "en",
      recent: [],
      setLang: (lang) => set({ lang }),
      remember: (q) => set((s) => ({ recent: [q, ...s.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 8) })),
      addGoal: (draft) => {
        const id = uid();
        set((s) => ({ goals: [{ ...draft, id, status: "active", objectives: [], logs: [], createdAt: Date.now() }, ...s.goals] }));
        return id;
      },
      updateGoal: (id, patch) => set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
      removeGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id), resources: s.resources.filter((r) => r.goalId !== id) })),
      add: (found, goalId, why) => {
        const same = get().resources.find((r) => r.ref === found.id && r.goalId === goalId);
        if (same) return same.id;
        const id = uid();
        const order = Math.max(0, ...get().resources.filter((r) => r.goalId === goalId).map((r) => r.order + 1));
        const { id: ref, lang: _lang, ...rest } = found;
        set((s) => ({ resources: [...s.resources, { ...rest, id, ref, goalId, order, addedAt: Date.now(), why }] }));
        return id;
      },
      updateResource: (id, patch) => set((s) => ({ resources: s.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      removeResource: (id) => set((s) => ({ resources: s.resources.filter((r) => r.id !== id) })),
      move: (id, by) =>
        set((s) => {
          const r = s.resources.find((x) => x.id === id);
          if (!r) return s;
          const list = s.resources.filter((x) => x.goalId === r.goalId).sort((a, b) => a.order - b.order);
          const i = list.findIndex((x) => x.id === id);
          const j = i + by;
          if (j < 0 || j >= list.length) return s;
          [list[i], list[j]] = [list[j], list[i]];
          const order = new Map(list.map((x, n) => [x.id, n]));
          return { resources: s.resources.map((x) => (order.has(x.id) ? { ...x, order: order.get(x.id)! } : x)) };
        }),
      log: (goalId, minutes, resourceId) =>
        set((s) => ({ goals: s.goals.map((g) => (g.id === goalId ? { ...g, logs: [...g.logs, { at: Date.now(), minutes, resourceId }] } : g)) })),
      replaceAll: ({ goals, resources }) => set({ goals, resources }),
    }),
    { name: "haven:learning", version: 1 },
  ),
);

/* ---------- Reading the state ---------- */

export const planOf = (goalId: string, resources: Resource[]) => resources.filter((r) => r.goalId === goalId).sort((a, b) => a.order - b.order);

/** Done here, or done in Calendar (its task was completed). */
export const isDone = (r: Resource, tasks: Task[]) => !!r.doneAt || !!(r.taskId && tasks.find((t) => t.id === r.taskId)?.done);

/** The next thing to do in a goal's plan. */
export const nextUp = (goalId: string, resources: Resource[], tasks: Task[]) => planOf(goalId, resources).find((r) => !isDone(r, tasks));

/** How far along, 0–1: objectives and plan items together. */
export function progress(goal: Goal, resources: Resource[], tasks: Task[]) {
  const plan = planOf(goal.id, resources);
  const total = goal.objectives.length + plan.length;
  if (!total) return goal.status === "done" ? 1 : 0;
  const done = goal.objectives.filter((o) => o.doneAt).length + plan.filter((r) => isDone(r, tasks)).length;
  return done / total;
}

/** Minutes studied on a goal since a moment: time logged, plus focus sessions on its tasks. */
export function studied(goal: Goal, resources: Resource[], since = 0) {
  const taskIds = new Set(planOf(goal.id, resources).map((r) => r.taskId).filter(Boolean));
  const logged = goal.logs.filter((l) => l.at >= since).reduce((n, l) => n + l.minutes, 0);
  const focused = useFocus
    .getState()
    .sessions.filter((s) => s.start >= since && s.taskId && taskIds.has(s.taskId))
    .reduce((n, s) => n + s.focused, 0);
  return logged + focused;
}

export const weekStart = (now = new Date()) => startOfWeek(now, { weekStartsOn: 1 }).getTime();

/** An estimate when the length isn't known. */
export const guessMinutes = (r: Pick<Resource, "kind" | "minutes">) => r.minutes ?? { course: 120, video: 30, talk: 18, book: 90, podcast: 45, article: 20 }[r.kind];

/* ---------- Ticking things off ---------- */

/** Marks a plan item done (or not), and its Calendar task with it. Time it took is logged unless a focus session covered it. */
export function setDone(r: Resource, done: boolean) {
  const { updateResource, log, goals } = useLearning.getState();
  const cal = useCalendar.getState();
  const task = r.taskId ? cal.tasks.find((t) => t.id === r.taskId) : undefined;
  updateResource(r.id, { doneAt: done ? Date.now() : undefined });
  if (task && done && !task.done) cal.completeTask(task.id, []);
  if (task && !done && task.done) cal.reopenTask(task.id);
  const goal = goals.find((g) => g.id === r.goalId);
  if (!goal) return;
  if (done) {
    const focused = r.taskId ? useFocus.getState().sessions.filter((s) => s.taskId === r.taskId).reduce((n, s) => n + s.focused, 0) : 0;
    const left = guessMinutes(r) - focused;
    if (left >= 5 && !goal.logs.some((l) => l.resourceId === r.id)) log(goal.id, left, r.id);
  } else useLearning.getState().updateGoal(goal.id, { logs: goal.logs.filter((l) => l.resourceId !== r.id) });
}

/* ---------- Calendar: tasks and study sessions ---------- */

/** Puts a plan item on the Calendar as a Learning task; the planner finds it a time and reminds you. */
export function planAsTask(r: Resource, goal: Goal) {
  const cal = useCalendar.getState();
  if (r.taskId && cal.tasks.some((t) => t.id === r.taskId)) return r.taskId;
  const minutes = guessMinutes(r);
  const id = cal.saveTask({
    title: `${KINDS[r.kind].verb}: ${r.title}`,
    duration: Math.min(minutes, 600),
    // Long material goes in sittings of an hour or so.
    chunk: minutes > 75 ? Math.min(60, Math.max(30, goal.sessions?.minutes ?? 45)) : undefined,
    priority: "medium",
    type: "learning",
    schedule: goal.schedule,
    deadline: goal.targetDate,
    notes: `${r.url}\n\nFrom your learning goal “${goal.title}”.`,
  });
  useLearning.getState().updateResource(r.id, { taskId: id });
  return id;
}

export function unplan(r: Resource) {
  if (!r.taskId) return;
  const t = useCalendar.getState().tasks.find((x) => x.id === r.taskId);
  if (t && !t.done) useCalendar.getState().removeTask(t.id);
  useLearning.getState().updateResource(r.id, { taskId: undefined });
}

/** Creates or updates the repeating study event; `null` removes it. */
export function setSessions(goal: Goal, sessions: Omit<Sessions, "eventId"> | null) {
  const cal = useCalendar.getState();
  const old = goal.sessions?.eventId;
  if (!sessions || !sessions.days.length) {
    if (old) cal.remove(old);
    useLearning.getState().updateGoal(goal.id, { sessions: undefined });
    return;
  }
  const start = sessions.time;
  const end = fromMinutes(Math.min(toMinutes(start) + sessions.minutes, 23 * 60 + 59));
  const draft = {
    title: `Study · ${goal.title}`,
    date: dayKey(new Date()),
    start,
    end,
    color: goal.color,
    repeat: "weekly" as const,
    days: [...sessions.days].sort(),
    until: goal.targetDate,
    notes: `Study time for your learning goal${goal.why ? `: ${goal.why}` : "."}`,
  };
  let eventId = old && cal.events.some((e) => e.id === old) ? old : undefined;
  if (eventId) cal.save({ ...draft, id: eventId, date: cal.events.find((e) => e.id === eventId)!.date });
  else {
    const before = new Set(cal.events.map((e) => e.id));
    cal.save(draft);
    eventId = useCalendar.getState().events.find((e) => !before.has(e.id))?.id;
  }
  useLearning.getState().updateGoal(goal.id, { sessions: { ...sessions, eventId } });
}

/** Ends a goal's link to the Calendar: the study event, and tasks not yet done. */
export function clearCalendar(goal: Goal) {
  const cal = useCalendar.getState();
  if (goal.sessions?.eventId) cal.remove(goal.sessions.eventId);
  for (const r of planOf(goal.id, useLearning.getState().resources)) {
    const t = r.taskId && cal.tasks.find((x) => x.id === r.taskId);
    if (t && !t.done) cal.removeTask(t.id);
  }
}

/** When the next study session starts, for "Next session: Tue 18:00". */
export function nextSession(goal: Goal, now = new Date()) {
  const s = goal.sessions;
  if (!s?.days.length) return null;
  for (let i = 0; i < 8; i++) {
    const d = addMinutes(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), toMinutes(s.time));
    if (s.days.includes(d.getDay()) && d > now && (!goal.targetDate || dayKey(d) <= goal.targetDate)) return d;
  }
  return null;
}

/* ---------- Notes ---------- */

/** A new note in the goal's own group of notes; returns its id. */
export function noteFor(goal: Goal, r?: Resource) {
  const groupId = groupFor({ kind: "learning", id: goal.id }, goal.title);
  return useNotes.getState().create({
    groupId,
    title: r ? r.title : "",
    body: r ? `${r.url}\n\n` : "",
    color: "amber",
  });
}

export const notesGroupOf = (goal: Goal) => useNotes.getState().groups.find((g) => g.source?.kind === "learning" && g.source.id === goal.id)?.id;
