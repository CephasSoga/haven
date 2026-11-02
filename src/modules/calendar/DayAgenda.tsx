import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CalendarPlus, Check, Lock, MapPin } from "lucide-react";
import { cn, swatch } from "@/lib/utils";
import { EmptyState } from "@/components/ui";
import type { Block } from "./plan";
import { PRIORITIES, timeRange } from "./store";

/** A day's events and planned tasks as a vertical list — used on the Today page. */
export function DayAgenda({
  blocks,
  onOpen,
  onToggle,
  onCreate,
  compact,
}: {
  blocks: Block[];
  onOpen: (b: Block) => void;
  onToggle?: (b: Block) => void;
  onCreate?: () => void;
  compact?: boolean;
}) {
  if (!blocks.length) {
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
        {blocks.map((b, i) => {
          const s = swatch(b.color);
          const task = b.kind === "task";
          return (
            <motion.li
              key={b.key}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="group flex items-stretch gap-3 rounded-2xl p-3 transition-colors hover:bg-sunken"
            >
              {task ? (
                <button
                  aria-label={b.done ? "Mark as not done" : "Mark as done"}
                  onClick={() => onToggle?.(b)}
                  className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2"
                  style={{ borderColor: s.fg, background: b.done ? s.fg : undefined }}
                >
                  {b.done && <Check className="size-3 text-white" strokeWidth={3} />}
                </button>
              ) : (
                <span className="w-1 shrink-0 rounded-full" style={{ background: s.fg }} />
              )}
              <button onClick={() => onOpen(b)} className="min-w-0 flex-1 text-left">
                <span className={cn("flex items-center gap-1.5 font-medium", b.done && "text-muted line-through")}>
                  <span className="truncate">{b.title}</span>
                  {b.locked && <Lock className="size-3 shrink-0 text-faint" />}
                  {task && !b.done && b.status === "late" && <AlertTriangle className="size-3.5 shrink-0 text-neg" />}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-[13px] text-muted tabular">
                  {timeRange(b)}
                  {task && b.priority && !b.done && (
                    <span className="text-[12px] font-medium" style={{ color: PRIORITIES[b.priority].color }}>
                      {PRIORITIES[b.priority].label}
                    </span>
                  )}
                  {b.parts && b.parts > 1 && <span className="text-faint">part {b.part}/{b.parts}</span>}
                </span>
                {b.location && (
                  <span className="mt-1 flex items-center gap-1 truncate text-[13px] text-faint">
                    <MapPin className="size-3.5 shrink-0" />
                    {b.location}
                  </span>
                )}
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
