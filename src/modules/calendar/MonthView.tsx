import { useMemo } from "react";
import { eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { cn, swatch } from "@/lib/utils";
import { dayKey } from "@/lib/dates";
import { formatTime, type CalendarEvent } from "./store";

const MAX_CHIPS = 3;

export function MonthView({
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
  onCreate: (key: string) => void;
  onOpen: (e: CalendarEvent) => void;
}) {
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(cursor), { weekStartsOn }),
        end: endOfWeek(endOfMonth(cursor), { weekStartsOn }),
      }),
    [cursor, weekStartsOn],
  );

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-faint sm:text-left">
            <span className="sm:hidden">{format(d, "EEEEE")}</span>
            <span className="hidden sm:inline">{format(d, "EEE")}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7" style={{ gridAutoRows: "minmax(0, 1fr)" }}>
        {days.map((d, i) => {
          const key = dayKey(d);
          const events = byDate.get(key) ?? [];
          const inMonth = isSameMonth(d, cursor);
          const today = isToday(d);
          const isSelected = key === selected;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(key)}
              onDoubleClick={() => onCreate(key)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(key)}
              className={cn(
                "group relative flex min-h-[68px] cursor-pointer flex-col gap-1 border-line p-1.5 text-left transition-colors sm:min-h-[118px] sm:p-2",
                i % 7 !== 6 && "border-r",
                i < days.length - 7 && "border-b",
                !inMonth && "bg-sunken/40",
                isSelected ? "bg-cal-soft/60" : "hover:bg-sunken/60",
              )}
            >
              <div className="flex items-center justify-center sm:justify-between">
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-[13px] font-medium tabular transition-colors",
                    !inMonth && "text-faint",
                    today && "bg-cal font-semibold text-white",
                    isSelected && !today && "bg-primary text-on-primary",
                  )}
                >
                  {format(d, "d")}
                </span>
              </div>

              {/* Compact dots on phones */}
              <div className="flex flex-wrap justify-center gap-0.5 sm:hidden">
                {events.slice(0, 4).map((e) => (
                  <span key={e.id} className="size-1.5 rounded-full" style={{ background: swatch(e.color).fg }} />
                ))}
              </div>

              {/* Chips on larger screens */}
              <div className="hidden flex-col gap-0.5 sm:flex">
                {events.slice(0, MAX_CHIPS).map((e) => {
                  const s = swatch(e.color);
                  return (
                    <button
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpen(e);
                      }}
                      onDoubleClick={(ev) => ev.stopPropagation()}
                      className={cn(
                        "flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-[3px] text-left text-[12px] leading-tight transition-transform hover:translate-x-0.5",
                        !inMonth && "opacity-60",
                      )}
                      style={e.start ? undefined : { background: s.soft }}
                    >
                      {e.start ? (
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.fg }} />
                      ) : null}
                      <span className="truncate font-medium">{e.title}</span>
                      {e.start && (
                        <span className="ml-auto hidden shrink-0 pl-1 text-faint tabular 2xl:inline">{formatTime(e.start)}</span>
                      )}
                    </button>
                  );
                })}
                {events.length > MAX_CHIPS && (
                  <span className="px-1.5 text-[11px] font-medium text-muted">+{events.length - MAX_CHIPS} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
