import { useMemo, useState, type ReactNode } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ChevronLeft, Copy, Lock, Pencil, Plus, Search, ShieldCheck, Star, Timer } from "lucide-react";
import { Button, Card, EmptyState, IconButton, Input, PageHeader, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { strength } from "./crypto";
import { expiryOf, KINDS, last4, type Kind, type VaultItem } from "./kinds";
import { audit, CardVisual, FieldRow, KindIcon, StrengthBar } from "./parts";
import { ItemDialog } from "./ItemDialog";
import { useVault, type ItemDraft } from "./store";

export function VaultPage() {
  const status = useVault((s) => s.status);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={status} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
        {status === "none" && <SetupScreen />}
        {status === "locked" && <LockScreen />}
        {status === "unlocked" && <VaultView />}
      </motion.div>
    </AnimatePresence>
  );
}

/* ---------- Gate ---------- */

function GateCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center">
      <Card className="relative w-full max-w-md overflow-hidden p-8 sm:p-10">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-70 blur-3xl" style={{ background: "radial-gradient(circle, var(--cal-soft), transparent 70%)" }} />
        <div className="relative">
          <div className="mb-6 flex size-14 items-center justify-center rounded-[20px] bg-gradient-to-br from-[#7c6cff] to-[#1f9e85] text-white shadow-card">
            <Lock className="size-6" />
          </div>
          {children}
        </div>
      </Card>
    </div>
  );
}

function SetupScreen() {
  const create = useVault((s) => s.create);
  const [pw, setPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = pw.length >= 10 && strength(pw) >= 2 && pw === confirmPw && understood;

  return (
    <GateCard>
      <h1 className="font-serif text-4xl leading-tight">Your vault</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        Passwords, cards, IDs and keys — encrypted on this device with a master password only you know. Haven never stores it.
      </p>
      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          await create(pw);
        }}
      >
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Master password (10+ characters)" autoComplete="new-password" autoFocus />
        <StrengthBar password={pw} />
        <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repeat it" autoComplete="new-password" />
        {confirmPw && pw !== confirmPw && <p className="text-[13px] text-neg">The two don't match yet.</p>}
        <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-2xl bg-sunken p-3.5 text-[13px] leading-relaxed text-muted">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 size-4 accent-[var(--cal)]" />
          I understand that if I forget my master password, nothing in the vault can be recovered — by anyone.
        </label>
        <Button variant="primary" type="submit" disabled={!ok || busy} className="mt-2 h-11">
          {busy ? "Creating your vault…" : "Create vault"}
        </Button>
      </form>
    </GateCard>
  );
}

function LockScreen() {
  const unlock = useVault((s) => s.unlock);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(0);

  return (
    <GateCard>
      <h1 className="font-serif text-4xl leading-tight">Vault locked</h1>
      <p className="mt-2 text-[14px] text-muted">Enter your master password to open it.</p>
      <motion.form
        key={wrong}
        animate={wrong ? { x: [0, -10, 10, -6, 6, 0] } : undefined}
        transition={{ duration: 0.35 }}
        className="mt-6 flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!pw || busy) return;
          setBusy(true);
          const ok = await unlock(pw);
          setBusy(false);
          if (!ok) {
            setWrong((n) => n + 1);
            setPw("");
          }
        }}
      >
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Master password" autoComplete="current-password" autoFocus />
        {wrong > 0 && <p className="text-[13px] text-neg">That's not it. Try again.</p>}
        <Button variant="primary" type="submit" disabled={!pw || busy} className="h-11">
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </motion.form>
    </GateCard>
  );
}

/* ---------- Unlocked ---------- */

type Filter = "all" | "favorites" | "weak" | "reused" | "expiring" | Kind;

function VaultView() {
  const { items, lock, autoLock, setAutoLock } = useVault();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const checks = useMemo(() => audit(items), [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool =
      filter === "all"
        ? items
        : filter === "favorites"
          ? items.filter((i) => i.favorite)
          : filter === "weak" || filter === "reused" || filter === "expiring"
            ? checks[filter]
            : items.filter((i) => i.kind === filter);
    return pool
      .filter((i) => !q || `${i.name} ${i.fields.username ?? ""} ${i.fields.url ?? ""} ${i.fields.bank ?? ""} ${i.fields.network ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  }, [items, filter, query, checks]);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const newItem = (kind: Kind = filter in KINDS ? (filter as Kind) : "login") => setDraft({ kind, name: "", fields: {}, favorite: false });
  const issues = checks.weak.length + checks.reused.length + checks.expiring.length;

  const kindCounts = (Object.keys(KINDS) as Kind[]).map((k) => [k, items.filter((i) => i.kind === k).length] as const);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-pos" /> Encrypted · unlocked
          </span>
        }
        title="Vault"
        actions={
          <>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface pl-3 shadow-soft">
              <Timer className="size-4 text-faint" />
              <Select value={autoLock} onChange={(e) => setAutoLock(Number(e.target.value))} className="h-9 border-0 bg-transparent pl-0 text-[13px] shadow-none hover:border-0" aria-label="Auto-lock">
                {[1, 5, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    Lock after {m} min
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={lock}>
              <Lock className="size-4" /> Lock
            </Button>
            <Button variant="primary" onClick={() => newItem()}>
              <Plus className="size-4" /> New item
            </Button>
          </>
        }
      />

      {/* Security check */}
      <div className="grid gap-3 sm:grid-cols-3">
        <CheckTile active={filter === "weak"} onClick={() => setFilter(filter === "weak" ? "all" : "weak")} count={checks.weak.length} label="Weak passwords" />
        <CheckTile active={filter === "reused"} onClick={() => setFilter(filter === "reused" ? "all" : "reused")} count={checks.reused.length} label="Reused passwords" />
        <CheckTile active={filter === "expiring"} onClick={() => setFilter(filter === "expiring" ? "all" : "expiring")} count={checks.expiring.length} label="Expiring within 60 days" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className={cn("flex-col overflow-hidden lg:sticky lg:top-8 lg:flex lg:max-h-[calc(100dvh-12rem)]", selected ? "hidden" : "flex")}>
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the vault" className="h-10 pl-10" />
            </div>
            <div className="-mx-1 flex flex-wrap gap-1.5">
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>All · {items.length}</Chip>
              <Chip active={filter === "favorites"} onClick={() => setFilter("favorites")}>
                <Star className="size-3" /> Favorites
              </Chip>
              {kindCounts
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>
                    {KINDS[k].plural} · {n}
                  </Chip>
                ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {visible.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="size-5" />}
                title={items.length ? "Nothing here" : "An empty vault"}
                body={items.length ? (issues ? "Try another filter." : "No issues found.") : "Add a login, a card, an ID — anything you'd hate to lose."}
                action={!items.length && <Button onClick={() => newItem()}><Plus className="size-4" /> Add your first item</Button>}
              />
            ) : (
              visible.map((i) => <ItemRow key={i.id} item={i} active={i.id === selectedId} onClick={() => setSelectedId(i.id)} />)
            )}
          </div>
        </Card>

        <div className={cn("min-w-0 lg:block", selected ? "block" : "hidden")}>
          <AnimatePresence mode="wait" initial={false}>
            {selected ? (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                <ItemDetail item={selected} checks={checks} onBack={() => setSelectedId(null)} onEdit={() => setDraft({ ...selected })} />
              </motion.div>
            ) : (
              <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className="flex min-h-[50dvh] items-center justify-center">
                  <EmptyState icon={<Lock className="size-5" />} title="Pick an item" body="Secrets stay hidden until you reveal them, and copied values clear from the clipboard after 30 seconds." />
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <ItemDialog draft={draft} onClose={() => setDraft(null)} onSaved={setSelectedId} />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
        active ? "bg-primary text-on-primary" : "bg-sunken text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function CheckTile({ count, label, active, onClick }: { count: number; label: string; active: boolean; onClick: () => void }) {
  const ok = count === 0;
  return (
    <button
      onClick={onClick}
      disabled={ok}
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-surface px-4 py-3 text-left shadow-soft transition-all",
        active ? "border-neg ring-4 ring-neg/10" : "border-line hover:border-line-strong",
        ok && "cursor-default",
      )}
    >
      <span className={cn("flex size-9 items-center justify-center rounded-full", ok ? "bg-pos/12 text-pos" : "bg-neg/12 text-neg")}>
        {ok ? <ShieldCheck className="size-[18px]" /> : <AlertTriangle className="size-[18px]" />}
      </span>
      <span>
        <span className="block font-serif text-2xl leading-none tabular">{count}</span>
        <span className="text-[12px] text-muted">{label}</span>
      </span>
    </button>
  );
}

function subtitle(i: VaultItem) {
  switch (i.kind) {
    case "login":
      return i.fields.username || i.fields.url || "";
    case "card":
      return i.fields.number ? `•••• ${last4(i.fields.number)}${i.fields.expiry ? ` · ${i.fields.expiry}` : ""}` : "";
    case "bank":
      return i.fields.bank ?? "";
    case "identity":
      return i.fields.document ?? "";
    case "wallet":
    case "wifi":
      return i.fields.network ?? "";
    case "license":
      return i.fields.product ?? "";
    default:
      return (i.notes ?? "").slice(0, 60);
  }
}

function ItemRow({ item, active, onClick }: { item: VaultItem; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors", active ? "bg-sunken" : "hover:bg-sunken/60")}>
      <KindIcon kind={item.kind} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate font-medium">
          <span className="truncate">{item.name}</span>
          {item.favorite && <Star className="size-3 shrink-0 fill-current text-note" />}
        </span>
        <span className="block truncate text-[13px] text-muted">{subtitle(item) || KINDS[item.kind].label}</span>
      </span>
    </button>
  );
}

function ItemDetail({ item, checks, onBack, onEdit }: { item: VaultItem; checks: ReturnType<typeof audit>; onBack: () => void; onEdit: () => void }) {
  const save = useVault((s) => s.save);
  const def = KINDS[item.kind];
  const exp = expiryOf(item);
  const warnings = [
    checks.weak.includes(item) && "This password is weak. Generate a stronger one.",
    checks.reused.includes(item) && "This password is used for more than one item.",
    exp && exp < new Date() && "This has expired.",
    exp && exp >= new Date() && checks.expiring.includes(item) && `Expires ${formatDistanceToNowStrict(exp, { addSuffix: true })}.`,
  ].filter(Boolean) as string[];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 p-5 sm:p-6">
        <IconButton label="Back" onClick={onBack} className="-ml-2 lg:hidden">
          <ChevronLeft className="size-5" />
        </IconButton>
        <KindIcon kind={item.kind} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-serif text-3xl leading-tight">{item.name}</h2>
          <div className="text-[13px] text-muted">{def.label}</div>
        </div>
        <IconButton label={item.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => save({ ...item, favorite: !item.favorite })}>
          <Star className={cn("size-[18px]", item.favorite && "fill-current text-note")} />
        </IconButton>
        <Button size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      </div>

      {warnings.length > 0 && (
        <div className="mx-5 mb-4 flex flex-col gap-1 rounded-2xl bg-neg/10 px-4 py-3 text-[13px] text-neg sm:mx-6">
          {warnings.map((w) => (
            <span key={w} className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" /> {w}
            </span>
          ))}
        </div>
      )}

      {item.kind === "card" && (
        <div className="mx-auto mb-6 w-full max-w-[380px] px-5">
          <CardVisual item={item} />
        </div>
      )}

      <div className="border-t border-line">
        {def.fields.map((fd) => (
          <FieldRow key={fd.key} label={fd.label} value={item.fields[fd.key] ?? ""} secret={fd.secret} url={fd.type === "url"} mono={fd.key === "address" || fd.key === "bic"} />
        ))}
        {item.notes && <FieldRow label={item.kind === "note" ? "Note" : "Notes"} value={item.notes} secret={item.kind === "note"} />}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-sunken/40 px-5 py-3 text-[12px] text-faint sm:px-6">
        <Copy className="size-3.5" /> Copied secrets clear from the clipboard after 30 seconds
        <span className="ml-auto">Updated {formatDistanceToNowStrict(item.updatedAt, { addSuffix: true })}</span>
      </div>
    </Card>
  );
}
