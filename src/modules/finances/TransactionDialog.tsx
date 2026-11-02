import { useEffect, useRef, useState } from "react";
import { ArrowDown, Trash2 } from "lucide-react";
import { Button, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { centsToInput, currencySymbol, parseAmount } from "@/lib/money";
import { cn, swatch } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { categoryIcon } from "./icons";
import { TRANSFER, useFinance, type Transaction, type TxKind } from "./store";

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
  const transfer = f.kind === "transfer";
  const kindCats = categories.filter((c) => c.kind === f.kind);
  const invalid =
    !cents || cents <= 0 || !f.accountId || (transfer ? !f.toAccountId || f.toAccountId === f.accountId : !f.categoryId);
  const accent = f.kind === "income" ? "var(--pos)" : transfer ? "var(--fin)" : "var(--neg)";

  const setKind = (kind: TxKind) => {
    if (kind === "transfer") {
      patch({ kind, categoryId: TRANSFER, toAccountId: f.toAccountId ?? accounts.find((a) => a.id !== f.accountId)?.id });
      return;
    }
    const first = categories.find((c) => c.kind === kind);
    patch({ kind, categoryId: first?.id ?? "", toAccountId: undefined });
  };

  const submit = () => {
    if (invalid) return;
    const { toAccountId, ...rest } = f;
    saveTransaction({ ...rest, ...(transfer ? { toAccountId } : {}), amount: cents!, note: f.note?.trim() || undefined } as Transaction);
    onClose();
  };

  const accountSelect = (id: string, value: string | undefined, onChange: (v: string) => void, exclude?: string) => (
    <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {accounts
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </Select>
  );

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={transfer ? (f.id ? "Edit transfer" : "New transfer") : f.id ? "Edit transaction" : "New transaction"}
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
            { value: "transfer", label: "Transfer" },
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

        {transfer ? (
          accounts.length < 2 ? (
            <div className="rounded-2xl bg-sunken px-4 py-3 text-[13px] text-muted">
              Transfers move money between two of your accounts. Add a second account in the Accounts tab first.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Field label="From">
                {(id) =>
                  accountSelect(id, f.accountId, (v) =>
                    patch({ accountId: v, toAccountId: f.toAccountId === v ? accounts.find((a) => a.id !== v)?.id : f.toAccountId }),
                  )
                }
              </Field>
              <ArrowDown className="mx-auto mt-1 size-4 text-faint" />
              <Field label="To">{(id) => accountSelect(id, f.toAccountId, (v) => patch({ toAccountId: v }), f.accountId)}</Field>
            </div>
          )
        ) : (
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
        )}

        <div className={cn("grid gap-3", !transfer && "grid-cols-2")}>
          <Field label="Date">
            {(id) => <Input id={id} type="date" value={f.date} onChange={(e) => e.target.value && patch({ date: e.target.value })} />}
          </Field>
          {!transfer && <Field label="Account">{(id) => accountSelect(id, f.accountId, (v) => patch({ accountId: v }))}</Field>}
        </div>

        <Field label="Note">
          {(id) => (
            <Input id={id} value={f.note ?? ""} onChange={(e) => patch({ note: e.target.value })} placeholder={transfer ? "e.g. Monthly savings" : "e.g. Weekly groceries"} />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
