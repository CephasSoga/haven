import { create } from "zustand";
import { persist } from "zustand/middleware";
import { addDays, startOfDay } from "date-fns";
import { dayKey } from "@/lib/dates";
import { uid } from "@/lib/utils";

export type Outcome = "done" | "partly" | "no";

export const OUTCOMES: Record<Outcome, string> = { done: "Finished it", partly: "Made progress", no: "Didn't get there" };

/** A focus session you've done. */
export type Session = {
  id: string;
  intention: string;
  /** The Calendar task it was for */
  taskId?: string;
  /** Minutes you set out to do */
  planned: number;
  start: number;
  end: number;
  /** Minutes actually focused (pauses left out) */
  focused: number;
  outcome?: Outcome;
  /** How well it went, 1–5 */
  quality?: number;
  /** Thoughts parked during the session, still waiting to be dealt with */
  thoughts: string[];
};

/** The session running now. Times are timestamps, so it keeps going across screens, in the tray and on other devices. */
export type Active = {
  id: string;
  intention: string;
  taskId?: string;
  planned: number;
  /** Break after it, in minutes (0 = none) */
  breakMin: number;
  /** It's the long break of the cycle */
  longBreak?: boolean;
  startedAt: number;
  /** Milliseconds focused before the current stretch (pauses split stretches) */
  banked: number;
  /** When the current stretch began; null while paused */
  runningSince: number | null;
  thoughts: string[];
};

/** How you like to set sessions up (remembered for next time). */
export type FocusPrefs = {
  /** "25" | "50" | "90" | "custom" */
  length: string;
  customLength: number;
  /** "0" | "5" | "10" | "15" | "custom" */
  brk: string;
  customBreak: number;
  /** A longer break after every nth session of the day (0 = never) */
  longEvery: number;
  longMin: number;
};

export const DEFAULT_PREFS: FocusPrefs = { length: "50", customLength: 40, brk: "10", customBreak: 20, longEvery: 0, longMin: 20 };

type FocusState = {
  active: Active | null;
  /** The break after a session ends at… */
  breakUntil: number | null;
  /** …and it's the long one */
  breakLong?: boolean;
  prefs: FocusPrefs;
  setPrefs: (p: Partial<FocusPrefs>) => void;
  /** The session waiting for "how did it go?" */
  review: string | null;
  sessions: Session[];
  /** Daily goal, minutes */
  goal: number;
  /** Quiet reminders: money and release reminders that fall in this window wait until it's over */
  quiet: { from: number; until: number | null } | null;
  start: (s: Pick<Active, "intention" | "taskId" | "planned" | "breakMin" | "longBreak">) => void;
  pause: () => void;
  resume: () => void;
  extend: (minutes: number) => void;
  /** Ends the session and records it (too short to count: dropped) */
  finish: () => void;
  discard: () => void;
  park: (thought: string) => void;
  reflect: (id: string, outcome: Outcome, quality?: number) => void;
  dropThought: (sessionId: string, index: number) => void;
  endBreak: () => void;
  setGoal: (minutes: number) => void;
  removeSession: (id: string) => void;
};

export const focusedMs = (a: Active, now = Date.now()) => a.banked + (a.runningSince ? now - a.runningSince : 0);
export const remainingMs = (a: Active, now = Date.now()) => Math.max(0, a.planned * 60_000 - focusedMs(a, now));

export const useFocus = create<FocusState>()(
  persist(
    (set, get) => ({
      active: null,
      breakUntil: null,
      review: null,
      sessions: [],
      goal: 180,
      quiet: null,
      prefs: DEFAULT_PREFS,
      setPrefs: (p) => set((s) => ({ prefs: { ...DEFAULT_PREFS, ...s.prefs, ...p } })),
      start: ({ intention, taskId, planned, breakMin, longBreak }) => {
        const now = Date.now();
        set({
          active: { id: uid(), intention: intention.trim(), taskId, planned, breakMin, longBreak, startedAt: now, banked: 0, runningSince: now, thoughts: [] },
          breakUntil: null,
          review: null,
          quiet: { from: now, until: null },
        });
      },
      pause: () => {
        const a = get().active;
        if (!a?.runningSince) return;
        set({ active: { ...a, banked: focusedMs(a), runningSince: null } });
      },
      resume: () => {
        const a = get().active;
        if (!a || a.runningSince) return;
        set({ active: { ...a, runningSince: Date.now() } });
      },
      extend: (minutes) => {
        const a = get().active;
        if (a) set({ active: { ...a, planned: a.planned + minutes } });
      },
      finish: () => {
        const a = get().active;
        if (!a) return;
        // If Haven was closed when time ran out, the session ended back then, not now.
        const overshoot = Math.max(0, focusedMs(a) - a.planned * 60_000);
        const now = Date.now() - overshoot;
        const focused = Math.round(focusedMs(a, now) / 60_000);
        const quiet = { from: get().quiet?.from ?? a.startedAt, until: Date.now() };
        // Under a minute isn't a session; keep any thoughts parked in it all the same.
        if (focused < 1 && !a.thoughts.length) return set({ active: null, quiet });
        const session: Session = { id: a.id, intention: a.intention, taskId: a.taskId, planned: a.planned, start: a.startedAt, end: now, focused, thoughts: a.thoughts };
        set((s) => ({
          active: null,
          // Another device may have recorded it already.
          sessions: [session, ...s.sessions.filter((x) => x.id !== a.id)],
          review: a.id,
          breakUntil: a.breakMin && focused >= 1 ? now + a.breakMin * 60_000 : null,
          breakLong: !!a.longBreak,
          quiet,
        }));
      },
      discard: () => set({ active: null, quiet: null }),
      park: (thought) => {
        const a = get().active;
        if (a && thought.trim()) set({ active: { ...a, thoughts: [...a.thoughts, thought.trim()] } });
      },
      reflect: (id, outcome, quality) =>
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, outcome, quality } : x)), review: s.review === id ? null : s.review })),
      dropThought: (sessionId, index) =>
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, thoughts: x.thoughts.filter((_, i) => i !== index) } : x)) })),
      endBreak: () => set({ breakUntil: null }),
      setGoal: (goal) => set({ goal }),
      removeSession: (id) => set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), review: s.review === id ? null : s.review })),
    }),
    { name: "haven:focus", version: 1 },
  ),
);

/** Money and release reminders wait while you focus; event and task reminders still come. */
export function heldByFocus(key: string, at: number, now: number) {
  const { active, quiet } = useFocus.getState();
  const quietKind = !key.startsWith("e:") && !key.startsWith("t:");
  if (!quietKind) return { hold: false, late: false };
  if (active) return { hold: true, late: false };
  // Just finished: let the ones that fell during the session through, late.
  const late = !!quiet?.until && at >= quiet.from && now - quiet.until < 10 * 60_000;
  return { hold: false, late };
}

/* ---------- Numbers ---------- */

/** Sessions done today (that counted). */
export const todaysCount = (sessions: Session[], now = new Date()) => sessions.filter((s) => s.focused >= 1 && dayKey(new Date(s.start)) === dayKey(now)).length;

export function minutesByDay(sessions: Session[]) {
  const by = new Map<string, number>();
  for (const s of sessions) by.set(dayKey(new Date(s.start)), (by.get(dayKey(new Date(s.start))) ?? 0) + s.focused);
  return by;
}

/** The last 7 days, oldest first. */
export function lastWeek(sessions: Session[], now = new Date()) {
  const by = minutesByDay(sessions);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(startOfDay(now), i - 6);
    return { day: d, minutes: by.get(dayKey(d)) ?? 0 };
  });
}

/** Days in a row with at least one session, counting today only once it has one. */
export function streak(sessions: Session[], now = new Date()) {
  const by = minutesByDay(sessions);
  let d = startOfDay(now);
  if (!by.get(dayKey(d))) d = addDays(d, -1);
  let n = 0;
  while (by.get(dayKey(d))) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function clock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function hours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
