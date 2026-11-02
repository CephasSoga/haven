import { create } from "zustand";
import { persist } from "zustand/middleware";
import { addDays, addMonths, addYears, differenceInCalendarDays } from "date-fns";
import { uid } from "@/lib/utils";
import { dayKey, parseDay, todayKey } from "@/lib/dates";
import type { Cents } from "@/lib/money";

export type Cycle = "weekly" | "monthly" | "quarterly" | "yearly";
export type SubStatus = "active" | "trial" | "paused" | "cancelled";

export type Subscription = {
  id: string;
  name: string;
  /** Price per billing cycle */
  price: Cents;
  cycle: Cycle;
  /** yyyy-MM-dd — a renewal date; later ones are worked out from the cycle */
  renews: string;
  category: string;
  status: SubStatus;
  /** yyyy-MM-dd — when a free trial turns into a paid plan */
  trialEnds?: string;
  /** e.g. "Visa ••4242" or "PayPal" */
  paidWith?: string;
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

export function step(d: Date, cycle: Cycle, n = 1) {
  if (cycle === "weekly") return addDays(d, 7 * n);
  if (cycle === "monthly") return addMonths(d, n);
  if (cycle === "quarterly") return addMonths(d, 3 * n);
  return addYears(d, n);
}

/** The next renewal on or after today, rolling forward from the stored date. */
export function nextRenewal(s: Subscription, today = todayKey()) {
  let d = parseDay(s.renews);
  for (let i = 0; dayKey(d) < today && i < 1000; i++) d = step(d, s.cycle);
  return dayKey(d);
}

export function daysUntil(date: string) {
  return differenceInCalendarDays(parseDay(date), parseDay(todayKey()));
}

export const counts = (s: Subscription) => s.status === "active" || s.status === "trial";

export function monthlyCost(s: Subscription) {
  return Math.round(CYCLES[s.cycle].perMonth(s.price));
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
