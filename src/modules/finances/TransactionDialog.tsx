import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { centsToInput, currencySymbol, parseAmount } from "@/lib/money";
import { cn, swatch } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { categoryIcon } from "./icons";
import { useFinance, type Transaction, type TxKind } from "./store";

export type TxDraft = Omit<Transaction, "id" | "amount"> & { id?: string; amount?: number };

export function TransactionDialog({ draft, onClose }: { draft: TxDraft | null; onClose: () => void }) {
  const { categories, accounts, saveTransaction, removeTransaction } = useFinance();
  const currency = useSettings((s) => s.currency);
  const [form, setForm] = useState<TxDraft | null>(draft);
  const [amount, setAmount] = useState("");
  const [prevDraft, setPrevDraft] = useState(draft);
  const amountRef = useRef<HTMLInputElement>(null);

  if (draft !== prevDraft) {
    setPrevDraft(draft);
    if (draft) {
      setForm(draft);
      setAmount(draft.amount ? centsToInput(draft.amount) : "");
    }
  }

  useEffect(() => {
    if (draft && !draft.id) requestAnimationFrame(() => amountRef.current?.focus());
  }, [draft]);

  // `form` outlives `draft` so the dialog keeps its content during the exit animation.
  const f = form ?? draft;
  if (!f) return null;

  const patch = (p: Partial<TxDraft>) => setForm({ ...f, ...p });
  const cents = parseAmount(amount);
  const kindCats = categories.filter((c) => c.kind === f.kind);
  const invalid = !cents || cents <= 0 || !f.categoryId || !f.accountId;
  const accent = f.kind === "income" ? "var(--pos)" : "var(--neg)";

  const setKind = (kind: TxKind) => {
    const first = categories.find((c) => c.kind === kind);
    patch({ kind, categoryId: first?.id ?? "" });
  };

  const submit = () => {
    if (invalid) return;
    saveTransaction({ ...f, amount: cents!, note: f.note?.trim() || undefined } as Transaction);
    onClose();
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={f.id ? "Edit transaction" : "New transaction"}
      accent={accent}
      footer={
        <>
          {f.id && (
            <Button
              variant="danger"
              onClick={() => {
                removeTransaction(f.id!);
                onClose();
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={invalid}>
            {f.id ? "Save changes" : "Add"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          layoutId="tx-kind"
          className="w-full"
          value={f.kind}
          onChange={setKind}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
        />

        <div className="flex items-baseline justify-center gap-2 py-2">
          <span className="font-serif text-4xl text-faint">{currencySymbol(currency)}</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ""))}
            placeholder="0"
            aria-label="Amount"
            className="w-full max-w-[260px] bg-transparent text-center font-serif text-6xl leading-none tabular placeholder:text-line-strong focus:outline-none"
            style={{ color: amount ? accent : undefined }}
          />
        </div>

        <Field label="Category">
          {() => (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {kindCats.map((c) => {
                const Icon = categoryIcon(c.icon);
                const s = swatch(c.color);
                const active = c.id === f.categoryId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => patch({ categoryId: c.id })}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-2.5 text-[12px] font-medium transition-all",
                      active ? "border-transparent shadow-soft" : "border-line hover:border-line-strong",
                    )}
                    style={active ? { background: s.soft, boxShadow: `inset 0 0 0 1.5px ${s.fg}` } : undefined}
                  >
                    <span
                      className="flex size-8 items-center justify-center rounded-full"
                      style={{ background: s.soft, color: s.fg }}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="w-full truncate px-1 text-center">{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            {(id) => <Input id={id} type="date" value={f.date} onChange={(e) => e.target.value && patch({ date: e.target.value })} />}
          </Field>
          <Field label="Account">
            {(id) => (
              <Select id={id} value={f.accountId} onChange={(e) => patch({ accountId: e.target.value })}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Note">
          {(id) => (
            <Input id={id} value={f.note ?? ""} onChange={(e) => patch({ note: e.target.value })} placeholder="e.g. Weekly groceries" />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
