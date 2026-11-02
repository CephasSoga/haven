import { useMemo, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Receipt, Search } from "lucide-react";
import { Card, EmptyState, Input, Segmented } from "@/components/ui";
import { monthKey, parseDay } from "@/lib/dates";
import { useMoney } from "@/lib/money";
import { TxRow } from "./parts";
import { inMonth, signed, sortTransactions, totals, useFinance, type Transaction } from "./store";

type Filter = "all" | "expense" | "income" | "transfer";

function dayLabel(key: string) {
  const d = parseDay(key);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMMM d");
}

export function TransactionsTab({ month, onOpenTx }: { month: Date; onOpenTx: (t: Transaction) => void }) {
  const { accounts, categories, transactions } = useFinance();
  const money = useMoney();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortTransactions(inMonth(transactions, monthKey(month))).filter((t) => {
      if (filter !== "all" && t.kind !== filter) return false;
      if (!q) return true;
      const hay = `${t.note ?? ""} ${t.kind === "transfer" ? "transfer" : catById.get(t.categoryId)?.name ?? ""} ${accById.get(t.accountId)?.name ?? ""} ${accById.get(t.toAccountId ?? "")?.name ?? ""}`;
      return hay.toLowerCase().includes(q);
    });
  }, [transactions, month, query, filter, catById, accById]);

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of list) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()];
  }, [list]);

  const sum = totals(list);
  const moved = list.reduce((s, t) => s + (t.kind === "transfer" ? t.amount : 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes, categories, accounts" className="pl-10" />
        </div>
        <Segmented
          layoutId="tx-filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "expense", label: "Expenses" },
            { value: "income", label: "Income" },
            { value: "transfer", label: "Transfers" },
          ]}
        />
      </div>

      {list.length > 0 && (
        <div className="flex gap-6 px-1 text-[13px] text-muted">
          <span>
            {list.length} {list.length === 1 ? "transaction" : "transactions"}
          </span>
          <span>
            In <span className="font-medium text-pos tabular">{money(sum.income)}</span>
          </span>
          <span>
            Out <span className="font-medium text-ink tabular">{money(sum.expense)}</span>
          </span>
          {moved > 0 && (
            <span>
              Moved <span className="font-medium text-ink tabular">{money(moved)}</span>
            </span>
          )}
        </div>
      )}

      <Card className="p-3">
        {groups.length ? (
          groups.map(([date, txs]) => {
            const dayNet = txs.reduce((s, t) => s + signed(t), 0);
            return (
              <section key={date} className="mb-2 last:mb-0">
                <div className="flex items-baseline justify-between px-3 pb-1 pt-3">
                  <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{dayLabel(date)}</h4>
                  <span className="text-[12px] text-faint tabular">{money(dayNet, { sign: true })}</span>
                </div>
                {txs.map((tx) => (
                  <TxRow key={tx.id} tx={tx} category={catById.get(tx.categoryId)} account={accById.get(tx.accountId)} onClick={() => onOpenTx(tx)} />
                ))}
              </section>
            );
          })
        ) : (
          <EmptyState
            icon={<Receipt className="size-5" />}
            title={query || filter !== "all" ? "No matches" : "No transactions"}
            body={query || filter !== "all" ? "Try a different search or filter." : `Nothing recorded in ${format(month, "MMMM")} yet.`}
          />
        )}
      </Card>
    </div>
  );
}
