import { useMemo, useState } from "react";
import { addMonths, addWeeks, endOfWeek, format, isSameMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button, Card, IconButton, PageHeader, Segmented } from "@/components/ui";
import { useSettings } from "@/store/settings";
import { dayKey, parseDay, todayKey } from "@/lib/dates";
import { eventsByDate, useCalendar, type CalendarEvent, type EventDraft } from "./store";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayAgenda } from "./DayAgenda";
import { EventDialog } from "./EventDialog";

type View = "month" | "week";

export function CalendarPage() {
  const events = useCalendar((s) => s.events);
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(todayKey);
  const [draft, setDraft] = useState<EventDraft | null>(null);

  const byDate = useMemo(() => eventsByDate(events), [events]);
  const selectedEvents = byDate.get(selected) ?? [];

  const step = (dir: 1 | -1) => setCursor((c) => (view === "month" ? addMonths(c, dir) : addWeeks(c, dir)));
  const goToday = () => {
    setCursor(new Date());
    setSelected(todayKey());
  };

  const newEvent = (p: Partial<EventDraft> & { date: string }) =>
    setDraft({ title: "", color: "violet", start: "09:00", end: "10:00", ...p });
  const openEvent = (e: CalendarEvent) => setDraft({ ...e });

  const select = (key: string) => {
    setSelected(key);
    const d = parseDay(key);
    if (view === "month" && !isSameMonth(d, cursor)) setCursor(d);
  };

  const title =
    view === "month" ? (
      <>
        {format(cursor, "MMMM")} <span className="text-faint">{format(cursor, "yyyy")}</span>
      </>
    ) : (
      (() => {
        const s = startOfWeek(cursor, { weekStartsOn });
        const e = endOfWeek(cursor, { weekStartsOn });
        return (
          <>
            {format(s, "MMM d")} – {format(e, isSameMonth(s, e) ? "d" : "MMM d")}{" "}
            <span className="text-faint">{format(e, "yyyy")}</span>
          </>
        );
      })()
    );

  const periodKey = `${view}-${dayKey(view === "month" ? cursor : startOfWeek(cursor, { weekStartsOn }))}`;

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
                { value: "month", label: "Month" },
                { value: "week", label: "Week" },
              ]}
            />
            <div className="flex items-center rounded-xl border border-line bg-surface shadow-soft">
              <IconButton label="Previous" onClick={() => step(-1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <button onClick={goToday} className="px-2 text-[13px] font-medium text-muted hover:text-ink">
                Today
              </button>
              <IconButton label="Next" onClick={() => step(1)}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
            <Button variant="primary" onClick={() => newEvent({ date: selected })}>
              <Plus className="size-4" /> New event
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={periodKey}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="min-w-0"
          >
            {view === "month" ? (
              <MonthView
                cursor={cursor}
                weekStartsOn={weekStartsOn}
                byDate={byDate}
                selected={selected}
                onSelect={select}
                onCreate={(date) => newEvent({ date })}
                onOpen={openEvent}
              />
            ) : (
              <WeekView
                cursor={cursor}
                weekStartsOn={weekStartsOn}
                byDate={byDate}
                selected={selected}
                onSelect={select}
                onCreate={newEvent}
                onOpen={openEvent}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <Card className="h-fit xl:sticky xl:top-8">
          <div className="flex items-end justify-between px-5 pb-3 pt-5">
            <div>
              <div className="text-[13px] font-medium text-cal">{format(parseDay(selected), "EEEE")}</div>
              <div className="font-serif text-4xl leading-none">{format(parseDay(selected), "MMMM d")}</div>
            </div>
            <IconButton label="Add event" onClick={() => newEvent({ date: selected })}>
              <Plus className="size-5" />
            </IconButton>
          </div>
          <div className="px-2 pb-3">
            <DayAgenda events={selectedEvents} onOpen={openEvent} onCreate={() => newEvent({ date: selected })} compact />
          </div>
        </Card>
      </div>

      <EventDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
