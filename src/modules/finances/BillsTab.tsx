import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "motion/react";
import { AlertCircle, Check, ChevronRight, Plus, ReceiptText, SkipForward, Trash2, Zap } from "lucide-react";
import { ask } from "@/components/confirm";
import { Button, Card, CardHeader, ColorPicker, EmptyState, Field, Input, Modal, Select, Switch, Textarea } from "@/components/ui";
import { parseDay, todayKey } from "@/lib/dates";
import { centsToInput, currencySymbol, parseAmount, useMoney } from "@/lib/money";
import { cn, swatch } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { CYCLES, daysUntil, whenLabel, type Cycle } from "@/modules/subscriptions/store";
import { categoryIcon } from "./icons";
import { useFinance, type Bill } from "./store";

export type BillDraft = Omit<Bill, "id"> & { id?: string };

export function newBillDraft(accountId: string, categoryId: string): BillDraft {
  return { name: "", amount: 0, cycle: "monthly", due: todayKey(), accountId, categoryId, color: "violet" };
}

/** "Overdue by 3 days" / "Due today" / "Due in 5 days" */
export function dueLabel(due: string) {
  const n = daysUntil(due);
  if (n < 0) return `Overdue by ${-n} ${n === -1 ? "day" : "days"}`;
  return n === 0 ? "Due today" : `Due ${whenLabel(due)}`;
}

export function BillsTab({ onEdit }: { onEdit: (b: BillDraft) => void }) {
  const { bills, accounts, categories, payBill } = useFinance();
  const money = useMoney();
  const [paid, setPaid] = useState<string | null>(null);
  const sorted = useMemo(() => [...bills].sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name)), [bills]);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const overdue = sorted.filter((b) => daysUntil(b.due) < 0);
  const next30 = sorted.filter((b) => daysUntil(b.due) <= 30);
  const perMonth = bills.reduce((s, b) => s + CYCLES[b.cycle].perMonth(b.amount), 0);
  const fresh = () =>
    newBillDraft(accounts[0]?.id ?? "", (categories.find((c) => c.id === "utilities") ?? categories.find((c) => c.kind === "expense"))?.id ?? "");

  const pay = (b: Bill) => {
    payBill(b.id);
    setPaid(b.id);
    setTimeout(() => setPaid((p) => (p === b.id ? null : p)), 2000);
  };

  if (!bills.length)
    return (
      <Card>
        <EmptyState
          icon={<ReceiptText className="size-5" />}
          title="No bills yet"
          body="Add rent, electricity, insurance… Each due date shows on your calendar, and marking one paid records the payment."
          action={
            <Button variant="primary" onClick={() => onEdit(fresh())}>
              <Plus className="size-4" /> Add a bill
            </Button>
          }
        />
      </Card>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Due in the next 30 days" value={money(next30.reduce((s, b) => s + b.amount, 0))} hint={`${next30.length} ${next30.length === 1 ? "bill" : "bills"}`} />
        <SummaryTile label="Bills per month" value={money(Math.round(perMonth))} hint="Averaged across billing cycles" />
        <SummaryTile
          label="Overdue"
          value={String(overdue.length)}
          hint={overdue.length ? money(overdue.reduce((s, b) => s + b.amount, 0)) : "You're all caught up"}
          tone={overdue.length ? "neg" : undefined}
        />
      </div>

      <Card>
        <CardHeader
          title="Your bills"
          subtitle="Soonest first. Tap a bill to change it."
          action={
            <Button size="sm" onClick={() => onEdit(fresh())}>
              <Plus className="size-3.5" /> Bill
            </Button>
          }
        />
        <ul className="p-3">
          {sorted.map((b, i) => {
            const s = swatch(b.color);
            const Icon = categoryIcon(catById.get(b.categoryId)?.icon ?? "");
            const late = daysUntil(b.due) < 0;
            const soon = !late && daysUntil(b.due) <= 3;
            return (
              <motion.li key={b.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-1">
                <button onClick={() => onEdit({ ...b })} className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-sunken">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ background: s.soft, color: s.fg }}>
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{b.name}</span>
                      {b.autopay && (
                        <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          <Zap className="size-2.5" /> Auto
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[13px] text-muted">
                      <span className={cn(late && "font-medium text-neg", soon && "font-medium text-[#b7791f]")}>{dueLabel(b.due)}</span>
                      {" · "}
                      {format(parseDay(b.due), "MMM d")} · {CYCLES[b.cycle].label.toLowerCase()} · {accById.get(b.accountId)?.name ?? "No account"}
                    </span>
                  </span>
                  <span className="font-medium tabular">{money(b.amount)}</span>
                  <ChevronRight className="size-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden" />
                </button>
                <Button size="sm" variant={late ? "primary" : "ghost"} onClick={() => pay(b)} className="shrink-0" aria-label={`Mark ${b.name} paid`}>
                  {paid === b.id ? <Check className="size-3.5" /> : null}
                  {paid === b.id ? "Paid" : "Mark paid"}
                </Button>
              </motion.li>
            );
          })}
        </ul>
      </Card>
      <p className="px-1 text-[13px] text-muted">
        Marking a bill paid adds it to your transactions and moves it to its next due date. Online subscriptions live in Subscriptions; both show on your calendar.
      </p>
    </div>
  );
}

function SummaryTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "neg" }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {tone === "neg" && <AlertCircle className="size-3.5 text-neg" />}
        {label}
      </div>
      <div className={cn("mt-3 font-serif text-[34px] leading-none tabular", tone === "neg" && "text-neg")}>{value}</div>
      <div className="mt-1.5 text-[13px] text-muted">{hint}</div>
    </div>
  );
}

/** Add or change a bill; for an existing one, also pay it or skip this due date. Used by Finances and the Calendar. */
export function BillDialog({ draft, onClose }: { draft: BillDraft | null; onClose: () => void }) {
  const { accounts, categories, saveBill, removeBill, payBill, skipBill } = useFinance();
  const currency = useSettings((s) => s.currency);
  const money = useMoney();
  const [form, setForm] = useState(draft);
  const [amount, setAmount] = useState("");
  const [prev, setPrev] = useState(draft);
  if (draft !== prev) {
    setPrev(draft);
    if (draft) {
      setForm(draft);
      setAmount(draft.amount ? centsToInput(draft.amount) : "");
    }
  }
  // `form` outlives `draft` so the dialog keeps its content during the exit animation.
  const f = form ?? draft;
  if (!f) return null;
  const patch = (p: Partial<BillDraft>) => setForm({ ...f, ...p });
  const cents = parseAmount(amount);
  const invalid = !f.name.trim() || !cents || cents <= 0 || !f.accountId || !f.categoryId || !f.due;
  const saved = f.id ? useFinance.getState().bills.find((b) => b.id === f.id) : undefined;

  const submit = () => {
    if (invalid) return;
    saveBill({ ...f, name: f.name.trim(), amount: cents!, notes: f.notes?.trim() || undefined });
    onClose();
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={f.id ? "Edit bill" : "New bill"}
      accent={swatch(f.color).fg}
      footer={
        <>
          {f.id && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await ask({ title: `Delete “${f.name}”?`, body: "The bill stops showing on your calendar. Payments you already recorded stay in your transactions.", confirmLabel: "Delete", danger: true })) {
                  removeBill(f.id!);
                  onClose();
                }
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
            {f.id ? "Save" : "Add bill"}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => (e.preventDefault(), submit())}>
        {saved && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3" style={{ background: swatch(saved.color).soft }}>
            <div className="min-w-0 flex-1">
              <div className={cn("text-[13px] font-semibold", daysUntil(saved.due) < 0 && "text-neg")}>{dueLabel(saved.due)}</div>
              <div className="text-[12px] text-muted">
                {format(parseDay(saved.due), "EEEE, MMMM d")} · {money(saved.amount)}
              </div>
            </div>
            <Button size="sm" variant="ghost" type="button" onClick={() => (skipBill(saved.id), onClose())} title="Move to the next due date without recording a payment">
              <SkipForward className="size-3.5" /> Skip
            </Button>
            <Button size="sm" variant="primary" type="button" onClick={() => (payBill(saved.id), onClose())}>
              <Check className="size-3.5" /> Mark paid
            </Button>
          </div>
        )}
        <Field label="Name">
          {(id) => <Input id={id} value={f.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Rent" autoFocus={!f.id} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Amount (${currencySymbol(currency)})`}>
            {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ""))} placeholder="0" />}
          </Field>
          <Field label="How often">
            {(id) => (
              <Select id={id} value={f.cycle} onChange={(e) => patch({ cycle: e.target.value as Cycle })}>
                {Object.entries(CYCLES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Next due">{(id) => <Input id={id} type="date" value={f.due} onChange={(e) => e.target.value && patch({ due: e.target.value })} />}</Field>
          <Field label="Paid from">
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
        <Field label="Category">
          {(id) => (
            <Select id={id} value={f.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
              {categories
                .filter((c) => c.kind === "expense")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Switch checked={!!f.autopay} onChange={(autopay) => patch({ autopay })} label="Paid automatically (direct debit)" />
        <Field label="Color">{() => <ColorPicker value={f.color} onChange={(color) => patch({ color })} />}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={f.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} placeholder="Reference number, contact…" />}</Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
