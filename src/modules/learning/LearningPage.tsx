import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { differenceInCalendarDays, format } from "date-fns";
import { ArrowUpRight, Bookmark, CalendarClock, GraduationCap, Plus, Search, Timer, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, PageHeader, Progress, Segmented } from "@/components/ui";
import { parseDay } from "@/lib/dates";
import { swatch } from "@/lib/utils";
import { useCalendar } from "@/modules/calendar/store";
import { hours, useFocus } from "@/modules/focus/store";
import { KINDS } from "./sources";
import { nextSession, nextUp, planAsTask, planOf, progress, studied, useLearning, weekStart, type Goal } from "./store";
import { Discover } from "./Discover";
import { GoalDialog } from "./GoalDialog";
import { GoalView } from "./GoalView";
import { ACCENT, Meta, Thumb } from "./parts";

type Tab = "goals" | "discover" | "saved";

export function LearningPage() {
  const [params, setParams] = useSearchParams();
  const goals = useLearning((s) => s.goals);
  const saved = useLearning((s) => s.resources.filter((r) => !r.goalId).length);
  const [creating, setCreating] = useState(false);
  const goal = goals.find((g) => g.id === params.get("goal"));
  const tab = (["goals", "discover", "saved"].includes(params.get("tab") ?? "") ? params.get("tab") : "goals") as Tab;
  const go = (p: Record<string, string>) => setParams(p);

  if (goal) return <GoalView goal={goal} onBack={() => go({})} />;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Read, watch & listen"
        title="Learning"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New goal
          </Button>
        }
      />
      <Segmented<Tab>
        layoutId="learning-tab"
        value={tab}
        onChange={(t) => go(t === "goals" ? {} : { tab: t })}
        className="w-fit"
        options={[
          { value: "goals", label: "Goals" },
          { value: "discover", label: "Discover" },
          { value: "saved", label: `Saved${saved ? ` · ${saved}` : ""}` },
        ]}
      />
      {tab === "goals" && <Goals onNew={() => setCreating(true)} onOpen={(id) => go({ goal: id })} onDiscover={() => go({ tab: "discover" })} />}
      {tab === "discover" && (
        <Card className="p-6">
          <Discover initial={params.get("q") ?? undefined} />
        </Card>
      )}
      {tab === "saved" && <Saved onDiscover={() => go({ tab: "discover" })} />}
      <GoalDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => go({ goal: id })} />
    </div>
  );
}

/* ---------- Goals ---------- */

function Goals({ onNew, onOpen, onDiscover }: { onNew: () => void; onOpen: (id: string) => void; onDiscover: () => void }) {
  const goals = useLearning((s) => s.goals);
  const resources = useLearning((s) => s.resources);
  const tasks = useCalendar((s) => s.tasks);
  useFocus((s) => s.sessions);
  const active = goals.filter((g) => g.status === "active");
  const rest = goals.filter((g) => g.status !== "active");

  if (!goals.length)
    return (
      <Card>
        <EmptyState
          icon={<GraduationCap className="size-5" />}
          title="What do you want to learn?"
          body="Set a goal, find free courses, talks and books for it, and Haven keeps you at it: study sessions with reminders, learning tasks on your Calendar, milestones and notes."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={onNew}>
                <Plus className="size-4" /> New goal
              </Button>
              <Button onClick={onDiscover}>
                <Search className="size-4" /> Just browse
              </Button>
            </div>
          }
        />
      </Card>
    );

  const week = weekStart();
  const weekDone = active.reduce((n, g) => n + studied(g, resources, week), 0);
  const weekWant = active.reduce((n, g) => n + g.weeklyMinutes, 0);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-6">
        {active.length > 0 && <UpNext goals={active} onOpen={onOpen} />}
        <div className="grid gap-4 sm:grid-cols-2">
          {active.map((g) => (
            <GoalCard key={g.id} goal={g} done={progress(g, resources, tasks)} onOpen={() => onOpen(g.id)} />
          ))}
        </div>
        {rest.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold text-muted">Paused and achieved</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {rest.map((g) => (
                <GoalCard key={g.id} goal={g} done={progress(g, resources, tasks)} onOpen={() => onOpen(g.id)} />
              ))}
            </div>
          </section>
        )}
      </div>
      {active.length > 0 && (
        <Card>
          <CardHeader title="This week" subtitle={`${hours(weekDone)} of ${hours(weekWant)} studied`} />
          <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
            <Progress value={Math.min(1, weekDone / Math.max(1, weekWant))} color={ACCENT} />
            {active.map((g) => {
              const m = studied(g, resources, week);
              return (
                <div key={g.id} className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="truncate">{g.title}</span>
                    <span className="shrink-0 text-muted">
                      {hours(m)} / {hours(g.weeklyMinutes)}
                    </span>
                  </div>
                  <Progress value={Math.min(1, m / Math.max(1, g.weeklyMinutes))} color={swatch(g.color).fg} />
                </div>
              );
            })}
            <p className="text-[12px] text-faint">Counts focus sessions on a goal's tasks, items you tick off, and time you log.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

function UpNext({ goals, onOpen }: { goals: Goal[]; onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  const resources = useLearning((s) => s.resources);
  const tasks = useCalendar((s) => s.tasks);
  const items = goals.map((g) => ({ goal: g, r: nextUp(g.id, resources, tasks) }));
  return (
    <Card>
      <CardHeader title="Up next" subtitle="The next step in each goal." />
      <ul className="flex flex-col px-3 pb-3 pt-2">
        {items.map(({ goal, r }) => (
          <li key={goal.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-sunken/60">
            {r ? <Thumb item={r} className="size-11" /> : <div className="size-11 shrink-0 rounded-xl" style={{ background: swatch(goal.color).soft }} />}
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium" style={{ color: swatch(goal.color).fg }}>
                {goal.title}
              </div>
              {r ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="line-clamp-1 text-[14px] font-medium hover:underline">
                  {KINDS[r.kind].verb} {r.title}
                </a>
              ) : (
                <button onClick={() => onOpen(goal.id)} className="text-[14px] text-muted hover:text-ink">
                  Nothing planned yet: find material →
                </button>
              )}
            </div>
            {r && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const task = planAsTask(r, goal);
                  navigate(`/focus?${new URLSearchParams({ intention: `${KINDS[r.kind].verb} ${r.title}`, task })}`);
                }}
              >
                <Timer className="size-3.5" /> Focus
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GoalCard({ goal, done, onOpen }: { goal: Goal; done: number; onOpen: () => void }) {
  const resources = useLearning((s) => s.resources);
  const color = swatch(goal.color).fg;
  const next = goal.status === "active" ? nextSession(goal) : null;
  const left = goal.targetDate ? differenceInCalendarDays(parseDay(goal.targetDate), new Date()) : null;
  const count = planOf(goal.id, resources).length;
  return (
    <button onClick={onOpen} className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 text-left shadow-card transition-colors hover:border-line-strong">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="font-serif text-xl leading-snug">{goal.title}</div>
          {goal.why && <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{goal.why}</div>}
        </div>
        {goal.status !== "active" && <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-muted">{goal.status === "done" ? "Achieved" : "Paused"}</span>}
      </div>
      <Progress value={done} color={color} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
        <span>{Math.round(done * 100)}%</span>
        <span>
          {count} item{count === 1 ? "" : "s"} · {goal.objectives.length} milestone{goal.objectives.length === 1 ? "" : "s"}
        </span>
        {left !== null && goal.status !== "done" && <span className={left < 0 ? "text-neg" : ""}>{left >= 0 ? `${left} day${left === 1 ? "" : "s"} left` : "past its date"}</span>}
        {next && (
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3.5" /> {format(next, "EEE HH:mm")}
          </span>
        )}
      </div>
    </button>
  );
}

/* ---------- Saved ---------- */

function Saved({ onDiscover }: { onDiscover: () => void }) {
  const resources = useLearning((s) => s.resources);
  const goals = useLearning((s) => s.goals).filter((g) => g.status !== "done");
  const { removeResource: remove, updateResource } = useLearning.getState();
  const saved = resources.filter((r) => !r.goalId).sort((a, b) => b.addedAt - a.addedAt);
  const moveTo = (id: string, goalId: string) =>
    updateResource(id, { goalId, order: Math.max(0, ...resources.filter((r) => r.goalId === goalId).map((r) => r.order + 1)) });
  if (!saved.length)
    return (
      <Card>
        <EmptyState
          icon={<Bookmark className="size-5" />}
          title="Nothing saved yet"
          body="Things you save while browsing wait here until you add them to a goal."
          action={
            <Button onClick={onDiscover}>
              <Search className="size-4" /> Discover
            </Button>
          }
        />
      </Card>
    );
  return (
    <Card>
      <ul className="flex flex-col p-3">
        {saved.map((r) => (
          <li key={r.id} className="group flex gap-3 rounded-2xl px-3 py-3 hover:bg-sunken/60">
            <Thumb item={r} className="size-14" />
            <div className="min-w-0 flex-1">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-[14px] font-medium leading-snug hover:underline">
                <span className="line-clamp-2">{r.title}</span> <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-faint" />
              </a>
              <Meta item={r} />
              {r.description && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{r.description}</p>}
            </div>
            <div className="flex shrink-0 items-start gap-1">
              {goals.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && moveTo(r.id, e.target.value)}
                  aria-label="Move to a goal"
                  className="h-8 max-w-36 cursor-pointer rounded-lg border border-line bg-surface px-2 text-[12px] text-muted hover:text-ink"
                >
                  <option value="">Move to goal…</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={() => remove(r.id)} aria-label="Remove" title="Remove" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-neg">
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
