import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { differenceInCalendarDays, format, formatDistanceToNowStrict } from "date-fns";
import {
  ArrowDown, ArrowLeft, ArrowUp, CalendarCheck, CalendarPlus, Check, Clock, Loader2, MoreHorizontal, NotebookPen, Pause, Pencil, Play,
  Plus, Search, Sparkles, Timer, Trash2, Trophy, X,
} from "lucide-react";
import { Button, Card, CardHeader, Input, Modal, Progress } from "@/components/ui";
import { ask } from "@/components/confirm";
import { explain, useAiReady, useAssistant } from "@/lib/ai";
import { parseDay } from "@/lib/dates";
import { cn, swatch } from "@/lib/utils";
import { useCalendar } from "@/modules/calendar/store";
import { usePlan } from "@/modules/calendar/plan";
import { useFocus } from "@/modules/focus/store";
import { hours } from "@/modules/focus/store";
import { KINDS } from "./sources";
import {
  clearCalendar, isDone, LEVELS, nextSession, noteFor, notesGroupOf, planAsTask, planOf, progress, setDone, studied, unplan, useLearning, weekStart,
  type Goal, type Resource,
} from "./store";
import { Discover } from "./Discover";
import { GoalDialog } from "./GoalDialog";
import { suggestPlan, type Suggestion } from "./coach";
import { ACCENT, Meta, Thumb } from "./parts";

export function GoalView({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const resources = useLearning((s) => s.resources);
  const tasks = useCalendar((s) => s.tasks);
  useFocus((s) => s.sessions);
  const [editing, setEditing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [coaching, setCoaching] = useState(false);
  const aiReady = useAiReady();
  const plan = planOf(goal.id, resources);
  const color = swatch(goal.color).fg;
  const done = progress(goal, resources, tasks);
  const week = studied(goal, resources, weekStart());
  const total = studied(goal, resources);
  const next = nextSession(goal);
  const days = goal.targetDate ? differenceInCalendarDays(parseDay(goal.targetDate), new Date()) : null;
  const { updateGoal, removeGoal } = useLearning.getState();

  const remove = async () => {
    if (!(await ask({ title: `Delete “${goal.title}”?`, body: "Its plan, milestones and study sessions go too, with its Learning tasks not yet done. Its notes stay in Notes.", confirmLabel: "Delete", danger: true })))
      return;
    clearCalendar(goal);
    removeGoal(goal.id);
    onBack();
  };

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> All goals
      </button>

      <Card className="overflow-hidden">
        <div className="h-1.5" style={{ background: color }} />
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-serif text-3xl leading-tight sm:text-4xl">{goal.title}</h1>
              {goal.why && <p className="mt-2 max-w-2xl text-[15px] text-muted">{goal.why}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                <Chip>{LEVELS[goal.level]}</Chip>
                <Chip>{hours(goal.weeklyMinutes)} a week</Chip>
                {goal.targetDate && (
                  <Chip tone={days !== null && days < 0 && goal.status !== "done" ? "neg" : undefined}>
                    {format(parseDay(goal.targetDate), "d MMM yyyy")} · {days === null ? "" : days > 0 ? `in ${days} day${days > 1 ? "s" : ""}` : days === 0 ? "today" : `${-days} days ago`}
                  </Chip>
                )}
                {goal.status === "paused" && <Chip>Paused</Chip>}
                {goal.status === "done" && <Chip tone="pos">Achieved {goal.doneAt ? formatDistanceToNowStrict(goal.doneAt, { addSuffix: true }) : ""}</Chip>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> Edit
              </Button>
              {goal.status === "active" && (
                <Button size="sm" variant="ghost" onClick={() => updateGoal(goal.id, { status: "paused" })}>
                  <Pause className="size-3.5" /> Pause
                </Button>
              )}
              {goal.status !== "active" && (
                <Button size="sm" variant="ghost" onClick={() => updateGoal(goal.id, { status: "active", doneAt: undefined })}>
                  <Play className="size-3.5" /> {goal.status === "done" ? "Reopen" : "Resume"}
                </Button>
              )}
              {goal.status !== "done" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (await ask({ title: "Mark this goal achieved?", body: "Its study sessions stop; what's left of its plan is taken off the Calendar.", confirmLabel: "Achieved" })) {
                      clearCalendar(goal);
                      updateGoal(goal.id, { status: "done", doneAt: Date.now(), sessions: undefined });
                    }
                  }}
                >
                  <Trophy className="size-3.5" /> Achieved
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={remove} aria-label="Delete goal">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Progress" value={`${Math.round(done * 100)}%`}>
              <Progress value={done} color={color} />
            </Stat>
            <Stat label="This week" value={`${hours(week)} of ${hours(goal.weeklyMinutes)}`}>
              <Progress value={Math.min(1, week / Math.max(1, goal.weeklyMinutes))} color={ACCENT} />
            </Stat>
            <Stat label={next ? "Next study session" : "Studied in all"} value={next ? format(next, "EEE d MMM, HH:mm") : hours(total)}>
              <LogTime goal={goal} />
            </Stat>
          </div>
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader
            title="Study plan"
            subtitle={plan.length ? `${plan.filter((r) => isDone(r, tasks)).length} of ${plan.length} done` : "What you'll work through, in order."}
            action={
              <div className="flex flex-wrap justify-end gap-1">
                {aiReady && (
                  <Button size="sm" onClick={() => setCoaching(true)}>
                    <Sparkles className="size-3.5" /> Plan it for me
                  </Button>
                )}
                <Button size="sm" variant="primary" onClick={() => setFinding(true)}>
                  <Search className="size-3.5" /> Find material
                </Button>
              </div>
            }
          />
          {plan.length ? (
            <>
              <ul className="flex flex-col px-3 pb-2 pt-3">
                {plan.map((r, i) => (
                  <PlanRow key={r.id} r={r} goal={goal} first={i === 0} last={i === plan.length - 1} />
                ))}
              </ul>
              {plan.some((r) => !r.taskId && !isDone(r, tasks)) && goal.status === "active" && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-[13px] text-muted">
                  <span>Calendar can find time for these and remind you.</span>
                  <Button size="sm" onClick={() => plan.filter((r) => !r.taskId && !isDone(r, tasks)).forEach((r) => planAsTask(r, goal))}>
                    <CalendarPlus className="size-3.5" /> Put the rest on the Calendar
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="px-6 pb-6 pt-4 text-[14px] text-muted">
              Nothing yet. Find courses, talks and books on “{goal.topic}”{aiReady ? ", or let the assistant put a plan together from them." : "."}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Objectives goal={goal} />
          <NotesCard goal={goal} />
        </div>
      </div>

      <GoalDialog open={editing} onClose={() => setEditing(false)} goal={goal} />
      <Modal open={finding} onClose={() => setFinding(false)} title={`Find material · ${goal.title}`} size="lg" accent={ACCENT}>
        <Discover goalId={goal.id} initial={goal.topic} />
      </Modal>
      {coaching && <CoachDialog goal={goal} onClose={() => setCoaching(false)} />}
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "neg" | "pos" }) {
  return <span className={cn("rounded-full px-2.5 py-1 font-medium", tone === "neg" ? "bg-neg/10 text-neg" : tone === "pos" ? "bg-pos/10 text-pos" : "bg-sunken text-muted")}>{children}</span>;
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-sunken px-4 py-3">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className="font-serif text-2xl leading-none">{value}</div>
      {children}
    </div>
  );
}

/** Time studied away from a focus session. */
function LogTime({ goal }: { goal: Goal }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const log = useLearning((s) => s.log);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex w-fit items-center gap-1 text-[12px] font-medium text-muted hover:text-ink">
        <Clock className="size-3.5" /> Log time studied
      </button>
    );
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const m = Math.round(Number(minutes));
        if (m > 0 && m <= 600) log(goal.id, m);
        setOpen(false);
      }}
    >
      <Input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-8 w-16 text-[13px]" aria-label="Minutes studied" autoFocus />
      <span className="text-[12px] text-muted">min</span>
      <Button size="sm" type="submit">
        Log
      </Button>
    </form>
  );
}

function PlanRow({ r, goal, first, last }: { r: Resource; goal: Goal; first: boolean; last: boolean }) {
  const navigate = useNavigate();
  const tasks = useCalendar((s) => s.tasks);
  const plan = usePlan();
  const { move, removeResource } = useLearning.getState();
  const [more, setMore] = useState(false);
  const done = isDone(r, tasks);
  const task = r.taskId ? tasks.find((t) => t.id === r.taskId) : undefined;
  const slot = task && !task.done ? plan.byTask.get(task.id)?.slots[0] : undefined;

  const focus = () => {
    const taskId = planAsTask(r, goal);
    navigate(`/focus?${new URLSearchParams({ intention: `${KINDS[r.kind].verb} ${r.title}`, task: taskId })}`);
  };

  return (
    <li className={cn("group flex gap-3 rounded-2xl px-3 py-3 hover:bg-sunken/60", done && "opacity-60")}>
      <button
        onClick={() => setDone(r, !done)}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        className={cn("mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors", done ? "border-transparent text-white" : "border-line-strong hover:border-ink")}
        style={done ? { background: ACCENT } : undefined}
      >
        {done && <Check className="size-3.5" strokeWidth={3} />}
      </button>
      <Thumb item={r} className="hidden size-12 sm:flex" />
      <div className="min-w-0 flex-1">
        <a href={r.url} target="_blank" rel="noopener noreferrer" className={cn("line-clamp-2 text-[14px] font-medium leading-snug hover:underline", done && "line-through")}>
          {r.title}
        </a>
        <Meta item={r} />
        {r.why && <p className="mt-1 text-[13px] text-muted">{r.why}</p>}
        {task && !done && (
          <p className="mt-1 flex items-center gap-1 text-[12px] text-muted">
            <CalendarCheck className="size-3.5" />
            {slot ? `On the Calendar: ${format(parseDay(slot.date), "EEE d MMM")}, ${slot.start}` : "On the Calendar, waiting for free time"}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-0.5">
        {!done && (
          <button onClick={focus} title="Focus on it" aria-label="Focus on it" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink">
            <Timer className="size-4" />
          </button>
        )}
        <div className="relative">
          <button onClick={() => setMore(!more)} aria-label="More" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink">
            <MoreHorizontal className="size-4" />
          </button>
          {more && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMore(false)} />
              <div className="absolute right-0 top-9 z-20 flex w-56 flex-col rounded-2xl border border-line bg-raised p-1.5 text-[13px] shadow-float" onClick={() => setMore(false)}>
                {!done && !task && <MenuItem icon={CalendarPlus} label="Put on the Calendar" onClick={() => planAsTask(r, goal)} />}
                {task && !task.done && <MenuItem icon={X} label="Take off the Calendar" onClick={() => unplan(r)} />}
                <MenuItem icon={NotebookPen} label="Write a note on it" onClick={() => navigate(`/notes?id=${noteFor(goal, r)}`)} />
                {!first && <MenuItem icon={ArrowUp} label="Move up" onClick={() => move(r.id, -1)} />}
                {!last && <MenuItem icon={ArrowDown} label="Move down" onClick={() => move(r.id, 1)} />}
                <MenuItem
                  icon={Trash2}
                  label="Remove from plan"
                  danger
                  onClick={() => {
                    unplan(r);
                    removeResource(r.id);
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Plus; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-sunken", danger && "text-neg")}>
      <Icon className="size-4" /> {label}
    </button>
  );
}

function Objectives({ goal }: { goal: Goal }) {
  const updateGoal = useLearning((s) => s.updateGoal);
  const [text, setText] = useState("");
  const set = (objectives: Goal["objectives"]) => updateGoal(goal.id, { objectives });
  return (
    <Card>
      <CardHeader title="Milestones" subtitle="What you'll be able to do, step by step." />
      <ul className="flex flex-col px-3 pt-2">
        {goal.objectives.map((o) => (
          <li key={o.id} className="group flex items-start gap-2.5 rounded-xl px-3 py-2 hover:bg-sunken">
            <button
              onClick={() => set(goal.objectives.map((x) => (x.id === o.id ? { ...x, doneAt: x.doneAt ? undefined : Date.now() } : x)))}
              aria-label={o.doneAt ? "Mark as not reached" : "Mark as reached"}
              className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2", o.doneAt ? "border-transparent text-white" : "border-line-strong hover:border-ink")}
              style={o.doneAt ? { background: ACCENT } : undefined}
            >
              {o.doneAt && <Check className="size-3" strokeWidth={3} />}
            </button>
            <span className={cn("min-w-0 flex-1 text-sm", o.doneAt && "text-muted line-through")}>{o.text}</span>
            <button
              onClick={() => set(goal.objectives.filter((x) => x.id !== o.id))}
              aria-label="Remove milestone"
              className="rounded-md p-0.5 text-faint opacity-0 hover:text-neg group-hover:opacity-100 focus:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2 px-6 pb-5 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          set([...goal.objectives, { id: crypto.randomUUID(), text: text.trim() }]);
          setText("");
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Solve systems of equations with matrices" className="h-9 text-[13px]" />
        <Button size="sm" type="submit" disabled={!text.trim()} aria-label="Add milestone" className="h-9">
          <Plus className="size-4" />
        </Button>
      </form>
    </Card>
  );
}

function NotesCard({ goal }: { goal: Goal }) {
  const navigate = useNavigate();
  const group = notesGroupOf(goal);
  return (
    <Card>
      <CardHeader title="Notes" subtitle="What you learn goes in its own group in Notes." />
      <div className="flex flex-wrap gap-2 px-6 pb-5 pt-4">
        <Button size="sm" onClick={() => navigate(`/notes?id=${noteFor(goal)}`)}>
          <NotebookPen className="size-3.5" /> New note
        </Button>
        {group && (
          <Button size="sm" variant="ghost" onClick={() => navigate(`/notes?group=${group}`)}>
            Open the notes
          </Button>
        )}
      </div>
    </Card>
  );
}

/** One plan in the making per goal, shared (opening the dialog again, or React's double start in development, doesn't start another). */
const making = new Map<string, { promise: Promise<Suggestion>; step: string; listeners: Set<(s: string) => void> }>();
function planFor(goal: Goal, lang: "en" | "fr", onStep: (s: string) => void) {
  let job = making.get(goal.id);
  if (!job) {
    const fresh = { step: "Starting", listeners: new Set<(s: string) => void>(), promise: null as unknown as Promise<Suggestion> };
    fresh.promise = suggestPlan(goal, lang, (s) => {
      fresh.step = s;
      fresh.listeners.forEach((f) => f(s));
    }).finally(() => making.delete(goal.id));
    making.set(goal.id, (job = fresh));
  }
  job.listeners.add(onStep);
  onStep(job.step);
  return job.promise;
}

/** "Plan it for me": milestones and an ordered plan from what the sources actually have. */
function CoachDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const lang = useLearning((s) => s.lang);
  const assistant = useAssistant();
  const [step, setStep] = useState("Starting");
  const [result, setResult] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keepObj, setKeepObj] = useState<boolean[]>([]);
  const [keepPick, setKeepPick] = useState<boolean[]>([]);
  const [toCalendar, setToCalendar] = useState(goal.status === "active");
  useEffect(() => {
    let alive = true;
    planFor(goal, lang, (s) => alive && setStep(s)).then(
      (s) => {
        if (!alive) return;
        setResult(s);
        setKeepObj(s.objectives.map(() => true));
        setKeepPick(s.picks.map(() => true));
      },
      (e) => alive && setError(explain(e)),
    );
    return () => {
      alive = false;
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => {
    if (!result) return;
    const { add, updateGoal } = useLearning.getState();
    const objectives = result.objectives.filter((_, i) => keepObj[i]).map((text) => ({ id: crypto.randomUUID(), text }));
    if (objectives.length) updateGoal(goal.id, { objectives: [...goal.objectives, ...objectives] });
    for (const [i, p] of result.picks.entries()) {
      if (!keepPick[i]) continue;
      const id = add(p.found, goal.id, p.why);
      if (toCalendar) {
        const r = useLearning.getState().resources.find((x) => x.id === id)!;
        planAsTask(r, useLearning.getState().goals.find((g) => g.id === goal.id)!);
      }
    }
    onClose();
  };

  const toggle = (list: boolean[], set: (l: boolean[]) => void, i: number) => set(list.map((v, n) => (n === i ? !v : v)));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      accent={ACCENT}
      title={`A plan for “${goal.title}”`}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={apply} disabled={!keepObj.some(Boolean) && !keepPick.some(Boolean)}>
              Add to my plan
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {error ? "Close" : "Cancel"}
          </Button>
        )
      }
    >
      {error ? (
        <p className="text-[14px] text-neg">{error}</p>
      ) : !result ? (
        <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
          <Loader2 className="size-5 animate-spin" /> {assistant}: {step}…
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {result.advice && <p className="rounded-2xl bg-sunken p-4 text-[14px] leading-relaxed">{result.advice}</p>}
          {result.objectives.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold">Milestones</h3>
              {result.objectives.map((o, i) => (
                <label key={i} className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={keepObj[i]} onChange={() => toggle(keepObj, setKeepObj, i)} className="mt-1 accent-[#2f7d6d]" />
                  {o}
                </label>
              ))}
            </section>
          )}
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">Plan, in order</h3>
            {result.picks.length ? (
              <ol className="flex flex-col gap-1">
                {result.picks.map((p, i) => (
                  <li key={p.found.id}>
                    <label className="flex cursor-pointer gap-3 rounded-2xl px-2 py-2 hover:bg-sunken/60">
                      <input type="checkbox" checked={keepPick[i]} onChange={() => toggle(keepPick, setKeepPick, i)} className="mt-1 accent-[#2f7d6d]" />
                      <Thumb item={p.found} className="size-11" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium leading-snug">{p.found.title}</div>
                        <Meta item={p.found} />
                        <p className="mt-0.5 text-[13px] text-muted">{p.why}</p>
                      </div>
                    </label>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[14px] text-muted">Nothing suitable turned up in the open catalogues. Try “Find material” with other words.</p>
            )}
          </section>
          {result.picks.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={toCalendar} onChange={(e) => setToCalendar(e.target.checked)} className="accent-[#2f7d6d]" />
              Put them on the Calendar as Learning tasks{goal.targetDate ? `, due by ${format(parseDay(goal.targetDate), "d MMM")}` : ""}
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}
