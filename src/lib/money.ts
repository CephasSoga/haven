import { useSettings } from "@/store/settings";

/** All money is stored as integer cents to avoid floating point drift. */
export type Cents = number;

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean) {
  const key = `${currency}:${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      ...(compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(cents: Cents, currency: string, opts: { compact?: boolean; sign?: boolean } = {}) {
  const value = formatter(currency, !!opts.compact).format(Math.abs(cents) / 100);
  if (cents < 0) return `−${value}`;
  if (opts.sign && cents > 0) return `+${value}`;
  return value;
}

export function useMoney() {
  const currency = useSettings((s) => s.currency);
  return (cents: Cents, opts?: { compact?: boolean; sign?: boolean }) => formatMoney(cents, currency, opts);
}

/** Parses "12,50", "12.5", "1 200" etc. into cents. Returns null when not a number. */
export function parseAmount(input: string): Cents | null {
  const cleaned = input.replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function centsToInput(cents: Cents) {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

export function currencySymbol(currency: string) {
  return (
    new Intl.NumberFormat(undefined, { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency
  );
}
