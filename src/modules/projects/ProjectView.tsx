import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, CircleDashed, Copy, Flag, GanttChart, KanbanSquare, List, Lock, MoreHorizontal, Pause, Pencil, Play,
  Plus, Trash2, Link2,
} from "lucide-react";
import { Button, Card, Progress, Segmented, Select } from "@/components/ui";
import { ask } from "@/components/confirm";
import { dayKey, parseDay, todayKey } from "@/lib/dates";
import { cn, swatch } from "@/lib/utils";
import { formatDuration, PRIORITIES, useCalendar, type Project, type Task, type TaskDraft } from "@/modules/calendar/store";
import { dayLabel, slotsUntilNow, usePlan } from "@/modules/calendar/plan";
import type { Plan } from "@/modules/calendar/scheduler";
import { newTaskDraft, parseQuickTask, TaskDialog } from "@/modules/calendar/TaskDialog";
import { columnOf, HEALTH, stageIndex, summarize, tasksOf, templateFrom, type Column } from "./logic";
import { ProjectDialog } from "./ProjectDialog";

type View = "list" | "board" | "timeline";

export function ProjectView({ project: p, onBack }: { project: Project; onBack: () => void }) {
  const tasks = useCalendar((s) => s.tasks);
  const plan = usePlan();
  const [view, setView] = useState<View>(() => (localStorage.getItem("haven:project-view") as View) || "list");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [menu, setMenu] = useState(false);
  const [saved, setSaved] = useState(false);
  const list = tasksOf(p.id, tasks);
  const sum = summarize(p, tasks, plan);
  const color = swatch(p.color).fg;
  const { saveProject, removeProject, saveTemplate } = useCalendar.getState();

  const pickView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("haven:project-view", v);
    } catch {
      /* only a convenience */
    }
  };
  const open = (t: Task) => setDraft({ ...t });
  const newTask = (stageId?: string) => setDraft(newTaskDraft({ projectId: p.id, stageId, priority: p.priority }));

  const remove = async () => {
    const openCount = list.filter((t) => !t.done).length;
    if (!openCount) {
      if (await ask({ title: `Delete “${p.name}”?`, body: "Its finished tasks stay in your history.", confirmLabel: "Delete", danger: true })) {
        removeProject(p.id, false);
        onBack();
      }
      return;
    }
    const withTasks = await ask({
      title: `Delete “${p.name}” and its ${openCount} open task${openCount > 1 ? "s" : ""}?`,
      body: "Or keep the tasks: choose Cancel, then move them out of the project first.",
      confirmLabel: "Delete with its tasks",
      danger: true,
    });
    if (withTasks) {
      removeProject(p.id, true);
      onBack();
    }
  };

  const health = HEALTH[sum.health];
  const finishLine =
    sum.health === "done"
      ? `Finished${p.doneAt ? ` on ${format(p.doneAt, "d MMM yyyy")}` : ""}`
      : sum.health === "paused"
        ? "On hold: its tasks are off your calendar until you resume it."
        : sum.health === "empty"
          ? "Add tasks and the planner will work out when it can be done."
          : sum.health === "blocked"
            ? "Some tasks wait for something that can't be planned yet."
            : sum.health === "beyond"
              ? `Some tasks don't fit in your free time in the next ${plan.horizon} days.`
              : sum.finish
                ? `Planned to finish ${dayLabel(sum.finish)}${p.deadline ? (sum.slack! > 0 ? `, ${sum.slack} day${sum.slack === 1 ? "" : "s"} before the deadline` : sum.slack === 0 ? ", on the deadline day" : `, ${-sum.slack!} day${sum.slack === -1 ? "" : "s"} after the deadline`) : ""}.`
                : "";

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> All projects
      </button>

      <Card className="overflow-hidden">
        <div className="h-1.5" style={{ background: color }} />
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{p.name}</h1>
              {p.description && <p className="mt-2 max-w-2xl text-[15px] text-muted">{p.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                <HealthChip health={sum.health} />
                {p.deadline && (
                  <span className="rounded-full bg-sunken px-2.5 py-1 font-medium text-muted">
                    Due {format(parseDay(p.deadline), "d MMM yyyy")}
                    {p.hardDeadline && " · hard"}
                  </span>
                )}
                {p.startDate && p.startDate > todayKey() && <span className="rounded-full bg-sunken px-2.5 py-1 font-medium text-muted">From {format(parseDay(p.startDate), "d MMM")}</span>}
                <span className="flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 font-medium text-muted">
                  <Flag className="size-3" style={{ color: PRIORITIES[p.priority].color }} /> {PRIORITIES[p.priority].label}
                </span>
              </div>
            </div>
            <div className="relative flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMenu(!menu)} aria-label="More">
                <MoreHorizontal className="size-4" />
              </Button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 top-9 z-20 flex w-60 flex-col rounded-2xl border border-line bg-raised p-1.5 text-[13px] shadow-float" onClick={() => setMenu(false)}>
                    {p.status === "active" ? (
                      <MenuItem icon={Pause} label="Put on hold" onClick={() => saveProject({ ...p, status: "paused" })} />
                    ) : (
                      <MenuItem icon={Play} label={p.status === "paused" ? "Resume" : "Reopen"} onClick={() => saveProject({ ...p, status: "active", doneAt: undefined })} />
                    )}
                    {p.status !== "done" && <MenuItem icon={CheckCircle2} label="Mark the project done" onClick={() => saveProject({ ...p, status: "done", doneAt: Date.now() })} />}
                    <MenuItem
                      icon={Copy}
                      label={saved ? "Saved as a template" : "Save as a template"}
                      onClick={() => {
                        saveTemplate(templateFrom(p, tasks));
                        setSaved(true);
                      }}
                    />
                    <MenuItem icon={Trash2} label="Delete project" danger onClick={() => void remove()} />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className={cn(health.tone === "neg" ? "text-neg" : "text-muted")}>{finishLine}</span>
              <span className="text-muted">
                {sum.done} of {sum.total} tasks · {formatDuration(sum.doneMinutes)} of {formatDuration(sum.minutes)}
              </span>
            </div>
            <Progress value={sum.minutes ? sum.doneMinutes / sum.minutes : 0} color={color} />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<View>
          layoutId="project-view"
          value={view}
          onChange={pickView}
          options={[
            { value: "list", label: <span className="flex items-center gap-1.5"><List className="size-3.5" /> List</span> },
            { value: "board", label: <span className="flex items-center gap-1.5"><KanbanSquare className="size-3.5" /> Board</span> },
            { value: "timeline", label: <span className="flex items-center gap-1.5"><GanttChart className="size-3.5" /> Timeline</span> },
          ]}
        />
        <Button variant="primary" onClick={() => newTask()}>
          <Plus className="size-4" /> Task
        </Button>
      </div>

      <QuickAdd project={p} />

      {view === "list" && <ListView project={p} tasks={list} plan={plan} onOpen={open} onAdd={newTask} />}
      {view === "board" && <BoardView project={p} tasks={list} plan={plan} onOpen={open} />}
      {view === "timeline" && <TimelineView project={p} tasks={list} plan={plan} onOpen={open} />}

      <ProjectDialog open={editing} onClose={() => setEditing(false)} project={p} />
      <TaskDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

export function HealthChip({ health }: { health: keyof typeof HEALTH }) {
  const h = HEALTH[health];
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium",
        h.tone === "pos" ? "bg-pos/10 text-pos" : h.tone === "neg" ? "bg-neg/10 text-neg" : h.tone === "warn" ? "bg-note-soft text-note" : "bg-sunken text-muted",
      )}
    >
      {h.tone === "neg" && <AlertTriangle className="size-3" />}
      {h.label}
    </span>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Plus; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-sunken", danger && "text-neg")}>
      <Icon className="size-4" /> {label}
    </button>
  );
}

/** "Write the intro 2h !" straight into the project (and a stage). */
function QuickAdd({ project: p }: { project: Project }) {
  const [text, setText] = useState("");
  const [stage, setStage] = useState("");
  const add = () => {
    const parsed = parseQuickTask(text);
    if (!parsed.title) return;
    useCalendar.getState().saveTask(newTaskDraft({ priority: p.priority, ...parsed, projectId: p.id, stageId: stage || undefined, duration: parsed.duration ?? 60 }));
    setText("");
  };
  return (
    <Card className="p-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted">
          <Plus className="size-4" />
        </span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task — “Draft the introduction 2h !”"
          className="h-9 min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-faint focus:outline-none"
        />
        {p.stages.length > 0 && (
          <Select value={stage} onChange={(e) => setStage(e.target.value)} className="h-9 w-36 text-[13px]" aria-label="Stage">
            <option value="">No stage</option>
            {p.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </form>
    </Card>
  );
}

/** Where a task stands, in a few words. */
function When({ t, plan }: { t: Task; plan: Plan }) {
  const info = plan.byTask.get(t.id);
  if (t.done) return <span className="text-pos">Done {format(t.done.at, "d MMM")}</span>;
  const s = info?.status;
  if (s === "paused") return <span>On hold</span>;
  if (s === "blocked") return <span className="text-neg">Blocked</span>;
  if (!info?.slots.length) return <span className="text-neg">No time found</span>;
  const first = info.slots[0];
  return (
    <span className={s === "late" ? "font-medium text-neg" : undefined}>
      {t.locked && <Lock className="mr-0.5 inline size-3" />}
      {dayLabel(first.date)} {first.start}
      {info.slots.length > 1 && <span className="text-faint"> +{info.slots.length - 1}</span>}
      {s === "late" && " · late"}
    </span>
  );
}

function toggleDone(t: Task, plan: Plan) {
  const cal = useCalendar.getState();
  if (t.done) cal.reopenTask(t.id);
  else cal.completeTask(t.id, slotsUntilNow(plan.byTask.get(t.id)?.slots ?? []));
}

/* ---------- List ---------- */

function ListView({ project: p, tasks, plan, onOpen, onAdd }: { project: Project; tasks: Task[]; plan: Plan; onOpen: (t: Task) => void; onAdd: (stageId?: string) => void }) {
  const [showDone, setShowDone] = useState(false);
  const groups = [...p.stages.map((s) => ({ id: s.id, name: s.name, deadline: s.deadline })), { id: "", name: p.stages.length ? "No stage" : "", deadline: undefined }];
  const titles = new Map(useCalendar.getState().tasks.map((t) => [t.id, t.title]));
  const order = (a: Task, b: Task) => {
    const fa = plan.byTask.get(a.id)?.slots[0];
    const fb = plan.byTask.get(b.id)?.slots[0];
    return (fa ? fa.date + fa.start : "~").localeCompare(fb ? fb.date + fb.start : "~") || a.createdAt - b.createdAt;
  };
  if (!tasks.length)
    return (
      <Card className="p-8 text-center text-[14px] text-muted">
        No tasks yet. Add them above, or from Calendar: any task can join a project.
      </Card>
    );
  return (
    <Card className="py-2">
      {groups.map((g, gi) => {
        const inGroup = tasks.filter((t) => (t.stageId ?? "") === g.id || (!g.id && t.stageId && !p.stages.some((s) => s.id === t.stageId)));
        const shown = inGroup.filter((t) => showDone || !t.done).sort(order);
        const doneCount = inGroup.filter((t) => t.done).length;
        if (!inGroup.length && !g.id) return null;
        return (
          <section key={g.id || "none"} className={cn(gi > 0 && "border-t border-line")}>
            {g.name && (
              <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{g.id ? `${gi + 1}. ${g.name}` : g.name}</span>
                  {g.deadline && <span className="text-[12px] text-muted">by {format(parseDay(g.deadline), "d MMM")}</span>}
                  <span className="text-[12px] text-faint">
                    {doneCount}/{inGroup.length}
                  </span>
                </div>
                {g.id && (
                  <button onClick={() => onAdd(g.id)} className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-ink">
                    <Plus className="size-3.5" /> Task
                  </button>
                )}
              </div>
            )}
            {shown.map((t) => (
              <div key={t.id} className="group flex items-start gap-3 px-3 py-0.5">
                <button
                  onClick={() => toggleDone(t, plan)}
                  aria-label={t.done ? "Mark as not done" : "Mark as done"}
                  className="ml-2 mt-3 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                  style={{ borderColor: swatch(p.color).fg, background: t.done ? swatch(p.color).fg : undefined }}
                >
                  {t.done && <Check className="size-3 text-white" strokeWidth={3} />}
                </button>
                <button onClick={() => onOpen(t)} className="min-w-0 flex-1 rounded-xl px-2 py-2 text-left hover:bg-sunken">
                  <div className={cn("truncate text-[14px] font-medium", t.done && "text-muted line-through")}>
                    {t.started && !t.done && <CircleDashed className="mr-1.5 inline size-3.5 text-cal" />}
                    {t.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted tabular">
                    <span>{formatDuration(t.duration)}</span>
                    <When t={t} plan={plan} />
                    {!t.done && t.blockedBy?.length ? (
                      <span className="flex items-center gap-1" title={t.blockedBy.map((b) => titles.get(b)).join(", ")}>
                        <Link2 className="size-3" /> after {t.blockedBy.length === 1 ? `“${titles.get(t.blockedBy[0]) ?? "?"}”` : `${t.blockedBy.length} tasks`}
                      </span>
                    ) : null}
                    <Flag className="size-3" style={{ color: PRIORITIES[t.priority].color }} />
                  </div>
                </button>
              </div>
            ))}
            {g.id && !shown.length && <p className="px-5 pb-3 pt-1 text-[13px] text-faint">{inGroup.length ? "All done." : "No tasks in this stage yet."}</p>}
          </section>
        );
      })}
      {tasks.some((t) => t.done) && (
        <button onClick={() => setShowDone(!showDone)} className="mx-5 mb-2 mt-3 text-[12px] font-medium text-muted hover:text-ink">
          {showDone ? "Hide finished tasks" : `Show finished tasks (${tasks.filter((t) => t.done).length})`}
        </button>
      )}
    </Card>
  );
}

/* ---------- Board ---------- */

const COLUMNS: { id: Column; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
];

function moveTo(t: Task, col: Column, plan: Plan) {
  const cal = useCalendar.getState();
  if (col === "done") {
    if (!t.done) cal.completeTask(t.id, slotsUntilNow(plan.byTask.get(t.id)?.slots ?? []));
    return;
  }
  if (t.done) cal.reopenTask(t.id);
  const fresh = useCalendar.getState().tasks.find((x) => x.id === t.id)!;
  cal.saveTask({ ...fresh, started: col === "doing" });
}

function BoardView({ project: p, tasks, plan, onOpen }: { project: Project; tasks: Task[]; plan: Plan; onOpen: (t: Task) => void }) {
  const [over, setOver] = useState<Column | null>(null);
  const stageName = new Map(p.stages.map((s, i) => [s.id, `${i + 1}. ${s.name}`]));
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {COLUMNS.map((c) => {
        const items = tasks
          .filter((t) => columnOf(t) === c.id)
          .sort((a, b) => (c.id === "done" ? b.done!.at - a.done!.at : stageIndex(p, a) - stageIndex(p, b) || a.createdAt - b.createdAt))
          .slice(0, c.id === "done" ? 30 : undefined);
        return (
          <div
            key={c.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(c.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const t = tasks.find((x) => x.id === e.dataTransfer.getData("text/haven-task"));
              if (t) moveTo(t, c.id, plan);
            }}
            className={cn("flex min-h-40 flex-col gap-2 rounded-3xl bg-sunken p-3 transition-colors", over === c.id && "ring-2 ring-cal/40")}
          >
            <div className="flex items-center justify-between px-2 pt-1 text-[13px] font-semibold">
              {c.label} <span className="font-normal text-faint">{tasks.filter((t) => columnOf(t) === c.id).length}</span>
            </div>
            {items.map((t) => (
              <div
                key={t.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/haven-task", t.id)}
                className="cursor-grab rounded-2xl border border-line bg-surface p-3 shadow-soft active:cursor-grabbing"
              >
                <button onClick={() => onOpen(t)} className={cn("text-left text-[14px] font-medium leading-snug hover:underline", t.done && "text-muted line-through")}>
                  {t.title}
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                  {t.stageId && stageName.get(t.stageId) && <span>{stageName.get(t.stageId)}</span>}
                  <span>{formatDuration(t.duration)}</span>
                  <When t={t} plan={plan} />
                </div>
                {/* Moving without dragging (phones, keyboards). */}
                <div className="mt-2 flex gap-1">
                  {COLUMNS.filter((x) => x.id !== c.id).map((x) => (
                    <button key={x.id} onClick={() => moveTo(t, x.id, plan)} className="rounded-lg bg-sunken px-2 py-1 text-[11px] font-medium text-muted hover:text-ink">
                      → {x.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Timeline (Gantt) ---------- */

function TimelineView({ project: p, tasks, plan, onOpen }: { project: Project; tasks: Task[]; plan: Plan; onOpen: (t: Task) => void }) {
  const today = todayKey();
  const rows = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => stageIndex(p, a) - stageIndex(p, b) || (plan.byTask.get(a.id)?.slots[0]?.date ?? "~").localeCompare(plan.byTask.get(b.id)?.slots[0]?.date ?? "~"))
        .map((t) => {
          const slots = t.done ? t.done.slots : (plan.byTask.get(t.id)?.slots ?? []);
          const dates = slots.map((s) => s.date).sort();
          const doneDay = t.done ? dayKey(new Date(t.done.at)) : undefined;
          return { t, from: dates[0] ?? doneDay, to: dates.at(-1) ?? doneDay, status: t.done ? "done" : plan.byTask.get(t.id)?.status };
        }),
    [tasks, plan, p],
  );
  const known = rows.flatMap((r) => [r.from, r.to]).filter((d): d is string => !!d);
  const start = [today, ...known].sort()[0];
  const end = [today, ...known, ...(p.deadline ? [p.deadline] : []), ...p.stages.map((s) => s.deadline).filter((d): d is string => !!d)].sort().at(-1)!;
  const span = Math.min(366, differenceInCalendarDays(parseDay(end), parseDay(start)) + 3);
  const day = span <= 31 ? 32 : span <= 90 ? 16 : 8;
  const x = (d: string) => differenceInCalendarDays(parseDay(d), parseDay(start)) * day;
  const width = span * day;
  const color = swatch(p.color).fg;
  const days = Array.from({ length: span }, (_, i) => addDays(parseDay(start), i));
  const stageName = new Map(p.stages.map((s, i) => [s.id, `${i + 1}. ${s.name}`]));

  if (!tasks.length) return <Card className="p-8 text-center text-[14px] text-muted">The timeline appears once the project has tasks.</Card>;

  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <div className="w-44 shrink-0 border-r border-line sm:w-64">
          <div className="h-10 border-b border-line" />
          {rows.map(({ t }) => (
            <button key={t.id} onClick={() => onOpen(t)} className="flex h-10 w-full flex-col justify-center border-b border-line/60 px-3 text-left hover:bg-sunken">
              <span className={cn("truncate text-[13px] font-medium", t.done && "text-muted line-through")}>{t.title}</span>
              {t.stageId && stageName.get(t.stageId) && <span className="truncate text-[11px] text-faint">{stageName.get(t.stageId)}</span>}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative" style={{ width }}>
            {/* Dates along the top: every day when there's room, else Mondays. */}
            <div className="flex h-10 border-b border-line">
              {days.map((d) => {
                const label = day >= 32 || d.getDay() === 1 ? (d.getDate() === 1 || day >= 32 ? format(d, "d MMM") : format(d, "d")) : "";
                return (
                  <div key={dayKey(d)} className={cn("shrink-0 border-l border-line/40 px-1 pt-3 text-[10px] text-faint", (d.getDay() === 0 || d.getDay() === 6) && "bg-sunken/60")} style={{ width: day }}>
                    {label}
                  </div>
                );
              })}
            </div>
            <div className="pointer-events-none absolute bottom-0 top-10 w-px bg-cal" style={{ left: x(today) + day / 2 }} title="Today" />
            {p.deadline && <div className="pointer-events-none absolute bottom-0 top-10 border-l-2 border-dashed border-neg" style={{ left: x(p.deadline) + day }} title="Deadline" />}
            {p.stages
              .filter((s) => s.deadline)
              .map((s) => (
                <div key={s.id} className="pointer-events-none absolute bottom-0 top-10 border-l border-dashed border-note" style={{ left: x(s.deadline!) + day }} title={`${s.name} deadline`} />
              ))}
            {rows.map(({ t, from, to, status }) => (
              <div key={t.id} className="relative h-10 border-b border-line/60">
                {from && to ? (
                  <button
                    onClick={() => onOpen(t)}
                    className="absolute top-2.5 h-5 rounded-md text-left text-[10px] font-medium text-white shadow-soft"
                    style={{
                      left: x(from) + 2,
                      width: Math.max(day - 4, x(to) - x(from) + day - 4),
                      background: status === "late" ? "var(--neg)" : status === "done" ? `${color}66` : color,
                    }}
                    title={`${t.title}: ${from === to ? dayLabel(from) : `${dayLabel(from)} → ${dayLabel(to)}`}`}
                  />
                ) : (
                  <span className="absolute left-2 top-3 text-[11px] text-faint">{status === "paused" ? "On hold" : status === "blocked" ? "Blocked" : "Not planned"}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 border-t border-line px-5 py-3 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-px bg-cal" /> Today
        </span>
        {p.deadline && (
          <span className="flex items-center gap-1.5">
            <span className="h-3 border-l-2 border-dashed border-neg" /> Deadline
          </span>
        )}
        <span>Bars run from a task's first planned session to its last.</span>
      </div>
    </Card>
  );
}
