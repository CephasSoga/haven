import { useMemo, useState } from "react";
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, format, getDay, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton, Modal, Segmented } from "@/components/ui";
import { dayKey } from "@/lib/dates";
import { cn, swatch } from "@/lib/utils";
import { buildBlocks, usePlan, type Block } from "./plan";
import { TASK_TYPES, formatDuration, toMinutes, useCalendar } from "./store";

type Period = "week" | "month";

const EVENTS = "var(--cal)";
const TASKS = swatch("teal").fg;

const minutesOf = (b: Block) => (b.start && b.end ? Math.max(0, toMinutes(b.end) - toMinutes(b.start)) : 0);
const hours = (min: number) => formatDuration(Math.round(min));

/** Where your time goes in a week or a month: events, planned and finished tasks, and how full your working hours are. */
export function TimeInsights({ open, onClose, cursor, weekStartsOn }: { open: boolean; onClose: () => void; cursor: Date; weekStartsOn: 0 | 1 }) {
  const { events, tasks, prefs } = useCalendar();
  const plan = usePlan();
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(cursor);
  const [prevCursor, setPrevCursor] = useState(cursor);
  // Opening the window again starts from wherever the calendar is.
  if (cursor !== prevCursor) {
    setPrevCursor(cursor);
    setAnchor(cursor);
  }

  const days = useMemo(() => {
    if (period === "week") {
      const s = startOfWeek(anchor, { weekStartsOn });
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    return eachDayOfInterval({ start: startOfMonth(anchor), end: endOfMonth(anchor) });
  }, [period, anchor, weekStartsOn]);

  const stats = useMemo(() => {
    const blocks = buildBlocks(days, events, tasks, plan);
    const typeOf = new Map(tasks.map((t) => [t.id, t.type]));
    const perDay = days.map((d) => ({ day: d, events: 0, tasks: 0 }));
    const byType = new Map<string, number>();
    const byEvent = new Map<string, { title: string; color: string; min: number; count: number }>();
    let done = 0;
    let capacity = 0;
    let booked = 0;

    days.forEach((d, i) => {
      const work = prefs.work[getDay(d)];
      const ws = work.on ? toMinutes(work.start) : 0;
      const we = work.on ? toMinutes(work.end) : 0;
      capacity += we - ws;
      for (const b of blocks.get(dayKey(d)) ?? []) {
        const min = minutesOf(b);
        if (!min) continue;
        // Overlap with that day's working hours, for "how full is my week".
        if (work.on) booked += Math.max(0, Math.min(we, toMinutes(b.end!)) - Math.max(ws, toMinutes(b.start!)));
        if (b.kind === "event") {
          perDay[i].events += min;
          const key = b.title.trim().toLowerCase() || "untitled";
          const e = byEvent.get(key) ?? { title: b.title.trim() || "Untitled", color: b.color, min: 0, count: 0 };
          byEvent.set(key, { ...e, min: e.min + min, count: e.count + 1 });
        } else if (b.kind === "task") {
          perDay[i].tasks += min;
          const type = typeOf.get(b.id) ?? "personal";
          byType.set(type, (byType.get(type) ?? 0) + min);
          if (b.done) done += min;
        }
      }
    });

    const eventsMin = perDay.reduce((s, d) => s + d.events, 0);
    const tasksMin = perDay.reduce((s, d) => s + d.tasks, 0);
    const busiest = perDay.reduce((a, b) => (b.events + b.tasks > a.events + a.tasks ? b : a), perDay[0]);
    return {
      perDay,
      eventsMin,
      tasksMin,
      total: eventsMin + tasksMin,
      done,
      capacity,
      booked: Math.min(booked, capacity),
      busiest: busiest && busiest.events + busiest.tasks > 0 ? busiest : null,
      types: [...byType.entries()].map(([type, min]) => ({ type, min })).sort((a, b) => b.min - a.min),
      topEvents: [...byEvent.values()].sort((a, b) => b.min - a.min).slice(0, 6),
      eventCount: [...byEvent.values()].reduce((s, e) => s + e.count, 0),
    };
  }, [days, events, tasks, plan, prefs]);

  const step = (dir: 1 | -1) => setAnchor((a) => (period === "week" ? addWeeks(a, dir) : addMonths(a, dir)));
  const first = days[0];
  const last = days[days.length - 1];
  const label =
    period === "month" ? format(first, "MMMM yyyy") : `${format(first, "MMM d")} – ${format(last, isSameMonth(first, last) ? "d, yyyy" : "MMM d, yyyy")}`;
  const usedDays = stats.perDay.filter((d) => d.events + d.tasks > 0).length;
  const full = stats.capacity ? stats.booked / stats.capacity : 0;

  return (
    <Modal open={open} onClose={onClose} title="Where your time goes" size="lg" accent="var(--cal)">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            layoutId="insights-period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
          <div className="flex items-center rounded-xl border border-line bg-surface shadow-soft">
            <IconButton label={`Previous ${period}`} onClick={() => step(-1)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span className="min-w-[150px] px-1 text-center text-[13px] font-medium tabular">{label}</span>
            <IconButton label={`Next ${period}`} onClick={() => step(1)}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
        </div>

        {stats.total === 0 ? (
          <div className="rounded-2xl bg-sunken px-5 py-10 text-center text-sm text-muted">Nothing scheduled in this {period}.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Scheduled" value={hours(stats.total)} hint={usedDays ? `≈ ${hours(stats.total / usedDays)} a day` : undefined} />
              <Tile label="In events" value={hours(stats.eventsMin)} hint={`${stats.eventCount} ${stats.eventCount === 1 ? "event" : "events"}`} dot={EVENTS} />
              <Tile label="On tasks" value={hours(stats.tasksMin)} hint={`${hours(stats.done)} done`} dot={TASKS} />
              <Tile
                label="Working hours booked"
                value={stats.capacity ? `${Math.round(full * 100)}%` : "—"}
                hint={stats.capacity ? `${hours(stats.capacity - stats.booked)} still free` : "No working hours set"}
              />
            </div>

            <DayBars data={stats.perDay} compact={period === "month"} />

            <div className="grid gap-6 sm:grid-cols-2">
              <Breakdown
                title="Tasks by type"
                empty="No tasks in this period."
                rows={stats.types.map((t) => ({
                  key: t.type,
                  label: TASK_TYPES[t.type]?.label ?? t.type,
                  color: swatch(TASK_TYPES[t.type]?.color ?? "slate").fg,
                  min: t.min,
                }))}
                total={stats.tasksMin}
              />
              <Breakdown
                title="Events taking the most time"
                empty="No timed events in this period."
                rows={stats.topEvents.map((e) => ({
                  key: e.title,
                  label: e.count > 1 ? `${e.title} ×${e.count}` : e.title,
                  color: swatch(e.color).fg,
                  min: e.min,
                }))}
                total={stats.eventsMin}
              />
            </div>

            {stats.busiest && (
              <p className="text-[13px] text-muted">
                Busiest day: <span className="font-medium text-ink">{format(stats.busiest.day, "EEEE, MMM d")}</span> with{" "}
                {hours(stats.busiest.events + stats.busiest.tasks)} scheduled. Times count events with a start and end, and tasks where the
                planner placed them (or where you finished them).
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Tile({ label, value, hint, dot }: { label: string; value: string; hint?: string; dot?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
        {label}
      </div>
      <div className="mt-2 font-serif text-[28px] leading-none tabular">{value}</div>
      {hint && <div className="mt-1 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

function DayBars({ data, compact }: { data: { day: Date; events: number; tasks: number }[]; compact: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(60, ...data.map((d) => d.events + d.tasks));
  const shown = hover !== null ? data[hover] : null;
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: EVENTS }} /> Events
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: TASKS }} /> Tasks
        </span>
        <span className="ml-auto h-4 text-ink tabular">
          {shown && (
            <>
              <span className="text-muted">{format(shown.day, "EEE d")}: </span>
              {hours(shown.events)} events · {hours(shown.tasks)} tasks
            </>
          )}
        </span>
      </div>
      <div className="relative h-36">
        {[0.5, 1].map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />
        ))}
        <div className={cn("absolute inset-0 flex items-end border-b border-line-strong", compact ? "gap-[3px]" : "gap-2")}>
          {data.map((d, i) => (
            <div key={i} className="relative flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className={cn("absolute inset-x-0 -bottom-px top-0 rounded-t-lg transition-colors", hover === i && "bg-sunken")} />
              <motion.div
                className="relative mx-auto flex w-full max-w-8 flex-col justify-end overflow-hidden rounded-t-[4px]"
                initial={{ height: 0 }}
                animate={{ height: `${((d.events + d.tasks) / max) * 100}%` }}
                transition={{ type: "spring", bounce: 0, duration: 0.7, delay: i * (compact ? 0.01 : 0.04) }}
              >
                <div style={{ background: TASKS, flexGrow: d.tasks, flexBasis: 0 }} />
                <div style={{ background: EVENTS, flexGrow: d.events, flexBasis: 0 }} />
              </motion.div>
            </div>
          ))}
        </div>
      </div>
      <div className={cn("mt-2 flex", compact ? "gap-[3px]" : "gap-2")}>
        {data.map((d, i) => (
          <div key={i} className={cn("flex-1 text-center text-[11px] font-medium", isToday(d.day) ? "text-ink" : "text-faint")}>
            {compact ? (i % 7 === 0 || isToday(d.day) ? format(d.day, "d") : "") : format(d.day, "EEE")}
          </div>
        ))}
      </div>
    </div>
  );
}

function Breakdown({ title, rows, total, empty }: { title: string; rows: { key: string; label: string; color: string; min: number }[]; total: number; empty: string }) {
  return (
    <div>
      <h4 className="mb-3 text-[13px] font-semibold">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={r.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate font-medium">{r.label}</span>
                <span className="shrink-0 text-muted tabular">
                  {hours(r.min)} · {Math.round((r.min / Math.max(total, 1)) * 100)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: r.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.min / Math.max(total, 1)) * 100}%` }}
                  transition={{ type: "spring", bounce: 0, duration: 0.7, delay: i * 0.05 }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
