import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNowStrict, isToday } from "date-fns";
import { Check, CirclePlus, Coffee, ListPlus, Pause, Play, Plus, Square, Trash2, Volume2, X } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, PageHeader, Progress, Segmented, Select } from "@/components/ui";
import { ask } from "@/components/confirm";
import { cn } from "@/lib/utils";
import { dayKey } from "@/lib/dates";
import { onAndroid } from "@/lib/platform";
import { expandEvents, formatTime, PRIORITIES, toMinutes, useCalendar } from "@/modules/calendar/store";
import { NOISES, useFocusSound, type Noise } from "./sound";
import { clock, focusedMs, hours, lastWeek, OUTCOMES, remainingMs, streak, useFocus, type Outcome, type Session } from "./store";

const ACCENT = "#e0803a";

export function FocusPage() {
  const active = useFocus((s) => s.active);
  const review = useFocus((s) => s.review);
  const breakUntil = useFocus((s) => s.breakUntil);
  const reviewed = useFocus((s) => s.sessions.find((x) => x.id === review));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Work" title="Focus" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          {active ? (
            <Running />
          ) : (
            <>
              {breakUntil && <BreakCard until={breakUntil} />}
              {reviewed ? <Review session={reviewed} /> : <Setup />}
            </>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <TodayCard />
          <Thoughts />
          <Recent />
        </div>
      </div>
    </div>
  );
}

/* ---------- Ticking ---------- */

function useTick(on: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

/* ---------- Setting up ---------- */

const LENGTHS = ["25", "50", "90", "custom"] as const;
type Length = (typeof LENGTHS)[number];

function Setup() {
  const tasks = useCalendar((s) => s.tasks);
  const events = useCalendar((s) => s.events);
  const start = useFocus((s) => s.start);
  const [intention, setIntention] = useState("");
  const [taskId, setTaskId] = useState("");
  const [length, setLength] = useState<Length>("50");
  const [custom, setCustom] = useState("40");
  const [breakMin, setBreakMin] = useState("10");
  const [cap, setCap] = useState<number | null>(null);

  const open = useMemo(() => tasks.filter((t) => !t.done).sort((a, b) => PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank || a.title.localeCompare(b.title)), [tasks]);
  const chosen = length === "custom" ? Math.max(5, Math.min(240, Number(custom) || 0)) : Number(length);
  const planned = cap ?? chosen;

  // Something on the calendar before the session would end?
  const clash = useMemo(() => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today = expandEvents(events, [now]).get(dayKey(now)) ?? [];
    const next = today.find((e) => e.start && toMinutes(e.start) > nowMin && toMinutes(e.start) < nowMin + chosen);
    return next ? { title: next.title, start: next.start!, minutes: toMinutes(next.start!) - nowMin } : null;
  }, [events, chosen]);
  useEffect(() => setCap(null), [chosen]);

  const go = () => start({ intention: intention || open.find((t) => t.id === taskId)?.title || "", taskId: taskId || undefined, planned, breakMin: Number(breakMin) });

  return (
    <Card>
      <CardHeader title="Start a session" subtitle="One thing, one block of time. Haven keeps the clock and holds the rest." />
      <div className="flex flex-col gap-5 px-6 pb-6 pt-5">
        <Field label="What will you finish?">
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={intention}
              onChange={(e) => setIntention(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="e.g. Draft the introduction of the report"
            />
          )}
        </Field>
        {open.length > 0 && (
          <Field label="For a task (optional)">
            {(id) => (
              <Select id={id} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">None</option>
                {open.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="flex flex-wrap gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted">Length</span>
            <div className="flex items-center gap-2">
              <Segmented<Length>
                layoutId="focus-length"
                value={length}
                onChange={setLength}
                options={LENGTHS.map((l) => ({ value: l, label: <span className="whitespace-nowrap">{l === "custom" ? "Other" : `${l} min`}</span> }))}
              />
              {length === "custom" && (
                <Input type="number" min={5} max={240} value={custom} onChange={(e) => setCustom(e.target.value)} className="h-10 w-20" aria-label="Minutes" />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted">Break after</span>
            <Segmented
              layoutId="focus-break"
              value={breakMin}
              onChange={setBreakMin}
              options={["0", "5", "10", "15"].map((b) => ({ value: b, label: <span className="whitespace-nowrap">{b === "0" ? "None" : `${b} min`}</span> }))}
            />
          </div>
        </div>

        {clash && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3 text-[13px]">
            <span>
              <span className="font-medium">{clash.title}</span> starts at {formatTime(clash.start)}, before this session would end.
            </span>
            {clash.minutes > 10 &&
              (cap ? (
                <span className="text-muted">Shortened to {cap} min</span>
              ) : (
                <Button size="sm" onClick={() => setCap(clash.minutes - 5)}>
                  Stop 5 min before ({clash.minutes - 5} min)
                </Button>
              ))}
          </div>
        )}

        <SoundPicker />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="max-w-sm text-[13px] text-muted">
            {onAndroid
              ? "Tip: turn on Do Not Disturb on your phone for the length of the session."
              : "While you focus, bill, subscription and release reminders wait until you're done. Event and task reminders still come."}
          </p>
          <Button variant="primary" onClick={go}>
            <Play className="size-4" fill="currentColor" /> Start {planned} min
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ---------- Running ---------- */

function Running() {
  const a = useFocus((s) => s.active)!;
  const { pause, resume, extend, finish, discard, park } = useFocus.getState();
  const task = useCalendar((s) => s.tasks.find((t) => t.id === a.taskId));
  const [thought, setThought] = useState("");
  useTick(!!a.runningSince);

  const left = remainingMs(a);
  const done = Math.min(1, focusedMs(a) / (a.planned * 60_000));
  const paused = !a.runningSince;
  const R = 112;
  const C = 2 * Math.PI * R;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col items-center gap-6 px-6 pb-6 pt-8">
        <div className="relative size-[260px]">
          <svg viewBox="0 0 260 260" className="size-full -rotate-90">
            <circle cx="130" cy="130" r={R} fill="none" stroke="var(--sunken)" strokeWidth="10" />
            <circle
              cx="130"
              cy="130"
              r={R}
              fill="none"
              stroke={ACCENT}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - done)}
              style={{ transition: "stroke-dashoffset 1s linear", opacity: paused ? 0.45 : 1 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="tabular font-serif text-6xl leading-none">{clock(left)}</div>
            <div className="mt-2 text-[13px] text-muted">{paused ? "Paused" : `of ${a.planned} min`}</div>
          </div>
        </div>

        <div className="max-w-md text-center">
          {a.intention ? <p className="font-serif text-2xl leading-snug">{a.intention}</p> : <p className="text-muted">Focusing</p>}
          {task && task.title !== a.intention && <p className="mt-1 text-[13px] text-muted">For “{task.title}”</p>}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {paused ? (
            <Button variant="primary" onClick={resume}>
              <Play className="size-4" fill="currentColor" /> Resume
            </Button>
          ) : (
            <Button variant="primary" onClick={pause}>
              <Pause className="size-4" fill="currentColor" /> Pause
            </Button>
          )}
          <Button onClick={() => extend(5)}>
            <Plus className="size-4" /> 5 min
          </Button>
          <Button onClick={finish}>
            <Square className="size-3.5" fill="currentColor" /> Finish
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              if (await ask({ title: "Discard this session?", body: "It won't count in your focus time. Thoughts parked in it are lost.", confirmLabel: "Discard", danger: true })) discard();
            }}
          >
            Discard
          </Button>
        </div>
      </div>

      <div className="border-t border-line px-6 py-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            park(thought);
            setThought("");
          }}
        >
          <Input value={thought} onChange={(e) => setThought(e.target.value)} placeholder="Something popped into your head? Park it here and carry on." />
          <Button type="submit" disabled={!thought.trim()} aria-label="Park the thought">
            <ListPlus className="size-4" />
          </Button>
        </form>
        {a.thoughts.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-[13px] text-muted">
            {a.thoughts.map((t, i) => (
              <li key={i}>· {t}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-6 py-5">
        <SoundPicker />
      </div>
    </Card>
  );
}

function SoundPicker() {
  const { noise, volume, set } = useFocusSound();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Volume2 className="size-4 text-muted" />
      <Segmented<Noise> layoutId="focus-noise" value={noise} onChange={(n) => set({ noise: n })} options={NOISES} />
      {noise !== "off" && (
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => set({ volume: Number(e.target.value) })}
          aria-label="Volume"
          className="w-28 accent-[#e0803a]"
        />
      )}
    </div>
  );
}

/* ---------- After ---------- */

function BreakCard({ until }: { until: number }) {
  useTick(true);
  return (
    <Card className="flex items-center justify-between gap-4 px-6 py-4">
      <div className="flex items-center gap-3">
        <Coffee className="size-5 text-pos" />
        <div>
          <div className="font-medium">Break · {clock(Math.max(0, until - Date.now()))}</div>
          <div className="text-[13px] text-muted">Stand up, look away from the screen, drink some water.</div>
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={() => useFocus.getState().endBreak()}>
        Skip
      </Button>
    </Card>
  );
}

function Review({ session }: { session: Session }) {
  const reflect = useFocus((s) => s.reflect);
  const task = useCalendar((s) => s.tasks.find((t) => t.id === session.taskId));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [quality, setQuality] = useState<number | undefined>();
  const [closeTask, setCloseTask] = useState(true);

  const save = () => {
    if (!outcome) return;
    reflect(session.id, outcome, quality);
    if (outcome === "done" && task && !task.done && closeTask) {
      const hhmm = (t: number) => format(t, "HH:mm");
      useCalendar.getState().completeTask(task.id, [{ date: dayKey(new Date(session.start)), start: hhmm(session.start), end: hhmm(session.end) }]);
    }
  };

  return (
    <Card>
      <CardHeader title="How did it go?" subtitle={`${hours(session.focused)} of focus${session.intention ? ` on “${session.intention}”` : ""}.`} />
      <div className="flex flex-col gap-5 px-6 pb-6 pt-5">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(OUTCOMES) as Outcome[]).map((o) => (
            <button
              key={o}
              onClick={() => setOutcome(o)}
              className={cn("rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors", outcome === o ? "border-ink bg-ink text-canvas" : "border-line hover:border-line-strong")}
            >
              {OUTCOMES[o]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-muted">How focused were you?</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((q) => (
              <button
                key={q}
                onClick={() => setQuality(quality === q ? undefined : q)}
                aria-label={`${q} out of 5`}
                className={cn("size-7 rounded-full border text-[12px] font-medium transition-colors", quality && q <= quality ? "border-transparent text-white" : "border-line text-muted hover:border-line-strong")}
                style={quality && q <= quality ? { background: ACCENT } : undefined}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        {outcome === "done" && task && !task.done && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={closeTask} onChange={(e) => setCloseTask(e.target.checked)} className="accent-[#e0803a]" />
            Mark “{task.title}” as done in Calendar
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => reflect(session.id, outcome ?? "partly")}>
            Skip
          </Button>
          <Button variant="primary" disabled={!outcome} onClick={save}>
            <Check className="size-4" /> Save
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ---------- Side ---------- */

const GOALS = [60, 120, 180, 240, 300, 360];

function TodayCard() {
  const sessions = useFocus((s) => s.sessions);
  const goal = useFocus((s) => s.goal);
  const setGoal = useFocus((s) => s.setGoal);
  const week = lastWeek(sessions);
  const today = week[6].minutes;
  const count = sessions.filter((s) => isToday(s.start)).length;
  const days = streak(sessions);
  const top = Math.max(goal, ...week.map((d) => d.minutes));

  return (
    <Card>
      <CardHeader
        title="Today"
        subtitle={`${count} session${count === 1 ? "" : "s"}${days > 1 ? ` · ${days}-day streak` : ""}`}
        action={
          <Select value={goal} onChange={(e) => setGoal(Number(e.target.value))} className="h-8 w-28 text-[13px]" aria-label="Daily goal">
            {GOALS.map((g) => (
              <option key={g} value={g}>
                Goal {hours(g)}
              </option>
            ))}
          </Select>
        }
      />
      <div className="flex flex-col gap-5 px-6 pb-6 pt-4">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-serif text-3xl">{hours(today)}</span>
            <span className="text-[13px] text-muted">{today >= goal ? "Goal reached" : `${hours(goal - today)} to go`}</span>
          </div>
          <Progress value={today / goal} color={ACCENT} />
        </div>
        <div className="flex h-24 items-end gap-2" aria-label="Focus over the last 7 days">
          {week.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5" title={`${format(d.day, "EEEE")}: ${hours(d.minutes)}`}>
              <div className="relative flex w-full flex-1 items-end">
                <div className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${(goal / top) * 100}%` }} />
                <div className="w-full rounded-md" style={{ height: `${Math.max(d.minutes ? 4 : 2, (d.minutes / top) * 100)}%`, background: d.minutes ? ACCENT : "var(--sunken)", opacity: i === 6 ? 1 : 0.6 }} />
              </div>
              <span className="text-[11px] text-faint">{format(d.day, "EEEEE")}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Thoughts() {
  const sessions = useFocus((s) => s.sessions);
  const dropThought = useFocus((s) => s.dropThought);
  const items = sessions.flatMap((s) => s.thoughts.map((text, index) => ({ session: s.id, index, text })));
  if (!items.length) return null;

  const toTask = (session: string, index: number, title: string) => {
    useCalendar.getState().saveTask({ title, duration: 30, priority: "medium", type: "admin", schedule: "work" });
    dropThought(session, index);
  };

  return (
    <Card>
      <CardHeader title="Parked thoughts" subtitle="What came up while you focused." />
      <ul className="flex flex-col px-3 pb-3 pt-2">
        {items.map((t) => (
          <li key={`${t.session}-${t.index}`} className="group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-sunken">
            <span className="min-w-0 flex-1 text-sm">{t.text}</span>
            <button onClick={() => toTask(t.session, t.index, t.text)} title="Make it a task" aria-label="Make it a task" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink">
              <CirclePlus className="size-4" />
            </button>
            <button onClick={() => dropThought(t.session, t.index)} title="Let it go" aria-label="Let it go" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink">
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Recent() {
  const sessions = useFocus((s) => s.sessions);
  const remove = useFocus((s) => s.removeSession);
  if (!sessions.length) return null;
  return (
    <Card>
      <CardHeader title="Recent sessions" />
      <ul className="flex flex-col px-3 pb-3 pt-2">
        {[...sessions].sort((a, b) => b.end - a.end).slice(0, 8).map((s) => (
          <li key={s.id} className="group flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-sunken">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{s.intention || "Focus session"}</div>
              <div className="text-[12px] text-muted">
                {formatDistanceToNowStrict(s.end, { addSuffix: true })} · {hours(s.focused)}
                {s.outcome ? ` · ${OUTCOMES[s.outcome]}` : ""}
              </div>
            </div>
            <button
              onClick={async () => {
                if (await ask({ title: "Delete this session?", body: "It's removed from your focus time.", confirmLabel: "Delete", danger: true })) remove(s.id);
              }}
              aria-label="Delete session"
              className="rounded-lg p-1.5 text-muted opacity-0 hover:bg-surface hover:text-neg group-hover:opacity-100 focus:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
