import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import { dayKey, parseDay, todayKey } from "@/lib/dates";
import { step as stepCycle, type Cycle, type Every } from "@/modules/subscriptions/store";
import type { Cents } from "@/lib/money";
import type { AccountKind } from "./icons";
import type { Mapping } from "./importers";

export type TxKind = "expense" | "income" | "transfer";

/** Transfers have no category of their own. */
export const TRANSFER = "transfer";

export type Account = { id: string; name: string; kind: AccountKind; opening: Cents; color: string };

export type Category = {
  id: string;
  name: string;
  kind: TxKind;
  icon: string;
  color: string;
  /** Monthly budget, expense categories only */
  budget?: Cents;
};

export type Transaction = {
  id: string;
  kind: TxKind;
  /** Always positive; `kind` gives the direction */
  amount: Cents;
  categoryId: string;
  /** For transfers, the account the money leaves */
  accountId: string;
  /** Transfers only: the account the money goes to */
  toAccountId?: string;
  /** yyyy-MM-dd */
  date: string;
  note?: string;
  /** Set when the transaction records paying a bill */
  billId?: string;
  /** Set when it's a subscription payment you marked as paid */
  subscriptionId?: string;
  /** Set on imported transactions: identifies the statement line, so it's never imported twice */
  importKey?: string;
};

/** A bill that comes back on a cycle: rent, electricity, insurance… */
export type Bill = {
  id: string;
  name: string;
  amount: Cents;
  cycle: Cycle;
  /** A custom interval, overriding `cycle` */
  every?: Every;
  /** yyyy-MM-dd — the next payment still to make; moves on when you mark it paid or skip it */
  due: string;
  accountId: string;
  categoryId: string;
  color: string;
  /** Taken automatically (direct debit); still waits for you to confirm it went out */
  autopay?: boolean;
  notes?: string;
};

/** "Whenever a description contains this, file it under that category" */
export type Rule = { id: string; match: string; categoryId: string };

type Draft<T extends { id: string }> = Omit<T, "id"> & { id?: string };

export type FinanceData = { accounts: Account[]; categories: Category[]; transactions: Transaction[] };

type FinanceState = FinanceData & {
  rules: Rule[];
  bills: Bill[];
  /** Column layouts of CSV files seen before, keyed by their header line */
  csvPresets: Record<string, Mapping>;
  saveTransaction: (t: Draft<Transaction>) => void;
  addTransactions: (txs: Omit<Transaction, "id">[]) => void;
  saveRule: (match: string, categoryId: string) => void;
  removeRule: (id: string) => void;
  savePreset: (signature: string, mapping: Mapping) => void;
  removeTransaction: (id: string) => void;
  saveAccount: (a: Draft<Account>) => void;
  removeAccount: (id: string) => void;
  saveCategory: (c: Draft<Category>) => void;
  removeCategory: (id: string) => void;
  saveBill: (b: Draft<Bill>) => void;
  removeBill: (id: string) => void;
  /** Records the payment as an expense (dated `on`, today by default) and moves the bill to its next due date. */
  payBill: (id: string, on?: string) => void;
  /** Moves the bill to its next due date without recording a payment. */
  skipBill: (id: string) => void;
  replaceAll: (data: FinanceData & { rules?: Rule[]; bills?: Bill[] }) => void;
};

function upsert<T extends { id: string }>(list: T[], draft: Draft<T>): T[] {
  if (draft.id) return list.map((x) => (x.id === draft.id ? ({ ...draft } as T) : x));
  return [...list, { ...draft, id: uid() } as T];
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "groceries", name: "Groceries", kind: "expense", icon: "ShoppingBasket", color: "green", budget: 40000 },
  { id: "dining", name: "Dining out", kind: "expense", icon: "Utensils", color: "orange", budget: 20000 },
  { id: "housing", name: "Housing", kind: "expense", icon: "Home", color: "violet" },
  { id: "transport", name: "Transport", kind: "expense", icon: "Car", color: "blue", budget: 12000 },
  { id: "utilities", name: "Utilities", kind: "expense", icon: "Zap", color: "amber" },
  { id: "health", name: "Health", kind: "expense", icon: "HeartPulse", color: "rose" },
  { id: "shopping", name: "Shopping", kind: "expense", icon: "ShoppingBag", color: "pink", budget: 15000 },
  { id: "leisure", name: "Leisure", kind: "expense", icon: "Film", color: "teal", budget: 10000 },
  { id: "subscriptions", name: "Subscriptions", kind: "expense", icon: "Repeat", color: "slate" },
  { id: "other-expense", name: "Other", kind: "expense", icon: "CircleDashed", color: "slate" },
  { id: "salary", name: "Salary", kind: "income", icon: "Briefcase", color: "teal" },
  { id: "freelance", name: "Freelance", kind: "income", icon: "Laptop", color: "blue" },
  { id: "gifts", name: "Gifts", kind: "income", icon: "Gift", color: "pink" },
  { id: "other-income", name: "Other income", kind: "income", icon: "Coins", color: "amber" },
];

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: "main", name: "Main account", kind: "checking", opening: 0, color: "violet" },
];

export const useFinance = create<FinanceState>()(
  persist(
    (set) => ({
      accounts: DEFAULT_ACCOUNTS,
      categories: DEFAULT_CATEGORIES,
      transactions: [],
      rules: [],
      bills: [],
      csvPresets: {},
      saveTransaction: (t) => set((s) => ({ transactions: upsert(s.transactions, t) })),
      addTransactions: (txs) => set((s) => ({ transactions: [...s.transactions, ...txs.map((t) => ({ ...t, id: uid() }))] })),
      saveRule: (match, categoryId) =>
        set((s) => {
          const key = match.trim().toLowerCase();
          if (!key) return {};
          const others = s.rules.filter((r) => r.match !== key);
          return { rules: [...others, { id: uid(), match: key, categoryId }] };
        }),
      removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      savePreset: (signature, mapping) => set((s) => ({ csvPresets: { ...s.csvPresets, [signature]: mapping } })),
      removeTransaction: (id) => set((s) => ({ transactions: s.transactions.filter((t) => t.id !== id) })),
      saveAccount: (a) => set((s) => ({ accounts: upsert(s.accounts, a) })),
      // Removing an account removes its transactions (and transfers to it) too; the UI confirms first.
      // Bills paid from it move to the first remaining account.
      removeAccount: (id) =>
        set((s) => {
          const accounts = s.accounts.filter((a) => a.id !== id);
          return {
            accounts,
            transactions: s.transactions.filter((t) => t.accountId !== id && t.toAccountId !== id),
            bills: s.bills.map((b) => (b.accountId === id ? { ...b, accountId: accounts[0]?.id ?? "" } : b)),
          };
        }),
      saveCategory: (c) => set((s) => ({ categories: upsert(s.categories, c) })),
      // Transactions in a removed category fall back to that kind's "Other".
      removeCategory: (id) =>
        set((s) => {
          const cat = s.categories.find((c) => c.id === id);
          const fallback = cat?.kind === "income" ? "other-income" : "other-expense";
          return {
            categories: s.categories.filter((c) => c.id !== id),
            transactions: s.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: fallback } : t)),
          };
        }),
      saveBill: (b) => set((s) => ({ bills: upsert(s.bills, b) })),
      removeBill: (id) => set((s) => ({ bills: s.bills.filter((b) => b.id !== id) })),
      payBill: (id, on = todayKey()) =>
        set((s) => {
          const b = s.bills.find((x) => x.id === id);
          if (!b) return {};
          const tx: Transaction = { id: uid(), kind: "expense", amount: b.amount, categoryId: b.categoryId, accountId: b.accountId, date: on, note: b.name, billId: b.id };
          return { transactions: [...s.transactions, tx], bills: s.bills.map((x) => (x.id === id ? { ...x, due: nextDue(x) } : x)) };
        }),
      skipBill: (id) => set((s) => ({ bills: s.bills.map((x) => (x.id === id ? { ...x, due: nextDue(x) } : x)) })),
      replaceAll: ({ rules, bills, ...data }) => set((s) => ({ ...data, rules: rules ?? s.rules, bills: bills ?? s.bills })),
    }),
    {
      name: "haven:finances",
      version: 3,
      migrate: (persisted, version) => {
        let s = persisted as Partial<FinanceState>;
        if (version < 2) s = { ...s, rules: [], csvPresets: {} };
        if (version < 3) s = { ...s, bills: [] };
        return s;
      },
    },
  ),
);

/* ---------- Derived data ---------- */

/** What a transaction does to your overall money: transfers only move it between your accounts. */
export const signed = (t: Transaction) => (t.kind === "income" ? t.amount : t.kind === "expense" ? -t.amount : 0);

/** What a transaction does to one account's balance. */
export function effectOn(t: Transaction, accountId: string) {
  if (t.kind === "transfer") return (t.toAccountId === accountId ? t.amount : 0) - (t.accountId === accountId ? t.amount : 0);
  return t.accountId === accountId ? signed(t) : 0;
}

export const touches = (t: Transaction, accountId: string) => t.accountId === accountId || t.toAccountId === accountId;

export function accountBalance(account: Account, txs: Transaction[]) {
  return txs.reduce((sum, t) => sum + effectOn(t, account.id), account.opening);
}

export function totalBalance(accounts: Account[], txs: Transaction[]) {
  return accounts.reduce((sum, a) => sum + accountBalance(a, txs), 0);
}

export function inMonth(txs: Transaction[], month: string) {
  return txs.filter((t) => t.date.startsWith(month));
}

export function totals(txs: Transaction[]) {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.kind === "income") income += t.amount;
    else if (t.kind === "expense") expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

export function spendByCategory(txs: Transaction[]) {
  const map = new Map<string, Cents>();
  for (const t of txs) if (t.kind === "expense") map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
  return map;
}

export function sortTransactions(txs: Transaction[]) {
  return [...txs].sort((a, b) => b.date.localeCompare(a.date));
}

/* ---------- Bills ---------- */

export function nextDue(b: Bill) {
  return dayKey(stepCycle(parseDay(b.due), b));
}

/** Every due date of a bill between `from` and `to` (yyyy-MM-dd), starting from its next unpaid one. */
export function billDates(b: Bill, from: string, to: string) {
  const out: string[] = [];
  let d = parseDay(b.due);
  for (let i = 0; dayKey(d) <= to && i < 600; i++, d = stepCycle(d, b)) if (dayKey(d) >= from) out.push(dayKey(d));
  return out;
}
