import { useState } from "react";
import { addMonths, format, isSameMonth } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, IconButton, PageHeader, Segmented } from "@/components/ui";
import { dayKey } from "@/lib/dates";
import { useFinance, type Transaction } from "./store";
import { Overview } from "./Overview";
import { TransactionsTab } from "./TransactionsTab";
import { BudgetsTab } from "./BudgetsTab";
import { AccountsTab } from "./AccountsTab";
import { TransactionDialog, type TxDraft } from "./TransactionDialog";
import { AccountDialog, CategoryDialog, type AccountDraft, type CategoryDraft } from "./dialogs";

type Tab = "overview" | "transactions" | "budgets" | "accounts";

export function FinancesPage() {
  const { accounts, categories } = useFinance();
  const [tab, setTab] = useState<Tab>("overview");
  const [month, setMonth] = useState(() => new Date());
  const [txDraft, setTxDraft] = useState<TxDraft | null>(null);
  const [catDraft, setCatDraft] = useState<CategoryDraft | null>(null);
  const [accDraft, setAccDraft] = useState<AccountDraft | null>(null);

  const newTx = () => {
    const now = new Date();
    setTxDraft({
      kind: "expense",
      categoryId: categories.find((c) => c.kind === "expense")?.id ?? "",
      accountId: accounts[0]?.id ?? "",
      // Default to today, or to the 1st of the month being viewed.
      date: dayKey(isSameMonth(month, now) ? now : new Date(month.getFullYear(), month.getMonth(), 1)),
    });
  };
  const openTx = (t: Transaction) => setTxDraft({ ...t });

  const monthNav = tab !== "accounts" && (
    <div className="flex items-center rounded-xl border border-line bg-surface shadow-soft">
      <IconButton label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
        <ChevronLeft className="size-4" />
      </IconButton>
      <button onClick={() => setMonth(new Date())} className="min-w-[88px] px-1 text-[13px] font-medium" title="Back to this month">
        {format(month, "MMM yyyy")}
      </button>
      <IconButton label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
        <ChevronRight className="size-4" />
      </IconButton>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Finances"
        title={
          tab === "accounts" ? (
            "Accounts"
          ) : (
            <>
              {format(month, "MMMM")} <span className="text-faint">{format(month, "yyyy")}</span>
            </>
          )
        }
        actions={
          <>
            {monthNav}
            <Button variant="primary" onClick={newTx}>
              <Plus className="size-4" /> Transaction
            </Button>
          </>
        }
      />

      <Segmented
        layoutId="fin-tab"
        className="self-start"
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview" },
          { value: "transactions", label: "Transactions" },
          { value: "budgets", label: "Budgets" },
          { value: "accounts", label: "Accounts" },
        ]}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {tab === "overview" && <Overview month={month} onOpenTx={openTx} onSeeAll={() => setTab("transactions")} />}
          {tab === "transactions" && <TransactionsTab month={month} onOpenTx={openTx} />}
          {tab === "budgets" && (
            <BudgetsTab
              month={month}
              onEdit={(c) =>
                setCatDraft(c === "new" ? { name: "", kind: "expense", icon: "CircleDashed", color: "teal" } : { ...c })
              }
            />
          )}
          {tab === "accounts" && (
            <AccountsTab
              onEdit={(a) => setAccDraft(a === "new" ? { name: "", kind: "checking", opening: 0, color: "teal" } : { ...a })}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <TransactionDialog draft={txDraft} onClose={() => setTxDraft(null)} />
      <CategoryDialog draft={catDraft} onClose={() => setCatDraft(null)} />
      <AccountDialog draft={accDraft} onClose={() => setAccDraft(null)} />
    </div>
  );
}
