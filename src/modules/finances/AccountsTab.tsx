import { Plus } from "lucide-react";
import { motion } from "motion/react";
import { useMoney } from "@/lib/money";
import { swatch } from "@/lib/utils";
import { ACCOUNT_KINDS } from "./icons";
import { accountBalance, useFinance, type Account } from "./store";

export function AccountsTab({ onEdit }: { onEdit: (a: Account | "new") => void }) {
  const { accounts, transactions } = useFinance();
  const money = useMoney();

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {accounts.map((a, i) => {
        const s = swatch(a.color);
        const kind = ACCOUNT_KINDS[a.kind] ?? ACCOUNT_KINDS.checking;
        const Icon = kind.icon;
        const count = transactions.filter((t) => t.accountId === a.id).length;
        return (
          <motion.button
            key={a.id}
            onClick={() => onEdit(a)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ y: -3 }}
            className="relative flex aspect-[1.7] flex-col justify-between overflow-hidden rounded-3xl p-6 text-left text-white shadow-card"
            style={{ background: `linear-gradient(135deg, ${s.fg}, color-mix(in oklab, ${s.fg} 55%, #111))` }}
          >
            <div className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-white/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 size-48 rounded-full bg-black/10 blur-2xl" />
            <div className="relative flex items-center justify-between">
              <span className="text-[13px] font-medium text-white/80">{kind.label}</span>
              <Icon className="size-5 text-white/80" />
            </div>
            <div className="relative">
              <div className="font-serif text-[40px] leading-none tabular">{money(accountBalance(a, transactions))}</div>
              <div className="mt-2 flex items-center justify-between text-[13px] text-white/80">
                <span className="font-medium text-white">{a.name}</span>
                <span>
                  {count} {count === 1 ? "transaction" : "transactions"}
                </span>
              </div>
            </div>
          </motion.button>
        );
      })}
      <button
        onClick={() => onEdit("new")}
        className="flex aspect-[1.7] flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line text-muted transition-colors hover:border-line-strong hover:bg-surface hover:text-ink"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-sunken">
          <Plus className="size-5" />
        </span>
        <span className="text-sm font-medium">Add account</span>
      </button>
    </div>
  );
}
