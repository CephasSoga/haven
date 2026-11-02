import { useMemo } from "react";
import { format } from "date-fns";
import { ChevronRight, Plus, Wand2, X } from "lucide-react";
import { Button, Card, CardHeader, Progress } from "@/components/ui";
import { monthKey } from "@/lib/dates";
import { useMoney } from "@/lib/money";
import { swatch } from "@/lib/utils";
import { CategoryBadge } from "./parts";
import { inMonth, spendByCategory, useFinance, type Category } from "./store";

export function BudgetsTab({ month, onEdit }: { month: Date; onEdit: (c: Category | "new") => void }) {
  const { categories, transactions, rules, removeRule } = useFinance();
  const money = useMoney();
  const spend = useMemo(() => spendByCategory(inMonth(transactions, monthKey(month))), [transactions, month]);
  const income = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of inMonth(transactions, monthKey(month)))
      if (t.kind === "income") map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
    return map;
  }, [transactions, month]);

  const expenseCats = categories.filter((c) => c.kind === "expense");
  const incomeCats = categories.filter((c) => c.kind === "income");
  const totalBudget = expenseCats.reduce((s, c) => s + (c.budget ?? 0), 0);
  const budgetedSpend = expenseCats.reduce((s, c) => s + (c.budget ? spend.get(c.id) ?? 0 : 0), 0);
  const left = totalBudget - budgetedSpend;

  return (
    <div className="flex flex-col gap-6">
      {totalBudget > 0 && (
        <Card className="p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium text-muted">Left to spend in {format(month, "MMMM")}</div>
              <div className={`mt-1 font-serif text-5xl leading-none tabular ${left < 0 ? "text-neg" : ""}`}>{money(left)}</div>
            </div>
            <div className="text-right text-[13px] text-muted tabular">
              {money(budgetedSpend)} of {money(totalBudget)} budgeted
            </div>
          </div>
          <Progress className="mt-5 h-2.5" value={budgetedSpend / totalBudget} color={left < 0 ? "var(--neg)" : "var(--fin)"} />
        </Card>
      )}

      <Card>
        <CardHeader
          title="Spending categories"
          subtitle="Tap a category to set its monthly budget"
          action={
            <Button size="sm" onClick={() => onEdit("new")}>
              <Plus className="size-3.5" /> Category
            </Button>
          }
        />
        <ul className="p-3">
          {expenseCats.map((c) => {
            const spent = spend.get(c.id) ?? 0;
            const ratio = c.budget ? spent / c.budget : 0;
            return (
              <li key={c.id}>
                <button onClick={() => onEdit(c)} className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-sunken">
                  <CategoryBadge category={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="shrink-0 text-[13px] text-muted tabular">
                        <span className={ratio > 1 ? "font-medium text-neg" : "font-medium text-ink"}>{money(spent)}</span>
                        {c.budget ? ` / ${money(c.budget)}` : ""}
                      </span>
                    </div>
                    {c.budget ? (
                      <Progress className="mt-2 h-1.5" value={ratio} color={ratio > 1 ? "var(--neg)" : swatch(c.color).fg} />
                    ) : (
                      <div className="mt-0.5 text-[12px] text-faint">No budget</div>
                    )}
                  </div>
                  <ChevronRight className="size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Income categories" />
        <ul className="p-3">
          {incomeCats.map((c) => (
            <li key={c.id}>
              <button onClick={() => onEdit(c)} className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-sunken">
                <CategoryBadge category={c} />
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span className="text-[13px] font-medium text-pos tabular">{money(income.get(c.id) ?? 0)}</span>
                <ChevronRight className="size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {rules.length > 0 && (
        <Card>
          <CardHeader title="Import rules" subtitle="Learned from your corrections when importing statements" />
          <ul className="p-3">
            {[...rules]
              .sort((a, b) => a.match.localeCompare(b.match))
              .map((r) => {
                const c = categories.find((x) => x.id === r.categoryId);
                return (
                  <li key={r.id} className="group flex items-center gap-3 rounded-2xl px-3 py-2 text-[14px] hover:bg-sunken">
                    <Wand2 className="size-4 shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">
                      Contains <span className="font-medium">“{r.match}”</span> → {c?.name ?? "Deleted category"}
                    </span>
                    <button onClick={() => removeRule(r.id)} aria-label={`Remove rule for ${r.match}`} className="rounded-lg p-1.5 text-faint opacity-0 hover:bg-surface hover:text-neg group-hover:opacity-100">
                      <X className="size-4" />
                    </button>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}
    </div>
  );
}
