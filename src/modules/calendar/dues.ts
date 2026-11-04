import { addDays } from "date-fns";
import { dayKey, parseDay, todayKey } from "@/lib/dates";
import { billDates, type Bill } from "@/modules/finances/store";
import { step, type Subscription } from "@/modules/subscriptions/store";
import { compareEvents } from "./store";
import type { Block } from "./plan";

/**
 * Money that leaves on a given day: your bills and subscription renewals, as all-day items.
 * A bill that's overdue sits on today until you pay or skip it.
 */
export function dueBlocks(days: Date[], bills: Bill[], subs: Subscription[], format: (cents: number) => string) {
  const map = new Map<string, Block[]>();
  if (!days.length) return map;
  const from = dayKey(days[0]);
  const to = dayKey(days[days.length - 1]);
  const today = todayKey();
  const push = (b: Block) => map.set(b.date, [...(map.get(b.date) ?? []), b]);

  for (const b of bills) {
    const overdue = b.due < today;
    if (overdue && today >= from && today <= to)
      push({ key: `b:${b.id}:late`, kind: "bill", id: b.id, title: `${b.name} · overdue`, date: today, color: "rose", amount: b.amount, overdue: true });
    // An overdue bill's later due dates still show, from tomorrow on.
    const tomorrow = dayKey(addDays(parseDay(today), 1));
    for (const date of billDates(b, overdue && tomorrow > from ? tomorrow : from, to)) {
      push({ key: `b:${b.id}:${date}`, kind: "bill", id: b.id, title: `${b.name} · ${format(b.amount)}`, date, color: b.color, amount: b.amount });
    }
  }

  for (const s of subs) {
    if (s.status === "trial" && s.trialEnds && s.trialEnds >= from && s.trialEnds <= to)
      push({ key: `s:${s.id}:trial`, kind: "renewal", id: s.id, title: `${s.name} trial ends`, date: s.trialEnds, color: "amber" });
    if (s.status !== "active") continue;
    let d = parseDay(s.renews);
    for (let i = 0; dayKey(d) <= to && i < 1000; i++, d = step(d, s))
      if (dayKey(d) >= from) push({ key: `s:${s.id}:${dayKey(d)}`, kind: "renewal", id: s.id, title: `${s.name} · ${format(s.price)}`, date: dayKey(d), color: s.color, amount: s.price });
  }
  return map;
}

/** Adds the money items to the calendar's blocks, keeping each day in order (all-day items first). */
export function mergeBlocks(base: Map<string, Block[]>, extra: Map<string, Block[]>) {
  if (!extra.size) return base;
  const out = new Map(base);
  for (const [date, list] of extra) out.set(date, [...(out.get(date) ?? []), ...list].sort(compareEvents));
  return out;
}
