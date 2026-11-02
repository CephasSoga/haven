import { useState } from "react";
import { Eye, EyeOff, RefreshCw, Star, Trash2 } from "lucide-react";
import { Button, Field, Input, Modal, Textarea } from "@/components/ui";
import { cn, swatch } from "@/lib/utils";
import { generatePassword } from "./crypto";
import { cardBrand, groupCardNumber, KINDS, luhnValid, type Kind } from "./kinds";
import { CardVisual, KindIcon, StrengthBar } from "./parts";
import { useVault, type ItemDraft } from "./store";

function SecretInput({ id, value, onChange, password, multiline, placeholder }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  password?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  if (multiline) {
    return (
      <div className="relative">
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={cn("pr-10 font-mono text-[14px]", !shown && value && "[-webkit-text-security:disc]")}
        />
        <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? "Hide" : "Reveal"} className="absolute right-2 top-2 rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink">
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            type={shown ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="new-password"
            spellCheck={false}
            className="pr-10 font-mono text-[14px]"
          />
          <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? "Hide" : "Reveal"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink">
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {password && (
          <Button
            type="button"
            onClick={() => {
              onChange(generatePassword(20));
              setShown(true);
            }}
            title="Generate a strong password"
          >
            <RefreshCw className="size-4" /> Generate
          </Button>
        )}
      </div>
      {password && <StrengthBar password={value} />}
    </div>
  );
}

export function ItemDialog({ draft, onClose, onSaved }: { draft: ItemDraft | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { save, remove } = useVault();
  const [form, setForm] = useState<ItemDraft | null>(draft);
  const [prevDraft, setPrevDraft] = useState(draft);
  const [busy, setBusy] = useState(false);
  if (draft !== prevDraft) {
    setPrevDraft(draft);
    if (draft) setForm(draft);
  }
  // `form` outlives `draft` so the dialog keeps its content during the exit animation.
  const f = form ?? draft;
  if (!f) return null;

  const def = KINDS[f.kind];
  const patch = (p: Partial<ItemDraft>) => setForm({ ...f, ...p });
  const setField = (k: string, v: string) => patch({ fields: { ...f.fields, [k]: v } });
  const invalid = !f.name.trim();

  const submit = async () => {
    if (invalid || busy) return;
    setBusy(true);
    try {
      const fields = Object.fromEntries(Object.entries(f.fields).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      const id = await save({ ...f, name: f.name.trim(), fields, notes: f.notes?.trim() || undefined });
      onSaved?.(id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const number = f.fields.number ?? "";

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={f.id ? `Edit ${def.label.toLowerCase()}` : `New ${def.label.toLowerCase()}`}
      accent={swatch(def.color).fg}
      footer={
        <>
          {f.id && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(`Delete “${f.name}” from your vault? This can't be undone.`)) return;
                await remove(f.id!);
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
          <Button variant="primary" onClick={submit} disabled={invalid || busy}>
            {busy ? "Encrypting…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!f.id && (
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(KINDS) as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => patch({ kind: k })}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-2.5 text-[11px] font-medium leading-tight transition-all",
                  f.kind === k ? "border-transparent shadow-soft" : "border-line text-muted hover:border-line-strong",
                )}
                style={f.kind === k ? { background: swatch(KINDS[k].color).soft, boxShadow: `inset 0 0 0 1.5px ${swatch(KINDS[k].color).fg}` } : undefined}
              >
                <KindIcon kind={k} size="sm" />
                <span className="text-center">{KINDS[k].label}</span>
              </button>
            ))}
          </div>
        )}

        {f.kind === "card" && (
          <div className="mx-auto w-full max-w-[340px]">
            <CardVisual item={{ ...f, id: "", createdAt: 0, updatedAt: 0, name: f.name || "My card" }} reveal />
          </div>
        )}

        <div className="flex items-end gap-2">
          <Field label="Name" className="flex-1">
            {(id) => (
              <Input
                id={id}
                value={f.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder={f.kind === "card" ? "e.g. Everyday Visa" : f.kind === "login" ? "e.g. Email" : "Name"}
                autoFocus={!f.id}
              />
            )}
          </Field>
          <button
            type="button"
            onClick={() => patch({ favorite: !f.favorite })}
            aria-label={f.favorite ? "Remove from favorites" : "Add to favorites"}
            className="mb-1 rounded-xl p-2.5 text-faint hover:bg-sunken"
          >
            <Star className={cn("size-5", f.favorite && "fill-current text-note")} />
          </button>
        </div>

        {def.fields.map((fd) => (
          <Field key={fd.key} label={fd.label}>
            {(id) =>
              fd.secret ? (
                <div className="flex flex-col gap-1.5">
                  <SecretInput
                    id={id}
                    value={fd.key === "number" && f.kind === "card" ? groupCardNumber(f.fields[fd.key] ?? "") : f.fields[fd.key] ?? ""}
                    onChange={(v) => setField(fd.key, fd.key === "number" && f.kind === "card" ? v.replace(/[^\d ]/g, "") : v)}
                    password={fd.password}
                    multiline={fd.multiline}
                    placeholder={fd.placeholder}
                  />
                  {f.kind === "card" && fd.key === "number" && number.replace(/\D/g, "").length >= 12 && (
                    <span className={cn("text-[12px]", luhnValid(number) ? "text-muted" : "text-neg")}>
                      {cardBrand(number)} · {luhnValid(number) ? "Number looks valid" : "This number doesn't pass the card checksum — check for a typo"}
                    </span>
                  )}
                </div>
              ) : (
                <Input id={id} type={fd.type ?? "text"} value={f.fields[fd.key] ?? ""} onChange={(e) => setField(fd.key, e.target.value)} placeholder={fd.placeholder} spellCheck={false} />
              )
            }
          </Field>
        ))}

        <Field label={f.kind === "note" ? "Note" : "Notes"}>
          {(id) => (
            <Textarea
              id={id}
              value={f.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Anything else worth keeping safe"
              className={f.kind === "note" ? "min-h-40" : undefined}
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
