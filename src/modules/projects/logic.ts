import { differenceInCalendarDays } from "date-fns";
import { parseDay } from "@/lib/dates";
import { uid } from "@/lib/utils";
import { useCalendar, type Priority, type Project, type ProjectDraft, type ProjectTemplate, type Task } from "@/modules/calendar/store";
import type { Plan } from "@/modules/calendar/scheduler";

/*
 * Projects are groups of Calendar tasks with a goal, an order (stages, and tasks that wait for others) and a
 * deadline. The planner schedules their tasks like any other; from its plan we can tell when a project will
 * actually be finished, and warn when that's after its deadline.
 */

export const tasksOf = (projectId: string, tasks: Task[]) => tasks.filter((t) => t.projectId === projectId);

export type Health = "done" | "on-track" | "tight" | "late" | "blocked" | "paused" | "empty" | "beyond";

export const HEALTH: Record<Health, { label: string; tone: "pos" | "neg" | "warn" | "muted" }> = {
  done: { label: "Done", tone: "pos" },
  "on-track": { label: "On track", tone: "pos" },
  tight: { label: "Cutting it close", tone: "warn" },
  late: { label: "Will be late", tone: "neg" },
  blocked: { label: "Blocked", tone: "neg" },
  paused: { label: "On hold", tone: "muted" },
  empty: { label: "No tasks yet", tone: "muted" },
  beyond: { label: "Doesn't fit yet", tone: "neg" },
};

export type Summary = {
  total: number;
  done: number;
  /** Minutes of work, all and finished */
  minutes: number;
  doneMinutes: number;
  /** yyyy-MM-dd: when the last open task is planned to finish */
  finish?: string;
  /** Days between the planned finish and the deadline (positive: early) */
  slack?: number;
  health: Health;
};

/** Where a project stands, from the live plan. */
export function summarize(p: Project, tasks: Task[], plan: Plan): Summary {
  const list = tasksOf(p.id, tasks);
  const open = list.filter((t) => !t.done);
  const minutes = list.reduce((n, t) => n + t.duration, 0);
  const doneMinutes = list.filter((t) => t.done).reduce((n, t) => n + t.duration, 0);
  const statuses = open.map((t) => plan.byTask.get(t.id)?.status);
  const finish = open
    .flatMap((t) => plan.byTask.get(t.id)?.slots ?? [])
    .map((s) => s.date)
    .sort()
    .at(-1);
  const slack = p.deadline && finish ? differenceInCalendarDays(parseDay(p.deadline), parseDay(finish)) : undefined;
  const health: Health =
    p.status === "done" || (list.length > 0 && !open.length)
      ? "done"
      : p.status !== "active"
        ? "paused"
        : !list.length
          ? "empty"
          : statuses.includes("blocked")
            ? "blocked"
            : statuses.includes("unscheduled")
              ? "beyond"
              : statuses.includes("late") || (slack !== undefined && slack < 0)
                ? "late"
                : statuses.includes("tight") || slack === 0
                  ? "tight"
                  : "on-track";
  return { total: list.length, done: list.length - open.length, minutes, doneMinutes, finish, slack, health };
}

/* ---------- Creating projects with their tasks ---------- */

/** A task as it comes from a template, the AI or the assistant: its stage and blockers by position. */
export type TaskSpec = {
  title: string;
  duration: number;
  priority?: Priority;
  type?: string;
  schedule?: "work" | "personal";
  chunk?: number;
  /** Index into the stages */
  stage?: number;
  /** Indexes of earlier tasks in the same list it waits for */
  after?: number[];
  deadline?: string;
  notes?: string;
};

export type ProjectSpec = Omit<ProjectDraft, "stages" | "status" | "color" | "priority" | "sequential"> & {
  stages: { name: string; deadline?: string }[];
  status?: Project["status"];
  color?: string;
  priority?: Priority;
  sequential?: boolean;
};

const COLORS = ["blue", "violet", "teal", "green", "amber", "orange", "rose", "pink"];

/** Creates a project and its tasks in one go. Returns the project's id and its tasks' ids, in order. */
export function createProject(spec: ProjectSpec, specs: TaskSpec[] = []) {
  const cal = useCalendar.getState();
  const stages = spec.stages.map((s) => ({ id: uid(), name: s.name.trim() || "Stage", deadline: s.deadline }));
  const id = cal.saveProject({
    ...spec,
    color: spec.color ?? COLORS[cal.projects.length % COLORS.length],
    status: spec.status ?? "active",
    priority: spec.priority ?? "medium",
    sequential: spec.sequential ?? stages.length > 1,
    stages,
  });
  // Long tasks go in sittings of an hour or so, as people really work.
  const ids: string[] = [];
  specs.forEach((t) => {
    const duration = Math.max(5, Math.round(t.duration));
    ids.push(
      useCalendar.getState().saveTask({
        title: t.title.trim(),
        duration,
        priority: t.priority ?? spec.priority ?? "medium",
        type: t.type ?? "deep",
        schedule: t.schedule ?? "work",
        chunk: t.chunk ?? (duration > 120 ? 60 : undefined),
        deadline: t.deadline,
        notes: t.notes,
        projectId: id,
        stageId: t.stage !== undefined ? stages[t.stage]?.id : undefined,
      }),
    );
  });
  // Blockers point at tasks that exist now.
  useCalendar.setState((s) => ({
    tasks: s.tasks.map((t) => {
      const i = ids.indexOf(t.id);
      const after = i >= 0 ? (specs[i].after ?? []).filter((j) => j >= 0 && j < ids.length && j !== i).map((j) => ids[j]) : [];
      return after.length ? { ...t, blockedBy: [...new Set([...(t.blockedBy ?? []), ...after])] } : t;
    }),
  }));
  return { id, taskIds: ids };
}

/* ---------- Templates ---------- */

/** A project's shape, to start new ones from: stages, tasks, their order and lengths, no dates. */
export function templateFrom(p: Project, tasks: Task[]): Omit<ProjectTemplate, "id" | "createdAt"> {
  const list = tasksOf(p.id, tasks).sort((a, b) => stageIndex(p, a) - stageIndex(p, b) || a.createdAt - b.createdAt);
  const at = new Map(list.map((t, i) => [t.id, i]));
  return {
    name: p.name,
    description: p.description,
    sequential: p.sequential,
    stages: p.stages.map((s) => s.name),
    tasks: list.map((t) => ({
      title: t.title,
      duration: t.duration,
      priority: t.priority,
      type: t.type,
      schedule: t.schedule,
      chunk: t.chunk,
      stage: t.stageId ? p.stages.findIndex((s) => s.id === t.stageId) : undefined,
      after: (t.blockedBy ?? []).map((b) => at.get(b)).filter((i): i is number => i !== undefined),
      notes: t.notes,
    })),
  };
}

export function fromTemplate(tpl: ProjectTemplate, overrides: Pick<ProjectSpec, "name"> & Partial<ProjectSpec>) {
  return createProject(
    { description: tpl.description, sequential: tpl.sequential, stages: tpl.stages.map((name) => ({ name })), ...overrides },
    tpl.tasks.map((t) => ({ ...t, stage: t.stage !== undefined && t.stage >= 0 ? t.stage : undefined })),
  );
}

export const stageIndex = (p: Project, t: Task) => {
  const i = t.stageId ? p.stages.findIndex((s) => s.id === t.stageId) : -1;
  return i < 0 ? p.stages.length : i;
};

/** Board columns. */
export type Column = "todo" | "doing" | "done";
export const columnOf = (t: Task): Column => (t.done ? "done" : t.started ? "doing" : "todo");
