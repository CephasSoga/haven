import { useState } from "react";
import { motion } from "motion/react";
import { useMoney, type Cents } from "@/lib/money";
import { cn } from "@/lib/utils";

/* ---------- Income vs spending, grouped bars ---------- */

export type CashflowPoint = { key: string; label: string; income: Cents; expense: Cents };

export function CashflowChart({ data, activeKey }: { data: CashflowPoint[]; activeKey?: string }) {
  const money = useMoney();
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const shown = data.find((d) => d.key === hover);

  return (
    <div>
      <div className="mb-4 flex items-center gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-pos" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-neg" /> Spending
        </span>
        <span className="ml-auto h-4 text-ink tabular">
          {shown && (
            <>
              <span className="text-muted">{shown.label}: </span>
              {money(shown.income, { compact: true })} in · {money(shown.expense, { compact: true })} out
            </>
          )}
        </span>
      </div>
      <div className="relative h-44">
        {/* Recessive gridlines */}
        {[0.5, 1].map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-2 border-b border-line-strong">
          {data.map((d, i) => (
            <div
              key={d.key}
              className="relative flex h-full flex-1 cursor-default items-end justify-center gap-[2px]"
              onMouseEnter={() => setHover(d.key)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={cn(
                  "absolute inset-x-0 -bottom-px top-0 rounded-t-lg transition-colors",
                  hover === d.key && "bg-sunken",
                )}
              />
              {(["income", "expense"] as const).map((k) => (
                <motion.div
                  key={k}
                  className={cn("relative w-full max-w-5 rounded-t-[4px]", k === "income" ? "bg-pos" : "bg-neg")}
                  style={{ opacity: !activeKey || activeKey === d.key || hover === d.key ? 1 : 0.45 }}
                  initial={{ height: 0 }}
                  animate={{ height: `${(d[k] / max) * 100}%` }}
                  transition={{ type: "spring", bounce: 0, duration: 0.7, delay: i * 0.04 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        {data.map((d) => (
          <div
            key={d.key}
            className={cn("flex-1 text-center text-[11px] font-medium", d.key === activeKey ? "text-ink" : "text-faint")}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Spending by category, donut ---------- */

export type Slice = { id: string; label: string; value: Cents; color: string };

export function Donut({ slices, total, size = 176 }: { slices: Slice[]; total: Cents; size?: number }) {
  const money = useMoney();
  const [hover, setHover] = useState<string | null>(null);
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 3 : 0;
  const shown = slices.find((s) => s.id === hover);

  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
        {slices.map((s) => {
          const len = (s.value / Math.max(total, 1)) * c;
          const dash = Math.max(len - gap, 0.5);
          const el = (
            <motion.circle
              key={s.id}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.id ? stroke + 4 : stroke}
              strokeLinecap="butt"
              strokeDashoffset={-offset}
              initial={{ strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: `${dash} ${c - dash}` }}
              transition={{ type: "spring", bounce: 0, duration: 0.9 }}
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: "stroke-width 150ms", cursor: "default" }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{shown ? shown.label : "Spent"}</span>
        <span className="font-serif text-[26px] leading-tight tabular">{money(shown ? shown.value : total, { compact: true })}</span>
        {shown && <span className="text-[11px] text-muted tabular">{Math.round((shown.value / total) * 100)}%</span>}
      </div>
    </div>
  );
}
