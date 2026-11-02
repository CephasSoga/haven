import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, ChevronDown, CircleCheckBig, Flag, Lock, Plus, Repeat, Sparkles } from "lucide-react";
import { Card } from "@/components/ui";
import { cn, swatch } from "@/lib/utils";
import { todayKey } from "@/lib/dates";
import { dayLabel, taskColor } from "./plan";
import type { Plan } from "./scheduler";
import { formatDuration, formatTime, PRIORITIES, toMinutes, useCalendar, type Task } from "./store";
import { newTaskDraft, parseQuickTask } from "./TaskDialog";

export function TaskPanel({
  plan,
  onOpen,
  onToggle,
}: {
  plan: Plan;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
}) {
  const tasks = useCalendar((s) => s.tasks);
  const saveTask = useCalendar((s) => s.saveTask);
  const [quick, setQuick] = useState("");
  const [showDone, setShowDone] = useState(false);
  const today = todayKey();

  const open = tasks.filter((t) => !t.done);
  const first = (t: Task) => plan.byTask.get(t.id)?.slots[0];
  const byWhen = (a: Task, b: Task) => {
    const sa = first(a);
    const sb = first(b);
    return (sa ? sa.date + sa.start : "~") .localeCompare(sb ? sb.date + sb.start : "~");
  };
  const risky = (t: Task) => ["late", "unscheduled"].includes(plan.byTask.get(t.id)?.status ?? "");
  const attention = open.filter(risky).sort(byWhen);
  const todays = open.filter((t) => !risky(t) && first(t)?.date === today).sort(byWhen);
  const later = open.filter((t) => !risky(t) && first(t) && first(t)!.date !== today).sort(byWhen);
  const done = tasks.filter((t) => t.done).sort((a, b) => b.done!.at - a.done!.at).slice(0, 12);

  const next = plan.next && tasks.find((t) => t.id === plan.next!.taskId);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nextIsNow = plan.next && plan.next.date === today && toMinutes(plan.next.start) <= nowMin;

  const add = () => {
    const parsed = parseQuickTask(quick);
    if (!parsed.title) return;
    saveTask(newTaskDraft(parsed));
    setQuick("");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Quick add */}
      <Card className="p-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cal-soft text-cal">
            <Plus className="size-4" />
          </span>
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Add a task — “Write report 2h !”"
            className="h-9 min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-faint focus:outline-none"
          />
        </form>
      </Card>

      {/* Plan health */}
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[13px] font-medium",
          plan.atRisk ? "bg-neg/10 text-neg" : "bg-fin-soft text-fin",
        )}
      >
        {plan.atRisk ? <AlertTriangle className="size-4" /> : <Sparkles className="size-4" />}
        <span className="flex-1">
          {plan.atRisk
            ? `${plan.atRisk} ${plan.atRisk === 1 ? "task is" : "tasks are"} at risk`
            : open.length
              ? "Everything is on track"
              : "No open tasks"}
        </span>
        <span className="text-[11px] font-normal opacity-70">Auto-planned</span>
      </div>

      {/* Up next */}
      {next && plan.next && (
        <Card className="relative overflow-hidden p-5">
          <div
            className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full blur-2xl"
            style={{ background: `radial-gradient(circle, ${swatch(taskColor(next)).soft}, transparent 70%)` }}
          />
          <div className="relative text-[12px] font-semibold uppercase tracking-[0.08em] text-cal">{nextIsNow ? "Now" : "Up next"}</div>
          <button onClick={() => onOpen(next)} className="relative mt-1 block text-left font-serif text-[26px] leading-tight hover:underline">
            {next.title}
          </button>
          <div className="relative mt-1 text-[13px] text-muted tabular">
            {nextIsNow ? `Until ${formatTime(plan.next.end)}` : `${dayLabel(plan.next.date)} · ${formatTime(plan.next.start)}`}
            {plan.next.parts > 1 && ` · session ${plan.next.part} of ${plan.next.parts}`}
          </div>
          <button
            onClick={() => onToggle(next)}
            className="relative mt-4 flex h-9 items-center gap-2 rounded-xl bg-primary px-3.5 text-[13px] font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            <Check className="size-4" /> Mark done
          </button>
        </Card>
      )}

      <Card className="py-2">
        {open.length === 0 && done.length === 0 && (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <CircleCheckBig className="mb-3 size-6 text-faint" />
            <p className="font-medium">Nothing to plan</p>
            <p className="mt-1 text-[13px] text-muted">Add tasks with a duration and priority — they'll find their own place on your calendar.</p>
          </div>
        )}
        <Group title="Needs attention" tone="neg" tasks={attention} plan={plan} onOpen={onOpen} onToggle={onToggle} />
        <Group title="Today" tasks={todays} plan={plan} onOpen={onOpen} onToggle={onToggle} />
        <Group title="Coming up" tasks={later} plan={plan} onOpen={onOpen} onToggle={onToggle} />
        {done.length > 0 && (
          <div>
            <button onClick={() => setShowDone(!showDone)} className="flex w-full items-center gap-1 px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint hover:text-muted">
              Completed · {done.length}
              <ChevronDown className={cn("size-3.5 transition-transform", showDone && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {showDone && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  {done.map((t) => (
                    <TaskRow key={t.id} task={t} plan={plan} onOpen={onOpen} onToggle={onToggle} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </Card>
    </div>
  );
}

function Group({
  title,
  tone,
  tasks,
  ...rest
}: {
  title: string;
  tone?: "neg";
  tasks: Task[];
  plan: Plan;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
}) {
  if (!tasks.length) return null;
  return (
    <div>
      <div className={cn("px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em]", tone === "neg" ? "text-neg" : "text-faint")}>
        {title} · {tasks.length}
      </div>
      <AnimatePresence initial={false}>
        {tasks.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
            <TaskRow task={t} {...rest} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("flex items-center gap-1", className)}>{children}</span>;
}

export function TaskRow({ task: t, plan, onOpen, onToggle }: { task: Task; plan: Plan; onOpen: (t: Task) => void; onToggle: (t: Task) => void }) {
  const info = plan.byTask.get(t.id);
  const slot = info?.slots[0];
  const sw = swatch(taskColor(t));
  const late = !t.done && info?.status === "late";
  return (
    <div className="group flex items-start gap-3 px-3 py-0.5">
      <button
        aria-label={t.done ? "Mark as not done" : "Mark as done"}
        onClick={() => onToggle(t)}
        className="mt-3 ml-2 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors hover:bg-sunken"
        style={{ borderColor: sw.fg, background: t.done ? sw.fg : undefined }}
      >
        {t.done ? <Check className="size-3 text-white" strokeWidth={3} /> : <Check className="size-3 opacity-0 group-hover:opacity-40" strokeWidth={3} style={{ color: sw.fg }} />}
      </button>
      <button onClick={() => onOpen(t)} className="min-w-0 flex-1 rounded-xl px-2 py-2 text-left transition-colors hover:bg-sunken">
        <div className={cn("truncate text-[14px] font-medium", t.done && "text-muted line-through")}>{t.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted tabular">
          <Meta>{formatDuration(t.duration)}</Meta>
          {!t.done && slot && (
            <Meta>
              {t.locked && <Lock className="size-3" />}
              {dayLabel(slot.date)} {formatTime(slot.start)}
              {info!.slots.length > 1 && <span className="text-faint">+{info!.slots.length - 1}</span>}
            </Meta>
          )}
          {!t.done && !slot && <Meta className="text-neg">No time found</Meta>}
          {t.deadline && !t.done && (
            <Meta className={late ? "font-medium text-neg" : undefined}>
              {t.deadline < todayKey() ? "Overdue since" : "Due"} {dayLabel(t.deadline)}
              {t.hardDeadline && " · hard"}
            </Meta>
          )}
          {t.repeat && t.repeat !== "none" && <Repeat className="size-3" />}
          <Flag className="size-3" style={{ color: PRIORITIES[t.priority].color }} />
        </div>
      </button>
    </div>
  );
}
