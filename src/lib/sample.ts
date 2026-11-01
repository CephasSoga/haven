import { addDays, eachDayOfInterval, getDay, getDate, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { dayKey } from "./dates";
import { uid } from "./utils";
import type { CalendarEvent } from "@/modules/calendar/store";
import { DEFAULT_CATEGORIES, type FinanceData, type Transaction } from "@/modules/finances/store";

/** Small deterministic PRNG so sample data looks the same every time. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleFinances(today = new Date()): FinanceData {
  const r = rng(42);
  const between = (min: number, max: number) => Math.round((min + r() * (max - min)) * 100);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const txs: Transaction[] = [];
  const add = (date: Date, kind: Transaction["kind"], categoryId: string, amount: number, note?: string, accountId = "main") =>
    txs.push({ id: uid(), kind, categoryId, amount, date: dayKey(date), note, accountId });

  for (const d of eachDayOfInterval({ start: startOfMonth(subMonths(today, 5)), end: today })) {
    const dom = getDate(d);
    const dow = getDay(d);
    if (dom === 1) add(d, "income", "salary", 320000, "Monthly salary");
    if (dom === 2) add(d, "income", "other-income", between(4, 9), "Interest", "savings");
    if (dom === 3) add(d, "expense", "housing", 115000, "Rent");
    if (dom === 5) add(d, "expense", "utilities", between(85, 140), "Electricity & water");
    if (dom === 6) add(d, "expense", "utilities", 3999, "Internet");
    if (dom === 8) add(d, "expense", "subscriptions", 1099, "Music streaming");
    if (dom === 12) add(d, "expense", "subscriptions", 1399, "Video streaming");
    if (dom === 15 && d.getMonth() % 2 === 0) add(d, "income", "freelance", between(450, 900), "Logo project");
    if (dow === 6) add(d, "expense", "groceries", between(55, 120), pick(["Weekly groceries", "Market run", "Supermarket"]));
    if (dow === 3 && r() < 0.6) add(d, "expense", "groceries", between(12, 35), "Bakery & fruit", "cash");
    if (r() < 0.28) add(d, "expense", "dining", between(9, 58), pick(["Lunch out", "Coffee & pastry", "Dinner with friends", "Takeaway"]));
    if (r() < 0.18) add(d, "expense", "transport", between(2, 45), pick(["Metro pass top-up", "Fuel", "Train ticket", "Ride"]));
    if (r() < 0.06) add(d, "expense", "shopping", between(25, 140), pick(["New shoes", "Home goods", "Books", "Kitchenware"]));
    if (r() < 0.06) add(d, "expense", "leisure", between(10, 60), pick(["Cinema", "Concert tickets", "Museum", "Bowling"]));
    if (r() < 0.035) add(d, "expense", "health", between(8, 45), pick(["Pharmacy", "Doctor visit"]));
  }

  return {
    accounts: [
      { id: "main", name: "Everyday", kind: "checking", opening: 185000, color: "violet" },
      { id: "savings", name: "Savings", kind: "savings", opening: 640000, color: "teal" },
      { id: "cash", name: "Cash", kind: "cash", opening: 48000, color: "amber" },
    ],
    categories: DEFAULT_CATEGORIES,
    transactions: txs,
  };
}

export function sampleEvents(today = new Date(), weekStartsOn: 0 | 1 = 1): CalendarEvent[] {
  const ev = (date: Date, title: string, color: string, start?: string, end?: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: uid(),
    title,
    date: dayKey(date),
    start,
    end,
    color,
    ...extra,
  });
  const week = startOfWeek(today, { weekStartsOn });
  const out: CalendarEvent[] = [];

  // A few recurring rhythms across last week, this week and the next two.
  for (let w = -1; w <= 2; w++) {
    const base = addDays(week, w * 7);
    const at = (dayOfWeek: number) => addDays(base, (dayOfWeek - weekStartsOn + 7) % 7);
    out.push(ev(at(1), "Team sync", "violet", "09:30", "10:00", { location: "Studio" }));
    out.push(ev(at(2), "Yoga", "green", "18:30", "19:30", { location: "Riverside studio" }));
    out.push(ev(at(4), "Yoga", "green", "18:30", "19:30", { location: "Riverside studio" }));
    out.push(ev(at(3), "Deep work", "blue", "14:00", "17:00"));
    out.push(ev(at(6), "Farmers market", "amber", "10:00", "11:30"));
  }

  out.push(
    ev(today, "Morning run", "teal", "07:00", "07:45"),
    ev(today, "Design review", "violet", "11:00", "12:00", { location: "Room 3" }),
    ev(today, "Lunch with Amara", "orange", "12:30", "13:30", { location: "Le Petit Jardin" }),
    ev(today, "Call with the bank", "slate", "16:00", "16:30"),
    ev(addDays(today, 1), "Dentist", "rose", "09:00", "09:45", { notes: "Bring insurance card" }),
    ev(addDays(today, 2), "Movie night", "pink", "20:00", "22:30"),
    ev(addDays(today, 4), "Mum's birthday", "pink"),
    ev(addDays(today, 9), "Weekend in the mountains", "teal"),
    ev(addDays(today, 10), "Weekend in the mountains", "teal"),
    ev(addDays(today, -3), "Haircut", "slate", "17:00", "17:45"),
    ev(addDays(today, 6), "Dinner with family", "orange", "19:00", "21:30"),
    ev(addDays(today, 13), "Quarterly review", "violet", "14:00", "15:30"),
  );
  return out;
}
