import { addDays, addMinutes } from "date-fns";
import { dayKey, parseDay } from "@/lib/dates";
import type { ReminderPrefs } from "@/store/settings";
import { expandEvents, formatDuration, formatTime, toMinutes, type CalendarEvent, type Task } from "@/modules/calendar/store";
import type { Plan } from "@/modules/calendar/scheduler";
import { billDates, type Bill } from "@/modules/finances/store";
import { CYCLES, step, type Subscription } from "@/modules/subscriptions/store";
import { KINDS, type Release } from "@/modules/releases/store";

export type Reminder = {
  /** Stable across recalculations as long as nothing about it changes; the system needs a number */
  id: number;
  key: string;
  /** When to show it (ms since epoch) */
  at: number;
  title: string;
  body: string;
};

/** Money reminders go out in the morning. */
const MORNING = 9 * 60;

const at = (day: string, minutes: number) => addMinutes(parseDay(day), minutes).getTime();

/** A positive 31-bit number from a string, for the notification id. */
function idFor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) || 1;
}

/** Every reminder due in the next `days` days, soonest first. */
export function upcomingReminders(input: {
  now: Date;
  days?: number;
  prefs: ReminderPrefs;
  events: CalendarEvent[];
  tasks: Task[];
  plan: Plan;
  bills: Bill[];
  subs: Subscription[];
  /** Releases you follow */
  releases?: Release[];
  money: (cents: number) => string;
}): Reminder[] {
  const { now, prefs, money } = input;
  const span = input.days ?? 7;
  const days = Array.from({ length: span + 1 }, (_, i) => addDays(parseDay(dayKey(now)), i));
  const from = dayKey(days[0]);
  const to = dayKey(days[days.length - 1]);
  const out: Omit<Reminder, "id">[] = [];
  const add = (r: Omit<Reminder, "id">) => r.at > now.getTime() && out.push(r);

  if (prefs.events !== null) {
    const lead = prefs.events;
    for (const list of expandEvents(input.events, days).values())
      for (const e of list) {
        if (!e.start) continue;
        const where = e.location ? ` · ${e.location}` : "";
        add({
          key: `e:${e.id}:${e.date}:${e.start}:${lead}`,
          at: at(e.date, toMinutes(e.start) - lead),
          title: e.title || "Event",
          body: `${lead ? `In ${formatDuration(lead)}` : "Starting now"} · ${formatTime(e.start)}${where}`,
        });
      }
  }

  if (prefs.tasks) {
    const byId = new Map(input.tasks.map((t) => [t.id, t]));
    for (const s of input.plan.slots) {
      const t = byId.get(s.taskId);
      if (!t || t.done || s.date > to) continue;
      add({
        key: `t:${t.id}:${s.date}:${s.start}`,
        at: at(s.date, toMinutes(s.start)),
        title: `Time for ${t.title}`,
        body: `${formatTime(s.start)} – ${formatTime(s.end)} · ${formatDuration(toMinutes(s.end) - toMinutes(s.start))}`,
      });
    }
  }

  if (prefs.bills)
    for (const b of input.bills)
      for (const date of billDates(b, from, to))
        add({ key: `b:${b.id}:${date}:${b.amount}`, at: at(date, MORNING), title: `${b.name} is due today`, body: `${money(b.amount)}${b.autopay ? " · paid automatically" : ""}` });

  if (prefs.subscriptions)
    for (const s of input.subs) {
      if (s.status === "trial" && s.trialEnds && s.trialEnds >= from && s.trialEnds <= dayKey(addDays(parseDay(to), 1)))
        add({ key: `trial:${s.id}:${s.trialEnds}`, at: at(s.trialEnds, MORNING - 24 * 60), title: `Your ${s.name} trial ends tomorrow`, body: `After that it's ${money(s.price)} per ${CYCLES[s.cycle].per}` });
      if (s.status !== "active") continue;
      let d = parseDay(s.renews);
      for (let i = 0; dayKey(d) <= dayKey(addDays(parseDay(to), 1)) && i < 1000; i++, d = step(d, s.cycle))
        if (dayKey(d) >= from)
          add({ key: `renew:${s.id}:${dayKey(d)}:${s.price}`, at: at(dayKey(d), MORNING - 24 * 60), title: `${s.name} renews tomorrow`, body: money(s.price) });
    }

  if (prefs.releases !== false)
    for (const r of input.releases ?? [])
      if (r.date >= from && r.date <= to)
        add({
          key: `release:${r.id}:${r.date}`,
          at: at(r.date, MORNING),
          title: `Out today: ${r.title}`,
          body: [KINDS[r.kind].label, r.subtitle].filter(Boolean).join(" · "),
        });

  return out.sort((a, b) => a.at - b.at).map((r) => ({ ...r, id: idFor(r.key) }));
}
