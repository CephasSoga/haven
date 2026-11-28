import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { addDays, addMonths, endOfMonth, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayKey, parseDay } from "@/lib/dates";
import { useSettings } from "@/store/settings";

/*
 * Choosing a date or a time: a field that opens a month calendar, or hour and minute wheels, the same on
 * every device (the browser's own pickers differ from one to the next, and some barely show).
 */

const field =
  "flex h-full w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-left text-[15px] text-ink transition-colors hover:border-line-strong focus:border-cal focus:outline-none focus:ring-4 focus:ring-cal/15";

/* ---------- The floating panel ---------- */

/** Opens under its field (or above, when there's no room); a sheet from the bottom on a phone. */
function Popover({ anchor, open, onClose, children, width }: { anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode; width: number }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const phone = typeof window !== "undefined" && window.innerWidth < 640;

  useLayoutEffect(() => {
    if (!open || !anchor || phone) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const height = panel.current?.offsetHeight ?? 360;
      const up = r.bottom + height + 12 > window.innerHeight && r.top - height - 12 > 0;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setPos({ top: up ? r.top - height - 6 : r.bottom + 6, left, up });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, phone, width]);

  useEffect(() => {
    if (!open) return;
    // Escape closes the picker, not the dialog it's in.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
      anchor?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, onClose, anchor]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {phone && <motion.div className="fixed inset-0 z-[90] bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
          <motion.div
            ref={panel}
            role="dialog"
            initial={{ opacity: 0, y: phone ? 24 : pos?.up ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: phone ? 24 : pos?.up ? 4 : -4 }}
            transition={{ duration: 0.14 }}
            className={cn(
              "fixed z-[91] rounded-2xl border border-line bg-raised p-3 shadow-float",
              phone && "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-w-sm",
            )}
            style={phone ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- Dates ---------- */

type DateProps = {
  id?: string;
  /** yyyy-MM-dd, or "" for none */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** Can be emptied (optional dates) */
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  /** Smaller text, for tight rows */
  compact?: boolean;
  "aria-label"?: string;
  title?: string;
};

const pretty = (key: string) => format(parseDay(key), "EEE d MMM yyyy");

/** A date, picked on a month calendar. */
export function DateField({ id, value, onChange, min, max, clearable, placeholder = "Pick a date", className, compact, title, ...rest }: DateProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return (
    <div className={cn("relative h-11", className)}>
      <button
        ref={button}
        id={id}
        type="button"
        title={title}
        aria-label={rest["aria-label"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(field, compact && "gap-1.5 px-2.5 text-[13px]", clearable && valid && "pr-9")}
      >
        <CalendarDays className="size-4 shrink-0 text-muted" />
        <span className={cn("truncate", !valid && "text-faint")}>{valid ? pretty(value) : placeholder}</span>
      </button>
      {clearable && valid && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear the date" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint hover:text-ink">
          <X className="size-3.5" />
        </button>
      )}
      <Popover anchor={button.current} open={open} onClose={() => setOpen(false)} width={300}>
        <Calendar
          value={valid ? value : ""}
          min={min}
          max={max}
          clearable={clearable}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
            button.current?.focus();
          }}
        />
      </Popover>
    </div>
  );
}

function Calendar({ value, min, max, clearable, onPick }: { value: string; min?: string; max?: string; clearable?: boolean; onPick: (v: string) => void }) {
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const today = dayKey(new Date());
  const [month, setMonth] = useState(() => startOfMonth(parseDay(value || (min && min > today ? min : today))));
  const [focus, setFocus] = useState(value || (min && min > today ? min : today));
  const [years, setYears] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const byKeys = useRef(false);
  const allowed = (k: string) => (!min || k >= min) && (!max || k <= max);

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), { weekStartsOn });
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month, weekStartsOn]);

  // While moving with the arrow keys, the chosen day's button keeps the keyboard focus.
  useEffect(() => {
    if (!byKeys.current) return;
    byKeys.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, month]);

  /** Shows another month, keeping the keyboard's place on the same day of it. */
  const showMonth = (m: Date) => {
    setMonth(m);
    const day = Math.min(parseDay(focus).getDate(), endOfMonth(m).getDate());
    setFocus(dayKey(new Date(m.getFullYear(), m.getMonth(), day)));
  };

  const move = (by: number) => {
    const next = addDays(parseDay(focus), by);
    if (!isSameMonth(next, month)) setMonth(startOfMonth(next));
    setFocus(dayKey(next));
  };
  const onKey = (e: KeyboardEvent) => {
    byKeys.current = true;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in steps) {
      e.preventDefault();
      move(steps[e.key]);
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const next = addMonths(parseDay(focus), e.key === "PageUp" ? -1 : 1);
      setMonth(startOfMonth(next));
      setFocus(dayKey(next));
    }
  };

  const weekdays = Array.from({ length: 7 }, (_, i) => format(addDays(startOfWeek(new Date(), { weekStartsOn }), i), "EEEEE"));
  const quick = [
    { label: "Today", key: today },
    { label: "Tomorrow", key: dayKey(addDays(new Date(), 1)) },
    { label: "In a week", key: dayKey(addDays(new Date(), 7)) },
  ].filter((q) => allowed(q.key));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => showMonth(addMonths(month, years ? -12 : -1))} aria-label={years ? "Previous year" : "Previous month"} className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" onClick={() => setYears(!years)} className="rounded-lg px-2 py-1 text-[14px] font-semibold hover:bg-sunken" aria-label="Choose the month and year">
          {years ? format(month, "yyyy") : format(month, "MMMM yyyy")}
        </button>
        <button type="button" onClick={() => showMonth(addMonths(month, years ? 12 : 1))} aria-label={years ? "Next year" : "Next month"} className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink">
          <ChevronRight className="size-4" />
        </button>
      </div>

      {years ? (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: 12 }, (_, m) => new Date(month.getFullYear(), m, 1)).map((d) => {
            const on = isSameMonth(d, month);
            const disabled = (!!max && dayKey(d) > max) || (!!min && dayKey(endOfMonth(d)) < min);
            return (
              <button
                key={d.getMonth()}
                type="button"
                disabled={disabled}
                onClick={() => {
                  showMonth(d);
                  setYears(false);
                }}
                className={cn("rounded-xl py-2.5 text-[13px] font-medium transition-colors disabled:opacity-30", on ? "bg-primary text-on-primary" : "hover:bg-sunken")}
              >
                {format(d, "MMM")}
              </button>
            );
          })}
        </div>
      ) : (
        <div ref={grid} role="grid" onKeyDown={onKey}>
          <div className="grid grid-cols-7 pb-1 text-center text-[11px] font-medium text-faint">
            {weekdays.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d) => {
              const k = dayKey(d);
              const inMonth = isSameMonth(d, month);
              const selected = k === value;
              const disabled = !allowed(k);
              return (
                <button
                  key={k}
                  type="button"
                  data-day={k}
                  disabled={disabled}
                  tabIndex={k === focus ? 0 : -1}
                  aria-selected={selected}
                  aria-label={format(d, "EEEE d MMMM yyyy")}
                  onClick={() => onPick(k)}
                  onFocus={() => setFocus(k)}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-lg text-[13px] tabular transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cal disabled:opacity-25",
                    selected ? "bg-primary font-semibold text-on-primary" : "hover:bg-sunken",
                    !inMonth && !selected && "text-faint",
                    k === today && !selected && "font-semibold text-cal ring-1 ring-inset ring-cal/40",
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        {quick.map((q) => (
          <button key={q.label} type="button" onClick={() => onPick(q.key)} className="rounded-lg bg-sunken px-2.5 py-1 text-[12px] font-medium text-muted hover:text-ink">
            {q.label}
          </button>
        ))}
        {clearable && value && (
          <button type="button" onClick={() => onPick("")} className="ml-auto rounded-lg px-2.5 py-1 text-[12px] font-medium text-muted hover:text-neg">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Times ---------- */

type TimeProps = {
  id?: string;
  /** HH:mm (24-hour), or "" for none */
  value: string;
  onChange: (value: string) => void;
  /** Minutes between choices */
  step?: number;
  clearable?: boolean;
  placeholder?: string;
  className?: string;
  compact?: boolean;
  /** Shown in red (e.g. ends before it starts) */
  invalid?: boolean;
  title?: string;
  "aria-label"?: string;
};

/** Does this device show times as 2:30 PM? */
const twelveHour = () => {
  try {
    return !!new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
  } catch {
    return false;
  }
};

const show = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

/** "9", "930", "9:30", "21.30", "9pm", "9:30 am" → "09:30" (24-hour), or null. */
export function readTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  const m = t.match(/^(\d{1,2})(?:[:h.]?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** A time, picked on hour and minute wheels (or typed). */
export function TimeField({ id, value, onChange, step = 5, clearable, placeholder = "Pick a time", className, compact, invalid, title, ...rest }: TimeProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const valid = /^\d{2}:\d{2}$/.test(value);
  return (
    <div className={cn("relative h-11", className)}>
      <button
        ref={button}
        id={id}
        type="button"
        aria-label={rest["aria-label"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(field, compact && "gap-1.5 px-2.5 text-[13px]", invalid && "border-neg focus:border-neg", clearable && valid && "pr-9")}
        title={title}
      >
        <Clock className="size-4 shrink-0 text-muted" />
        <span className={cn("truncate tabular", !valid && "text-faint")}>{valid ? show(value) : placeholder}</span>
      </button>
      {clearable && valid && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear the time" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint hover:text-ink">
          <X className="size-3.5" />
        </button>
      )}
      <Popover anchor={button.current} open={open} onClose={() => setOpen(false)} width={twelveHour() ? 260 : 220}>
        <Wheels
          value={valid ? value : ""}
          step={step}
          clearable={clearable}
          onChange={onChange}
          onDone={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      </Popover>
    </div>
  );
}

function Wheels({ value, step, clearable, onChange, onDone }: { value: string; step: number; clearable?: boolean; onChange: (v: string) => void; onDone: () => void }) {
  const twelve = twelveHour();
  const [h, m] = (value || "09:00").split(":").map(Number);
  const [typed, setTyped] = useState("");
  const minutes = useMemo(() => {
    const list = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
    // A time set elsewhere (e.g. 09:07) still shows its own minute.
    return list.includes(m) ? list : [...list, m].sort((a, b) => a - b);
  }, [step, m]);
  const set = (hour: number, minute: number) => onChange(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  const hours = twelve ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 24 }, (_, i) => i);
  const pm = h >= 12;
  const hourShown = twelve ? h % 12 || 12 : h;
  const fromShown = (shown: number, isPm: boolean) => (twelve ? (shown % 12) + (isPm ? 12 : 0) : shown);
  const parsed = readTime(typed);

  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed) return;
          onChange(parsed);
          onDone();
        }}
        className="flex gap-1.5"
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={twelve ? "Type: 9:30 pm" : "Type: 21:30"}
          aria-label="Type a time"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[13px] focus:border-cal focus:outline-none"
        />
        {typed && (
          <button type="submit" disabled={!parsed} className="rounded-lg bg-primary px-2.5 text-[12px] font-medium text-on-primary disabled:opacity-40">
            {parsed ? show(parsed) : "?"}
          </button>
        )}
      </form>
      <div className="flex gap-1.5">
        <Column label="Hour" items={hours} selected={value ? hourShown : null} render={(x) => (twelve ? String(x) : String(x).padStart(2, "0"))} onPick={(x) => set(fromShown(x, pm), m)} />
        <Column label="Minute" items={minutes} selected={value ? m : null} render={(x) => String(x).padStart(2, "0")} onPick={(x) => set(h, x)} />
        {twelve && (
          <div className="flex flex-col gap-1">
            {["AM", "PM"].map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => set(fromShown(hourShown, i === 1), m)}
                className={cn("rounded-lg px-2.5 py-2 text-[13px] font-medium", value && pm === (i === 1) ? "bg-primary text-on-primary" : "hover:bg-sunken")}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-line pt-2">
        {clearable && value && (
          <button type="button" onClick={() => (onChange(""), onDone())} className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-muted hover:text-neg">
            Clear
          </button>
        )}
        <button type="button" onClick={onDone} className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary">
          Done
        </button>
      </div>
    </div>
  );
}

/** A scrolling wheel of choices, opened at the chosen one. */
function Column({ label, items, selected, render, onPick }: { label: string; items: number[]; selected: number | null; render: (x: number) => string; onPick: (x: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-v="${selected ?? items[Math.floor(items.length / 3)]}"]`);
    if (el && list.current) list.current.scrollTop = el.offsetTop - list.current.clientHeight / 2 + el.clientHeight / 2;
    // Only when it opens, and when the choice changes from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-center text-[11px] font-medium text-faint">{label}</span>
      <div ref={list} role="listbox" aria-label={label} className="relative h-48 overflow-y-auto overscroll-contain rounded-xl bg-sunken p-1 [scrollbar-width:thin]">
        {items.map((x) => (
          <button
            key={x}
            type="button"
            role="option"
            data-v={x}
            aria-selected={x === selected}
            onClick={() => onPick(x)}
            className={cn("block w-full rounded-lg py-1.5 text-center text-[14px] tabular transition-colors", x === selected ? "bg-primary font-semibold text-on-primary" : "hover:bg-surface")}
          >
            {render(x)}
          </button>
        ))}
      </div>
    </div>
  );
}
