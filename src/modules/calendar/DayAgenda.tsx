import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, MapPin } from "lucide-react";
import { cn, swatch } from "@/lib/utils";
import { EmptyState } from "@/components/ui";
import { timeRange, type CalendarEvent } from "./store";

/** A vertical list of a day's events — used by the calendar side panel and the Today page. */
export function DayAgenda({
  events,
  onOpen,
  onCreate,
  compact,
}: {
  events: CalendarEvent[];
  onOpen: (e: CalendarEvent) => void;
  onCreate?: () => void;
  compact?: boolean;
}) {
  if (!events.length) {
    return (
      <EmptyState
        className={compact ? "py-8" : undefined}
        icon={<CalendarPlus className="size-5" />}
        title="Nothing planned"
        body="A clear day. Add something, or enjoy the space."
        action={
          onCreate && (
            <button onClick={onCreate} className="text-sm font-medium text-cal hover:underline">
              Add an event
            </button>
          )
        }
      />
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      <AnimatePresence initial={false}>
        {events.map((e, i) => {
          const s = swatch(e.color);
          return (
            <motion.li
              key={e.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
              exit={{ opacity: 0, scale: 0.98 }}
            >
              <button
                onClick={() => onOpen(e)}
                className={cn(
                  "group flex w-full items-stretch gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-sunken",
                )}
              >
                <span className="w-1 shrink-0 rounded-full" style={{ background: s.fg }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="mt-0.5 block text-[13px] text-muted tabular">{timeRange(e)}</span>
                  {e.location && (
                    <span className="mt-1 flex items-center gap-1 truncate text-[13px] text-faint">
                      <MapPin className="size-3.5 shrink-0" />
                      {e.location}
                    </span>
                  )}
                </span>
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
