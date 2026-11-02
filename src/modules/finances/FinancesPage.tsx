import { useState } from "react";
import { addMonths, format, isSameMonth } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, FileUp, Plus } from "lucide-react";
import { Button, IconButton, PageHeader, Segmented } from "@/components/ui";
import { dayKey, parseDay } from "@/lib/dates";
import { useFinance, type Transaction } from "./store";
import { Overview } from "./Overview";
import { TransactionsTab } from "./TransactionsTab";
import { BudgetsTab } from "./BudgetsTab";
import { AccountsTab } from "./AccountsTab";
import { TransactionDialog, type TxDraft } from "./TransactionDialog";
import { AccountDialog, CategoryDialog, type AccountDraft, type CategoryDraft } from "./dialogs";
import { ImportDialog } from "./ImportDialog";
import { BillDialog, BillsTab, type BillDraft } from "./BillsTab";

type Tab = "overview" | "transactions" | "budgets" | "bills" | "accounts";

export function FinancesPage() {
  const { accounts, categories } = useFinance();
  const [tab, setTab] = useState<Tab>("overview");
  const [month, setMonth] = useState(() => new Date());
  const [txDraft, setTxDraft] = useState<TxDraft | null>(null);
  const [catDraft, setCatDraft] = useState<CategoryDraft | null>(null);
  const [accDraft, setAccDraft] = useState<AccountDraft | null>(null);
  const [billDraft, setBillDraft] = useState<BillDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

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

  const monthNav = tab !== "accounts" && tab !== "bills" && (
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
          tab === "accounts" || tab === "bills" ? (
            tab === "accounts" ? "Accounts" : "Bills"
          ) : (
            <>
              {format(month, "MMMM")} <span className="text-faint">{format(month, "yyyy")}</span>
            </>
          )
        }
        actions={
          <>
            {monthNav}
            <Button onClick={() => setImporting(true)}>
              <FileUp className="size-4" /> Import
            </Button>
            <Button variant="primary" onClick={newTx}>
              <Plus className="size-4" /> Transaction
            </Button>
          </>
        }
      />

      {/* On a phone the tabs are wider than the screen: let them scroll sideways instead of the page. */}
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden sm:px-0">
        <Segmented
          layoutId="fin-tab"
          className="whitespace-nowrap"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "transactions", label: "Transactions" },
            { value: "budgets", label: "Budgets" },
            { value: "bills", label: "Bills" },
            { value: "accounts", label: "Accounts" },
          ]}
        />
      </div>

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
          {tab === "bills" && <BillsTab onEdit={setBillDraft} />}
          {tab === "accounts" && (
            <AccountsTab
              onEdit={(a) => setAccDraft(a === "new" ? { name: "", kind: "checking", opening: 0, color: "teal" } : { ...a })}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-on-primary shadow-float md:bottom-8"
          >
            <Check className="size-4" /> {banner}
          </motion.div>
        )}
      </AnimatePresence>

      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onDone={({ count, latest }) => {
          setTab("transactions");
          if (latest) setMonth(parseDay(latest));
          setBanner(`Imported ${count} ${count === 1 ? "transaction" : "transactions"}`);
          setTimeout(() => setBanner(null), 3500);
        }}
      />
      <TransactionDialog draft={txDraft} onClose={() => setTxDraft(null)} />
      <CategoryDialog draft={catDraft} onClose={() => setCatDraft(null)} />
      <AccountDialog draft={accDraft} onClose={() => setAccDraft(null)} />
      <BillDialog draft={billDraft} onClose={() => setBillDraft(null)} />
    </div>
  );
}
