import { useState } from "react";
import { ask } from "@/components/confirm";
import { Trash2 } from "lucide-react";
import { Button, ColorPicker, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { centsToInput, parseAmount } from "@/lib/money";
import { cn, swatch } from "@/lib/utils";
import { ACCOUNT_KINDS, CATEGORY_ICONS, type AccountKind } from "./icons";
import { useFinance, type Account, type Category } from "./store";

export type CategoryDraft = Omit<Category, "id"> & { id?: string };

export function CategoryDialog({ draft, onClose }: { draft: CategoryDraft | null; onClose: () => void }) {
  const { saveCategory, removeCategory } = useFinance();
  const [form, setForm] = useState(draft);
  const [budget, setBudget] = useState("");
  const [prev, setPrev] = useState(draft);
  if (draft !== prev) {
    setPrev(draft);
    if (draft) {
      setForm(draft);
      setBudget(draft.budget ? centsToInput(draft.budget) : "");
    }
  }
  // `form` outlives `draft` so the dialog keeps its content during the exit animation.
  const f = form ?? draft;
  if (!f) return null;
  const patch = (p: Partial<CategoryDraft>) => setForm({ ...f, ...p });
  const isFallback = f.id === "other-expense" || f.id === "other-income";
  const invalid = !f.name.trim();

  const submit = () => {
    if (invalid) return;
    const b = f.kind === "expense" ? parseAmount(budget) : null;
    saveCategory({ ...f, name: f.name.trim(), budget: b && b > 0 ? b : undefined });
    onClose();
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={f.id ? "Edit category" : "New category"}
      accent={swatch(f.color).fg}
      footer={
        <>
          {f.id && !isFallback && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await ask({ title: `Delete “${f.name}”?`, body: "Its transactions will move to “Other”.", confirmLabel: "Delete", danger: true })) {
                  removeCategory(f.id!);
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
            Save
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => (e.preventDefault(), submit())}>
        {!f.id && (
          <Segmented
            layoutId="cat-kind"
            className="w-full"
            value={f.kind}
            onChange={(kind) => patch({ kind })}
            options={[
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
          />
        )}
        <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />}</Field>
        {f.kind === "expense" && (
          <Field label="Monthly budget">
            {(id) => <Input id={id} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No limit" />}
          </Field>
        )}
        <Field label="Icon">
          {() => (
            <div className="grid grid-cols-8 gap-1.5">
              {Object.entries(CATEGORY_ICONS).map(([name, Icon]) => {
                const active = f.icon === name;
                const s = swatch(f.color);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => patch({ icon: name })}
                    className={cn("flex aspect-square items-center justify-center rounded-xl transition-colors", !active && "text-muted hover:bg-sunken")}
                    style={active ? { background: s.soft, color: s.fg } : undefined}
                    aria-label={name}
                  >
                    <Icon className="size-[18px]" />
                  </button>
                );
              })}
            </div>
          )}
        </Field>
        <Field label="Color">{() => <ColorPicker value={f.color} onChange={(color) => patch({ color })} />}</Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export type AccountDraft = Omit<Account, "id"> & { id?: string };

export function AccountDialog({ draft, onClose }: { draft: AccountDraft | null; onClose: () => void }) {
  const { saveAccount, removeAccount, accounts } = useFinance();
  const [form, setForm] = useState(draft);
  const [opening, setOpening] = useState("");
  const [prev, setPrev] = useState(draft);
  if (draft !== prev) {
    setPrev(draft);
    if (draft) {
      setForm(draft);
      setOpening(draft.opening ? centsToInput(draft.opening) : "");
    }
  }
  // `form` outlives `draft` so the dialog keeps its content during the exit animation.
  const f = form ?? draft;
  if (!f) return null;
  const patch = (p: Partial<AccountDraft>) => setForm({ ...f, ...p });
  const invalid = !f.name.trim();

  const submit = () => {
    if (invalid) return;
    saveAccount({ ...f, name: f.name.trim(), opening: parseAmount(opening) ?? 0 });
    onClose();
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={f.id ? "Edit account" : "New account"}
      accent={swatch(f.color).fg}
      footer={
        <>
          {f.id && accounts.length > 1 && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await ask({ title: `Delete “${f.name}”?`, body: "The account and all of its transactions will be deleted. This can't be undone.", confirmLabel: "Delete", danger: true })) {
                  removeAccount(f.id!);
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
            Save
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => (e.preventDefault(), submit())}>
        <Field label="Name">
          {(id) => <Input id={id} value={f.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Everyday account" autoFocus />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={f.kind} onChange={(e) => patch({ kind: e.target.value as AccountKind })}>
                {Object.entries(ACCOUNT_KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Starting balance">
            {(id) => <Input id={id} inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />}
          </Field>
        </div>
        <Field label="Color">{() => <ColorPicker value={f.color} onChange={(color) => patch({ color })} />}</Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
