import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isToday, startOfWeek } from "date-fns";
import { cn, swatch } from "@/lib/utils";
import { dayKey } from "@/lib/dates";
import { formatTime, fromMinutes, toMinutes, type CalendarEvent, type EventDraft } from "./store";

const HOUR = 56;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

type Placed = { e: CalendarEvent; s: number; en: number; col: number; cols: number };

/** Splits overlapping events into side-by-side columns. */
function layout(events: CalendarEvent[]): Placed[] {
  const timed = events
    .filter((e) => e.start)
    .map((e) => {
      const s = toMinutes(e.start!);
      return { e, s, en: Math.max(e.end ? toMinutes(e.end) : s + 60, s + 20) };
    })
    .sort((a, b) => a.s - b.s || b.en - a.en);

  const out: Placed[] = [];
  let cluster: Omit<Placed, "cols">[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) out.push({ ...c, cols: colEnds.length });
    cluster = [];
    colEnds = [];
  };
  for (const item of timed) {
    if (item.s >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    let col = colEnds.findIndex((end) => end <= item.s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(item.en);
    } else colEnds[col] = item.en;
    cluster.push({ ...item, col });
    clusterEnd = Math.max(clusterEnd, item.en);
  }
  flush();
  return out;
}

function useNowMinutes() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now.getHours() * 60 + now.getMinutes();
}

export function WeekView({
  cursor,
  weekStartsOn,
  byDate,
  selected,
  onSelect,
  onCreate,
  onOpen,
}: {
  cursor: Date;
  weekStartsOn: 0 | 1;
  byDate: Map<string, CalendarEvent[]>;
  selected: string;
  onSelect: (key: string) => void;
  onCreate: (draft: Partial<EventDraft> & { date: string }) => void;
  onOpen: (e: CalendarEvent) => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor, weekStartsOn]);
  const scroller = useRef<HTMLDivElement>(null);
  const nowMin = useNowMinutes();

  useEffect(() => {
    scroller.current?.scrollTo({ top: HOUR * 7.5 });
  }, []);

  const hasAllDay = days.some((d) => (byDate.get(dayKey(d)) ?? []).some((e) => !e.start));

  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      {/* Day headers */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
        <div />
        {days.map((d) => {
          const key = dayKey(d);
          const today = isToday(d);
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={cn(
                "flex flex-col items-center gap-1 py-3 transition-colors hover:bg-sunken/60",
                key === selected && "bg-cal-soft/60",
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{format(d, "EEE")}</span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-[15px] font-medium tabular",
                  today && "bg-cal font-semibold text-white",
                )}
              >
                {format(d, "d")}
              </span>
            </button>
          );
        })}
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div className="grid border-b border-line" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
          <div className="self-center pr-2 text-right text-[10px] font-medium uppercase tracking-wide text-faint">All day</div>
          {days.map((d) => (
            <div key={dayKey(d)} className="flex min-w-0 flex-col gap-0.5 border-l border-line p-1">
              {(byDate.get(dayKey(d)) ?? [])
                .filter((e) => !e.start)
                .map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onOpen(e)}
                    className="truncate rounded-md px-1.5 py-1 text-left text-[12px] font-medium"
                    style={{ background: swatch(e.color).soft }}
                  >
                    {e.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Time grid */}
      <div ref={scroller} className="relative h-[min(68dvh,720px)] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))", height: HOUR * 24 }}>
          <div className="relative">
            {HOURS.slice(1).map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-faint tabular"
                style={{ top: h * HOUR }}
              >
                {formatTime(fromMinutes(h * 60)).replace(":00", "")}
              </span>
            ))}
          </div>

          {days.map((d) => {
            const key = dayKey(d);
            const placed = layout(byDate.get(key) ?? []);
            const today = isToday(d);
            return (
              <div
                key={key}
                className={cn("relative border-l border-line", today && "bg-cal-soft/25")}
                onClick={(ev) => {
                  const rect = ev.currentTarget.getBoundingClientRect();
                  const min = Math.floor(((ev.clientY - rect.top) / HOUR) * 2) * 30;
                  onCreate({ date: key, start: fromMinutes(min), end: fromMinutes(min + 60) });
                }}
              >
                {HOURS.slice(1).map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: h * HOUR }} />
                ))}

                {placed.map(({ e, s, en, col, cols }) => {
                  const sw = swatch(e.color);
                  const height = ((en - s) / 60) * HOUR;
                  return (
                    <button
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpen(e);
                      }}
                      className="absolute flex flex-col justify-start overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-left text-[12px] leading-tight transition-[filter] hover:brightness-95 dark:hover:brightness-125"
                      style={{
                        top: (s / 60) * HOUR + 1,
                        height: height - 2,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                        background: sw.soft,
                        borderColor: sw.fg,
                      }}
                    >
                      <div className="truncate font-semibold">{e.title}</div>
                      {height > 36 && <div className="truncate text-muted tabular">{formatTime(e.start!)}</div>}
                    </button>
                  );
                })}

                {today && (
                  <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: (nowMin / 60) * HOUR }}>
                    <div className="relative h-0.5 bg-neg">
                      <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-neg" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
