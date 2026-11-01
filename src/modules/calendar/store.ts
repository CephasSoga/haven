import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";

export type CalendarEvent = {
  id: string;
  title: string;
  /** yyyy-MM-dd */
  date: string;
  /** HH:mm — both absent means an all-day event */
  start?: string;
  end?: string;
  color: string;
  location?: string;
  notes?: string;
};

export type EventDraft = Omit<CalendarEvent, "id"> & { id?: string };

type CalendarState = {
  events: CalendarEvent[];
  save: (draft: EventDraft) => void;
  remove: (id: string) => void;
  replaceAll: (events: CalendarEvent[]) => void;
};

export const useCalendar = create<CalendarState>()(
  persist(
    (set) => ({
      events: [],
      save: (draft) =>
        set((s) => {
          if (draft.id) {
            return { events: s.events.map((e) => (e.id === draft.id ? ({ ...draft, id: draft.id } as CalendarEvent) : e)) };
          }
          return { events: [...s.events, { ...draft, id: uid() }] };
        }),
      remove: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
      replaceAll: (events) => set({ events }),
    }),
    { name: "haven:calendar", version: 1 },
  ),
);

export function isAllDay(e: CalendarEvent) {
  return !e.start;
}

export function compareEvents(a: CalendarEvent, b: CalendarEvent) {
  if (!a.start && b.start) return -1;
  if (a.start && !b.start) return 1;
  return (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title);
}

export function eventsByDate(events: CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  for (const list of map.values()) list.sort(compareEvents);
  return map;
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, min));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** "09:30" → "9:30" in the user's locale (12h or 24h). */
export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function timeRange(e: CalendarEvent) {
  if (!e.start) return "All day";
  return e.end ? `${formatTime(e.start)} – ${formatTime(e.end)}` : formatTime(e.start);
}
