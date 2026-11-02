import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button, IconButton, PageHeader, Segmented } from "@/components/ui";
import { useSettings } from "@/store/settings";
import { dayKey, parseDay } from "@/lib/dates";
import { fromMinutes, useCalendar, toMinutes, type EventDraft, type Task, type TaskDraft } from "./store";
import { buildBlocks, slotsUntilNow, usePlan, type Block } from "./plan";
import { MonthView } from "./MonthView";
import { TimeGrid } from "./TimeGrid";
import { TaskPanel } from "./TaskPanel";
import { EventDialog } from "./EventDialog";
import { TaskDialog, newTaskDraft } from "./TaskDialog";
import { HoursDialog } from "./HoursDialog";
import { dueBlocks, mergeBlocks } from "./dues";
import { useNavigate } from "react-router";
import { formatMoney } from "@/lib/money";
import { useFinance } from "@/modules/finances/store";
import { useSubscriptions } from "@/modules/subscriptions/store";
import { BillDialog, type BillDraft } from "@/modules/finances/BillsTab";

type View = "day" | "week" | "month";

export function CalendarPage() {
  const { events, tasks, prefs, save, saveTask, completeTask, reopenTask } = useCalendar();
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const plan = usePlan();
  const [view, setView] = useState<View>(() => (window.innerWidth < 768 ? "day" : "week"));
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [billDraft, setBillDraft] = useState<BillDraft | null>(null);
  const bills = useFinance((s) => s.bills);
  const subs = useSubscriptions((s) => s.subs);
  const currency = useSettings((s) => s.currency);
  const navigate = useNavigate();

  const days = useMemo(() => {
    if (view === "day") return [cursor];
    if (view === "week") {
      const s = startOfWeek(cursor, { weekStartsOn });
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn }),
    });
  }, [view, cursor, weekStartsOn]);

  const blocks = useMemo(
    () => mergeBlocks(buildBlocks(days, events, tasks, plan), dueBlocks(days, bills, subs, (c) => formatMoney(c, currency))),
    [days, events, tasks, plan, bills, subs, currency],
  );

  const step = (dir: 1 | -1) =>
    setCursor((c) => (view === "month" ? addMonths(c, dir) : view === "week" ? addWeeks(c, dir) : addDays(c, dir)));

  const newEvent = (p: Partial<EventDraft> = {}) =>
    setEventDraft({ title: "", color: "violet", date: dayKey(cursor), start: "09:00", end: "10:00", ...p });

  const openTask = (t: Task) => setTaskDraft({ ...t });
  const openBlock = (b: Block) => {
    if (b.kind === "bill") {
      const bill = bills.find((x) => x.id === b.id);
      if (bill) setBillDraft({ ...bill });
    } else if (b.kind === "renewal") navigate("/subscriptions");
    else if (b.kind === "event") {
      const e = events.find((x) => x.id === b.id);
      if (e) setEventDraft({ ...e });
    } else {
      const t = tasks.find((x) => x.id === b.id);
      if (t) openTask(t);
    }
  };

  const toggleTask = (t: Task) =>
    t.done ? reopenTask(t.id) : completeTask(t.id, slotsUntilNow(plan.byTask.get(t.id)?.slots ?? []));

  /** Dropping a task pins it there (and resizing sets its length); dropping an event moves it. */
  const commit = (b: Block, date: string, start: string, end: string) => {
    if (b.kind === "event") {
      const e = events.find((x) => x.id === b.id);
      if (!e) return;
      const repeating = e.repeat && e.repeat !== "none";
      save({ ...e, date: repeating ? e.date : date, start, end });
      return;
    }
    const t = tasks.find((x) => x.id === b.id);
    if (!t) return;
    const duration = toMinutes(end) - toMinutes(start);
    saveTask({ ...t, duration: b.parts && b.parts > 1 ? Math.max(t.duration, duration) : duration, locked: { date, start, end } });
  };

  const title =
    view === "month" ? (
      <>
        {format(cursor, "MMMM")} <span className="text-faint">{format(cursor, "yyyy")}</span>
      </>
    ) : view === "day" ? (
      <>
        {format(cursor, "EEEE")} <span className="text-faint">{format(cursor, "MMM d")}</span>
      </>
    ) : (
      (() => {
        const s = days[0];
        const e = days[6];
        return (
          <>
            {format(s, "MMM d")} – {format(e, isSameMonth(s, e) ? "d" : "MMM d")} <span className="text-faint">{format(e, "yyyy")}</span>
          </>
        );
      })()
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Calendar"
        title={title}
        actions={
          <>
            <Segmented
              layoutId="cal-view"
              value={view}
              onChange={setView}
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
              ]}
            />
            <div className="flex items-center rounded-xl border border-line bg-surface shadow-soft">
              <IconButton label="Previous" onClick={() => step(-1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <button onClick={() => setCursor(startOfDay(new Date()))} className="px-2 text-[13px] font-medium text-muted hover:text-ink">
                Today
              </button>
              <IconButton label="Next" onClick={() => step(1)}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
            <IconButton label="Planning hours" onClick={() => setHoursOpen(true)} className="border border-line bg-surface shadow-soft">
              <SlidersHorizontal className="size-4" />
            </IconButton>
            <Button onClick={() => newEvent()}>
              <CalendarPlus className="size-4" /> Event
            </Button>
            <Button variant="primary" onClick={() => setTaskDraft(newTaskDraft())}>
              <Plus className="size-4" /> Task
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${view}-${dayKey(days[0])}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="min-w-0"
          >
            {view === "month" ? (
              <MonthView
                cursor={cursor}
                weekStartsOn={weekStartsOn}
                blocks={blocks}
                selected={dayKey(cursor)}
                onSelect={(key) => {
                  setCursor(parseDay(key));
                  setView("day");
                }}
                onCreate={(date) => newEvent({ date })}
                onOpen={openBlock}
              />
            ) : (
              <TimeGrid
                days={days}
                blocks={blocks}
                prefs={prefs}
                onOpen={openBlock}
                onCreateAt={(date, start) => newEvent({ date, start, end: fromMinutes(Math.min(toMinutes(start) + 60, 23 * 60 + 59)) })}
                onToggle={(b) => {
                  const t = tasks.find((x) => x.id === b.id);
                  if (t) toggleTask(t);
                }}
                onCommit={commit}
                onSelectDay={(key) => {
                  setCursor(parseDay(key));
                  setView("day");
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="xl:sticky xl:top-8 xl:h-fit">
          <TaskPanel plan={plan} onOpen={openTask} onToggle={toggleTask} />
        </div>
      </div>

      <EventDialog draft={eventDraft} onClose={() => setEventDraft(null)} />
      <TaskDialog draft={taskDraft} onClose={() => setTaskDraft(null)} />
      <HoursDialog open={hoursOpen} onClose={() => setHoursOpen(false)} />
      <BillDialog draft={billDraft} onClose={() => setBillDraft(null)} />
    </div>
  );
}
