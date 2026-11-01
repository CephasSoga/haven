import { format, parseISO } from "date-fns";

/** Local calendar day as "yyyy-MM-dd" — the key used everywhere dates are stored. */
export function dayKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function parseDay(key: string) {
  return parseISO(key);
}

export function todayKey() {
  return dayKey(new Date());
}

export function monthKey(d: Date) {
  return format(d, "yyyy-MM");
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
