import { useEffect, useRef, useState } from "react";
import { format, getDay, isToday } from "date-fns";
import { AlertTriangle, Check, Lock, Repeat } from "lucide-react";
import { cn, swatch } from "@/lib/utils";
import { dayKey } from "@/lib/dates";
import { useNow, type Block } from "./plan";
import { PRIORITIES, formatTime, fromMinutes, toMinutes, type PlannerPrefs } from "./store";

const HOUR = 60;
const SNAP = 15;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

type Placed = { b: Block; s: number; e: number; col: number; cols: number };

/** Splits overlapping blocks into side-by-side columns. */
function layout(blocks: Block[]): Placed[] {
  const timed = blocks
    .filter((b) => b.start)
    .map((b) => {
      const s = toMinutes(b.start!);
      return { b, s, e: Math.max(b.end ? toMinutes(b.end) : s + 60, s + 15) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
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
      colEnds.push(item.e);
    } else colEnds[col] = item.e;
    cluster.push({ ...item, col });
    clusterEnd = Math.max(clusterEnd, item.e);
  }
  flush();
  return out;
}

type Drag = {
  b: Block;
  mode: "move" | "resize";
  x: number;
  y: number;
  day: number;
  s: number;
  e: number;
  origDay: number;
  origS: number;
  origE: number;
  moved: boolean;
};

export function TimeGrid({
  days,
  blocks,
  prefs,
  onOpen,
  onCreateAt,
  onToggle,
  onCommit,
  onSelectDay,
}: {
  days: Date[];
  blocks: Map<string, Block[]>;
  prefs: PlannerPrefs;
  onOpen: (b: Block) => void;
  onCreateAt: (date: string, start: string) => void;
  onToggle: (b: Block) => void;
  onCommit: (b: Block, date: string, start: string, end: string) => void;
  onSelectDay: (key: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const now = useNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const wide = days.length === 1;

  useEffect(() => {
    const starts = prefs.work.filter((h) => h.on).map((h) => toMinutes(h.start));
    scroller.current?.scrollTo({ top: Math.max(0, (Math.min(...starts, 8 * 60) - 45) * (HOUR / 60)) });
    // Only on first mount — later scroll position is the user's.
  }, []);

  // Pointer tracking for drag-to-move and drag-to-resize.
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      const delta = Math.round((dy / HOUR) * 60 / SNAP) * SNAP;
      if (drag.mode === "resize") {
        setDrag({ ...drag, moved: true, e: Math.min(24 * 60, Math.max(drag.origS + SNAP, drag.origE + delta)) });
        return;
      }
      const dur = drag.origE - drag.origS;
      const s = Math.min(24 * 60 - dur, Math.max(0, drag.origS + delta));
      let day = drag.origDay;
      const rect = cols.current?.getBoundingClientRect();
      if (rect) day = Math.min(days.length - 1, Math.max(0, Math.floor(((ev.clientX - rect.left) / rect.width) * days.length)));
      setDrag({ ...drag, moved: true, s, e: s + dur, day });
    };
    const onUp = () => {
      if (!drag.moved) onOpen(drag.b);
      else if (drag.s !== drag.origS || drag.e !== drag.origE || drag.day !== drag.origDay)
        onCommit(drag.b, dayKey(days[drag.day]), fromMinutes(drag.s), fromMinutes(drag.e));
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, days, onOpen, onCommit]);

  const startDrag = (ev: React.PointerEvent, b: Block, dayIdx: number, mode: Drag["mode"]) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    const s = toMinutes(b.start!);
    const e = b.end ? toMinutes(b.end) : s + 60;
    // Recurring events keep their day; completed tasks are a record and don't move.
    if (b.done) return onOpen(b);
    setDrag({ b, mode, x: ev.clientX, y: ev.clientY, day: dayIdx, s, e, origDay: dayIdx, origS: s, origE: e, moved: false });
  };

  const hasAllDay = days.some((d) => (blocks.get(dayKey(d)) ?? []).some((b) => !b.start));
  const columns = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card", drag?.moved && "select-none")}>
      {/* Day headers */}
      <div className="flex border-b border-line">
        <div className="w-14 shrink-0" />
        <div className="grid flex-1" style={columns}>
          {days.map((d) => {
            const key = dayKey(d);
            const today = isToday(d);
            const count = (blocks.get(key) ?? []).filter((b) => b.kind === "task" && !b.done).length;
            return (
              <button
                key={key}
                onClick={() => onSelectDay(key)}
                className={cn("flex items-center justify-center gap-2 py-3 transition-colors hover:bg-sunken/60", !wide && "flex-col gap-1")}
              >
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{format(d, wide ? "EEEE" : "EEE")}</span>
                <span className={cn("flex size-8 items-center justify-center rounded-full text-[15px] font-medium tabular", today && "bg-cal font-semibold text-white")}>
                  {format(d, "d")}
                </span>
                {wide && count > 0 && <span className="text-[12px] text-muted">{count} {count === 1 ? "task" : "tasks"} planned</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div className="flex border-b border-line">
          <div className="flex w-14 shrink-0 items-center justify-end pr-2 text-[10px] font-medium uppercase tracking-wide text-faint">All day</div>
          <div className="grid flex-1" style={columns}>
            {days.map((d) => (
              <div key={dayKey(d)} className="flex min-w-0 flex-col gap-0.5 border-l border-line p-1">
                {(blocks.get(dayKey(d)) ?? [])
                  .filter((b) => !b.start)
                  .map((b) => (
                    <button key={b.key} onClick={() => onOpen(b)} className="truncate rounded-md px-1.5 py-1 text-left text-[12px] font-medium" style={{ background: swatch(b.color).soft }}>
                      {b.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time grid */}
      <div ref={scroller} className="relative h-[min(70dvh,760px)] overflow-y-auto">
        <div className="flex" style={{ height: HOUR * 24 }}>
          <div className="relative w-14 shrink-0">
            {HOURS.slice(1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-faint tabular" style={{ top: h * HOUR }}>
                {formatTime(fromMinutes(h * 60)).replace(":00", "")}
              </span>
            ))}
          </div>

          <div ref={cols} className="relative grid flex-1" style={columns}>
            {days.map((d, dayIdx) => {
              const key = dayKey(d);
              const today = isToday(d);
              const work = prefs.work[getDay(d)];
              const placed = layout((blocks.get(key) ?? []).filter((b) => !drag?.moved || b.key !== drag.b.key));
              return (
                <div
                  key={key}
                  className={cn("relative border-l border-line", today && "bg-cal-soft/20")}
                  onClick={(ev) => {
                    const rect = ev.currentTarget.getBoundingClientRect();
                    const min = Math.floor(((ev.clientY - rect.top) / HOUR) * 2) * 30;
                    onCreateAt(key, fromMinutes(min));
                  }}
                >
                  {/* Outside working hours is shaded */}
                  {work?.on ? (
                    <>
                      <div className="absolute inset-x-0 top-0 bg-sunken/70" style={{ height: (toMinutes(work.start) / 60) * HOUR }} />
                      <div className="absolute inset-x-0 bottom-0 bg-sunken/70" style={{ top: (toMinutes(work.end) / 60) * HOUR }} />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-sunken/70" />
                  )}
                  {HOURS.slice(1).map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: h * HOUR }} />
                  ))}

                  {placed.map(({ b, s, e, col, cols: n }) => (
                    <GridBlock
                      key={b.key}
                      b={b}
                      top={(s / 60) * HOUR}
                      height={((e - s) / 60) * HOUR}
                      left={`calc(${(col / n) * 100}% + 2px)`}
                      width={`calc(${100 / n}% - 4px)`}
                      wide={wide}
                      onPointerDown={(ev, mode) => startDrag(ev, b, dayIdx, mode)}
                      onToggle={() => onToggle(b)}
                      onOpen={() => onOpen(b)}
                    />
                  ))}

                  {drag?.moved && drag.day === dayIdx && (
                    <GridBlock
                      b={{ ...drag.b, start: fromMinutes(drag.s), end: fromMinutes(drag.e) }}
                      top={(drag.s / 60) * HOUR}
                      height={((drag.e - drag.s) / 60) * HOUR}
                      left="2px"
                      width="calc(100% - 4px)"
                      wide={wide}
                      dragging
                    />
                  )}

                  {today && (
                    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMin / 60) * HOUR }}>
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
    </div>
  );
}

function GridBlock({
  b,
  top,
  height,
  left,
  width,
  wide,
  dragging,
  onPointerDown,
  onToggle,
  onOpen,
}: {
  b: Block;
  top: number;
  height: number;
  left: string;
  width: string;
  wide: boolean;
  dragging?: boolean;
  onPointerDown?: (ev: React.PointerEvent, mode: "move" | "resize") => void;
  onToggle?: () => void;
  onOpen?: () => void;
}) {
  const sw = swatch(b.color);
  const task = b.kind === "task";
  const late = task && !b.done && b.status === "late";
  const short = height < 34;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(ev) => ev.stopPropagation()}
      onPointerDown={(ev) => onPointerDown?.(ev, "move")}
      onKeyDown={(ev) => ev.key === "Enter" && onOpen?.()}
      className={cn(
        "group absolute z-10 flex cursor-grab touch-none flex-col overflow-hidden border-l-[3px] px-1.5 text-left text-[12px] leading-tight transition-shadow active:cursor-grabbing",
        short ? "justify-center rounded-[4px] py-0" : "rounded-lg py-1",
        dragging && "z-30 shadow-float ring-2 ring-cal/40",
        b.done && "opacity-55",
      )}
      style={{
        top: top + 1,
        height: Math.max(height - 2, 14),
        left,
        width,
        borderColor: late ? "var(--neg)" : sw.fg,
        background: b.done ? "var(--sunken)" : sw.soft,
        backgroundImage: task && !b.done ? `repeating-linear-gradient(-45deg, transparent 0 6px, ${sw.fg}12 6px 8px)` : undefined,
      }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {task && (
          <button
            aria-label={b.done ? "Mark as not done" : "Mark as done"}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation();
              onToggle?.();
            }}
            className="flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors hover:bg-white/60 dark:hover:bg-black/30"
            style={{ borderColor: sw.fg, background: b.done ? sw.fg : undefined }}
          >
            {b.done && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
          </button>
        )}
        <span className={cn("truncate font-semibold", b.done && "line-through")}>{b.title}</span>
        {b.locked && <Lock className="size-3 shrink-0 text-muted" />}
        {b.repeats && <Repeat className="size-3 shrink-0 text-muted" />}
        {late && <AlertTriangle className="size-3 shrink-0 text-neg" />}
      </div>
      {!short && height > 40 && (
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-muted tabular">
          {formatTime(b.start!)}
          {b.parts && b.parts > 1 && <span className="text-faint">· part {b.part}/{b.parts}</span>}
          {wide && b.priority && (
            <span className="font-medium" style={{ color: PRIORITIES[b.priority].color }}>
              · {PRIORITIES[b.priority].label}
            </span>
          )}
          {wide && b.location && <span className="truncate text-faint">· {b.location}</span>}
        </div>
      )}
      {!b.done && onPointerDown && (
        <div
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
          onPointerDown={(ev) => onPointerDown(ev, "resize")}
        >
          <div className="mx-auto mt-0.5 h-1 w-6 rounded-full bg-current opacity-30" />
        </div>
      )}
    </div>
  );
}
