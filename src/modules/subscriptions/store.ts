import { create } from "zustand";
import { persist } from "zustand/middleware";
import { addDays, addMonths, addYears, differenceInCalendarDays } from "date-fns";
import { uid } from "@/lib/utils";
import { dayKey, parseDay, todayKey } from "@/lib/dates";
import type { Cents } from "@/lib/money";

export type Cycle = "weekly" | "monthly" | "quarterly" | "yearly";
export type Unit = "day" | "week" | "month" | "year";
/** A custom interval: every `n` days, weeks, months or years */
export type Every = { n: number; unit: Unit };
/**
 * How often something comes round: one of the usual cycles, or a custom interval. A custom
 * interval still keeps the nearest usual cycle in `cycle`, so copies of Haven from before
 * custom intervals existed read it sensibly instead of breaking.
 */
export type Repeats = { cycle: Cycle; every?: Every };
export type SubStatus = "active" | "trial" | "paused" | "cancelled";

export type Subscription = {
  id: string;
  name: string;
  /** Price per billing cycle */
  price: Cents;
  cycle: Cycle;
  /** A custom interval, overriding `cycle` */
  every?: Every;
  /** yyyy-MM-dd — a renewal date; later ones are worked out from the cycle */
  renews: string;
  category: string;
  status: SubStatus;
  /** yyyy-MM-dd — when a free trial turns into a paid plan */
  trialEnds?: string;
  /** e.g. "Visa ••4242" or "PayPal" */
  paidWith?: string;
  /** The Finances account payments come out of, when you mark them paid */
  accountId?: string;
  /** yyyy-MM-dd — the latest renewal you've marked as paid */
  paidThrough?: string;
  /** Where to manage or cancel it */
  url?: string;
  emoji?: string;
  color: string;
  notes?: string;
  createdAt: number;
};

export type SubDraft = Omit<Subscription, "id" | "createdAt"> & { id?: string; createdAt?: number };

type SubsState = {
  subs: Subscription[];
  /** Recurring charges you said aren't subscriptions, so they stop being suggested */
  dismissed: string[];
  save: (draft: SubDraft) => void;
  remove: (id: string) => void;
  dismiss: (key: string) => void;
  replaceAll: (subs: Subscription[]) => void;
};

export const useSubscriptions = create<SubsState>()(
  persist(
    (set) => ({
      subs: [],
      dismissed: [],
      save: (d) =>
        set((s) => {
          const sub: Subscription = { ...d, id: d.id ?? uid(), createdAt: d.createdAt ?? Date.now() };
          return { subs: d.id ? s.subs.map((x) => (x.id === d.id ? sub : x)) : [...s.subs, sub] };
        }),
      remove: (id) => set((s) => ({ subs: s.subs.filter((x) => x.id !== id) })),
      dismiss: (key) => set((s) => ({ dismissed: [...new Set([...s.dismissed, key])] })),
      replaceAll: (subs) => set({ subs }),
    }),
    { name: "haven:subscriptions", version: 1 },
  ),
);

export const CYCLES: Record<Cycle, { label: string; per: string; perMonth: (p: number) => number }> = {
  weekly: { label: "Weekly", per: "week", perMonth: (p) => (p * 52) / 12 },
  monthly: { label: "Monthly", per: "month", perMonth: (p) => p },
  quarterly: { label: "Every 3 months", per: "quarter", perMonth: (p) => p / 3 },
  yearly: { label: "Yearly", per: "year", perMonth: (p) => p / 12 },
};

export const CATEGORIES: Record<string, { label: string; emoji: string }> = {
  streaming: { label: "Streaming", emoji: "🎬" },
  music: { label: "Music & audio", emoji: "🎧" },
  software: { label: "Software & apps", emoji: "💻" },
  cloud: { label: "Cloud & storage", emoji: "☁️" },
  ai: { label: "AI tools", emoji: "✨" },
  news: { label: "News & reading", emoji: "📰" },
  gaming: { label: "Gaming", emoji: "🎮" },
  fitness: { label: "Health & fitness", emoji: "🏃" },
  learning: { label: "Learning", emoji: "🎓" },
  shopping: { label: "Shopping & delivery", emoji: "🛍️" },
  telecom: { label: "Phone & internet", emoji: "📶" },
  other: { label: "Other", emoji: "🔁" },
};

export const UNITS: Record<Unit, { one: string; many: string; perMonth: number }> = {
  day: { one: "day", many: "days", perMonth: 365.25 / 12 },
  week: { one: "week", many: "weeks", perMonth: 52 / 12 },
  month: { one: "month", many: "months", perMonth: 1 },
  year: { one: "year", many: "years", perMonth: 1 / 12 },
};

/** The usual cycle closest to a custom interval, for older copies of Haven. */
export const nearestCycle = (u: Unit): Cycle => (u === "year" ? "yearly" : u === "month" ? "monthly" : "weekly");

const custom = (r: Cycle | Repeats) => (typeof r === "string" ? undefined : r.every && r.every.n > 0 ? r.every : undefined);

/** "Monthly", "Every 2 weeks"… */
export function cycleLabel(r: Repeats) {
  const e = custom(r);
  if (!e) return CYCLES[r.cycle].label;
  return e.n === 1 ? `Every ${UNITS[e.unit].one}` : `Every ${e.n} ${UNITS[e.unit].many}`;
}

/** "month", "2 weeks"… — as in "€9.99 / month". */
export function perLabel(r: Repeats) {
  const e = custom(r);
  if (!e) return CYCLES[r.cycle].per;
  return e.n === 1 ? UNITS[e.unit].one : `${e.n} ${UNITS[e.unit].many}`;
}

/** What a price per cycle comes to per month. */
export function perMonth(r: Repeats, price: number) {
  const e = custom(r);
  return e ? (price * UNITS[e.unit].perMonth) / e.n : CYCLES[r.cycle].perMonth(price);
}

/** Moves a date on by `n` cycles — of a usual cycle, or of a subscription's or bill's own interval. */
export function step(d: Date, r: Cycle | Repeats, n = 1) {
  const e = custom(r);
  if (e) {
    const k = e.n * n;
    return e.unit === "day" ? addDays(d, k) : e.unit === "week" ? addDays(d, 7 * k) : e.unit === "month" ? addMonths(d, k) : addYears(d, k);
  }
  const cycle = typeof r === "string" ? r : r.cycle;
  if (cycle === "weekly") return addDays(d, 7 * n);
  if (cycle === "monthly") return addMonths(d, n);
  if (cycle === "quarterly") return addMonths(d, 3 * n);
  return addYears(d, n);
}

/** The next renewal on or after today, rolling forward from the stored date. */
export function nextRenewal(s: Subscription, today = todayKey()) {
  let d = parseDay(s.renews);
  for (let i = 0; dayKey(d) < today && i < 1000; i++) d = step(d, s);
  return dayKey(d);
}

/** The latest renewal on or before today — the payment for the period you're in — if one has happened. */
export function lastRenewal(s: Subscription, today = todayKey()) {
  let d = parseDay(s.renews);
  if (dayKey(d) > today) return null;
  for (let i = 0; i < 5000; i++) {
    const next = step(d, s);
    if (dayKey(next) > today) break;
    d = next;
  }
  return dayKey(d);
}

/**
 * The payment you can mark as paid now: this period's renewal if it isn't marked yet, or the next
 * one when it's within a week. `overdue` is only said once you've started marking payments for it.
 */
export function payable(s: Subscription, today = todayKey()): { date: string; overdue: boolean; early: boolean } | null {
  if (s.status !== "active") return null;
  const paid = (d: string) => !!s.paidThrough && s.paidThrough >= d;
  const current = lastRenewal(s, today);
  if (current && !paid(current)) return { date: current, overdue: !!s.paidThrough && current < today, early: false };
  const next = current ? dayKey(step(parseDay(current), s)) : nextRenewal(s, today);
  if (!paid(next) && daysUntil(next) <= 7) return { date: next, overdue: false, early: next > today };
  return null;
}

export function daysUntil(date: string) {
  return differenceInCalendarDays(parseDay(date), parseDay(todayKey()));
}

export const counts = (s: Subscription) => s.status === "active" || s.status === "trial";

export function monthlyCost(s: Subscription) {
  return Math.round(perMonth(s, s.price));
}

export function totals(subs: Subscription[]) {
  const live = subs.filter((s) => s.status === "active" || (s.status === "trial" && s.trialEnds && daysUntil(s.trialEnds) <= 0));
  const month = live.reduce((sum, s) => sum + monthlyCost(s), 0);
  return { month, year: month * 12, count: subs.filter(counts).length };
}

/** Renewals and trial endings coming up in the next `days` days, soonest first. */
export function upcoming(subs: Subscription[], days = 7) {
  const out: { sub: Subscription; date: string; kind: "renewal" | "trial" }[] = [];
  for (const s of subs) {
    if (s.status === "trial" && s.trialEnds && daysUntil(s.trialEnds) >= 0 && daysUntil(s.trialEnds) <= days) out.push({ sub: s, date: s.trialEnds, kind: "trial" });
    else if (s.status === "active") {
      const d = nextRenewal(s);
      if (daysUntil(d) <= days) out.push({ sub: s, date: d, kind: "renewal" });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function whenLabel(date: string) {
  const n = daysUntil(date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 0) return `${-n} days ago`;
  return `in ${n} days`;
}
