import { useMemo } from "react";
import { format, subMonths } from "date-fns";
import { ArrowDownRight, ArrowUpRight, PiggyBank, Receipt } from "lucide-react";
import { Card, CardHeader, EmptyState, Progress } from "@/components/ui";
import { monthKey } from "@/lib/dates";
import { useMoney } from "@/lib/money";
import { swatch } from "@/lib/utils";
import { CashflowChart, Donut, type Slice } from "./charts";
import { CategoryBadge, Stat, TxRow } from "./parts";
import { inMonth, sortTransactions, spendByCategory, totalBalance, totals, useFinance, type Transaction } from "./store";

export function Overview({
  month,
  onOpenTx,
  onSeeAll,
}: {
  month: Date;
  onOpenTx: (t: Transaction) => void;
  onSeeAll: () => void;
}) {
  const { accounts, categories, transactions } = useFinance();
  const money = useMoney();
  const key = monthKey(month);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const monthTx = useMemo(() => inMonth(transactions, key), [transactions, key]);
  const t = totals(monthTx);
  // For the month in progress, compare against the same number of days last month.
  const isCurrent = key === monthKey(new Date());
  const cutoff = String(new Date().getDate()).padStart(2, "0");
  const prevTx = inMonth(transactions, monthKey(subMonths(month, 1)));
  const prev = totals(isCurrent ? prevTx.filter((x) => x.date.slice(8) <= cutoff) : prevTx);
  const balance = totalBalance(accounts, transactions);
  const savingsRate = t.income > 0 ? Math.round((t.net / t.income) * 100) : null;

  const cashflow = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const m = subMonths(month, 5 - i);
        const mt = totals(inMonth(transactions, monthKey(m)));
        return { key: monthKey(m), label: format(m, "MMM"), income: mt.income, expense: mt.expense };
      }),
    [transactions, month],
  );

  const spend = spendByCategory(monthTx);
  const ranked = [...spend.entries()].sort((a, b) => b[1] - a[1]);
  const slices: Slice[] = ranked.slice(0, 6).map(([id, value]) => {
    const c = catById.get(id);
    return { id, label: c?.name ?? "Other", value, color: swatch(c?.color ?? "slate").fg };
  });
  const rest = ranked.slice(6).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) slices.push({ id: "_rest", label: "Everything else", value: rest, color: "var(--faint)" });

  const budgeted = categories.filter((c) => c.kind === "expense" && c.budget);
  const recent = sortTransactions(monthTx).slice(0, 6);

  const delta = prev.expense > 0 ? Math.round(((t.expense - prev.expense) / prev.expense) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="relative overflow-hidden p-6">
          <div
            className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-60 blur-3xl"
            style={{ background: "radial-gradient(circle, var(--fin-soft), transparent 70%)" }}
          />
          <div className="relative">
            <div className="text-[13px] font-medium text-muted">Total balance</div>
            <div className="mt-1 font-serif text-[56px] leading-none tracking-tight tabular sm:text-[64px]">
              {money(balance)}
            </div>
            <div className="mt-2 text-[13px] text-muted">
              Across {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
            </div>
            <div className="mt-8">
              <CashflowChart data={cashflow} activeKey={key} />
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <Stat
            label="Income"
            value={money(t.income)}
            tone="pos"
            icon={<ArrowDownRight className="size-4" />}
            hint={(() => {
              const n = monthTx.filter((x) => x.kind === "income").length;
              return `${n} ${n === 1 ? "deposit" : "deposits"} in ${format(month, "MMMM")}`;
            })()}
          />
          <Stat
            label="Spending"
            value={money(t.expense)}
            tone="neg"
            icon={<ArrowUpRight className="size-4" />}
            hint={
              delta === null ? (
                prevTx.length === 0 ? "No data for last month" : isCurrent ? "Nothing spent by now last month" : "Nothing spent last month"
              ) : (
                <>
                  <span className={delta > 0 ? "text-neg" : "text-pos"}>
                    {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}%
                  </span>{" "}
                  {isCurrent ? "vs this point last month" : "vs last month"}
                </>
              )
            }
          />
          <Stat
            label="Saved"
            value={money(t.net)}
            icon={<PiggyBank className="size-4" />}
            hint={savingsRate === null ? "No income yet this month" : `${savingsRate}% of income`}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Where it went" subtitle={format(month, "MMMM yyyy")} />
          {slices.length ? (
            <div className="flex flex-col items-center gap-6 p-6 sm:flex-row">
              <Donut slices={slices} total={t.expense} />
              <ul className="flex w-full flex-col gap-2.5">
                {slices.map((s) => (
                  <li key={s.id} className="flex items-center gap-2.5 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="flex-1 truncate">{s.label}</span>
                    <span className="text-muted tabular">{Math.round((s.value / t.expense) * 100)}%</span>
                    <span className="w-24 text-right font-medium tabular">{money(s.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState icon={<Receipt className="size-5" />} title="No spending yet" body="Expenses you add this month will show up here." />
          )}
        </Card>

        <Card>
          <CardHeader title="Budgets" subtitle="Monthly limits by category" />
          {budgeted.length ? (
            <ul className="flex flex-col gap-4 p-6">
              {budgeted.map((c) => {
                const spent = spend.get(c.id) ?? 0;
                const ratio = spent / c.budget!;
                const over = ratio > 1;
                return (
                  <li key={c.id} className="flex items-center gap-3">
                    <CategoryBadge category={c} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="shrink-0 text-[13px] text-muted tabular">
                          <span className={over ? "font-medium text-neg" : "text-ink"}>{money(spent)}</span> /{" "}
                          {money(c.budget!)}
                        </span>
                      </div>
                      <Progress value={ratio} color={over ? "var(--neg)" : swatch(c.color).fg} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<PiggyBank className="size-5" />} title="No budgets set" body="Give a category a monthly limit in the Budgets tab." />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent activity"
          action={
            recent.length > 0 && (
              <button onClick={onSeeAll} className="text-[13px] font-medium text-fin hover:underline">
                See all
              </button>
            )
          }
        />
        <div className="p-3">
          {recent.length ? (
            recent.map((tx) => (
              <TxRow key={tx.id} tx={tx} category={catById.get(tx.categoryId)} account={accById.get(tx.accountId)} onClick={() => onOpenTx(tx)} />
            ))
          ) : (
            <EmptyState icon={<Receipt className="size-5" />} title="A blank page" body={`No transactions in ${format(month, "MMMM")} yet.`} />
          )}
        </div>
      </Card>
    </div>
  );
}
