import type { ReactNode } from "react";
import { useMoney } from "@/lib/money";
import { cn, swatch } from "@/lib/utils";
import { categoryIcon } from "./icons";
import { signed, type Account, type Category, type Transaction } from "./store";

export function CategoryBadge({ category, size = "md" }: { category?: Category; size?: "sm" | "md" }) {
  const Icon = categoryIcon(category?.icon ?? "");
  const s = swatch(category?.color ?? "slate");
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full", size === "md" ? "size-10" : "size-8")}
      style={{ background: s.soft, color: s.fg }}
    >
      <Icon className={size === "md" ? "size-[18px]" : "size-4"} />
    </span>
  );
}

export function TxRow({
  tx,
  category,
  account,
  onClick,
}: {
  tx: Transaction;
  category?: Category;
  account?: Account;
  onClick: () => void;
}) {
  const money = useMoney();
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-sunken"
    >
      <CategoryBadge category={category} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{tx.note || category?.name || "Uncategorized"}</span>
        <span className="block truncate text-[13px] text-muted">
          {tx.note ? category?.name : null}
          {tx.note && account ? " · " : null}
          {account?.name}
        </span>
      </span>
      <span className={cn("font-medium tabular", tx.kind === "income" ? "text-pos" : "text-ink")}>
        {money(signed(tx), { sign: true })}
      </span>
    </button>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: "pos" | "neg";
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-3xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between text-[13px] font-medium text-muted">
        {label}
        {icon && (
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full",
              tone === "pos" && "bg-pos/12 text-pos",
              tone === "neg" && "bg-neg/12 text-neg",
              !tone && "bg-sunken text-muted",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div>
        <div className="font-serif text-[34px] leading-none tabular">{value}</div>
        {hint && <div className="mt-1.5 text-[13px] text-muted">{hint}</div>}
      </div>
    </div>
  );
}
