import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, ExternalLink, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { ask } from "@/components/confirm";
import { Button, Card, ColorPicker, Field, Input, Modal, PageHeader, Segmented, Select, Textarea } from "@/components/ui";
import { centsToInput, currencySymbol, parseAmount, useMoney } from "@/lib/money";
import { parseDay, todayKey } from "@/lib/dates";
import { cn, swatch } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useFinance } from "@/modules/finances/store";
import { CycleField } from "./CycleField";
import { markPaid } from "./payments";
import { detect, findService, SERVICES, type Service, type Suggestion } from "./services";
import {
  CATEGORIES,
  counts,
  cycleLabel,
  daysUntil,
  lastRenewal,
  monthlyCost,
  nextRenewal,
  payable,
  perLabel,
  type SubDraft,
  type Subscription,
  type SubStatus,
  totals,
  upcoming,
  useSubscriptions,
  whenLabel,
} from "./store";

const ACCENT = "#d6589f";

const blank = (p: Partial<SubDraft> = {}): SubDraft => ({
  name: "",
  price: 0,
  cycle: "monthly",
  renews: todayKey(),
  category: "other",
  status: "active",
  color: "violet",
  ...p,
});

function fromService(s: Service, p: Partial<SubDraft> = {}): SubDraft {
  return blank({ name: s.name, category: s.category, color: s.color, emoji: s.emoji, url: s.url, ...p });
}

export function SubscriptionsPage() {
  const { subs, dismissed, dismiss } = useSubscriptions();
  const transactions = useFinance((s) => s.transactions);
  const money = useMoney();
  const [draft, setDraft] = useState<SubDraft | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);

  const t = totals(subs);
  const soon = upcoming(subs, 30)[0];
  const suggestions = useMemo(() => detect(transactions, subs, dismissed), [transactions, subs, dismissed]);
  const live = subs.filter(counts).sort((a, b) => nextDate(a).localeCompare(nextDate(b)));
  const inactive = subs.filter((s) => !counts(s));
  const categories = [...new Set(live.map((s) => s.category))];
  const shown = filter === "all" ? live : live.filter((s) => s.category === filter);

  // Spend by category, for the breakdown bar.
  const byCategory = categories
    .map((c) => ({ c, month: live.filter((s) => s.category === c && s.status === "active").reduce((sum, s) => sum + monthlyCost(s), 0) }))
    .filter((x) => x.month > 0)
    .sort((a, b) => b.month - a.month);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Subscriptions"
        title="What you pay for"
        actions={
          <Button variant="primary" onClick={() => setDraft(blank())}>
            <Plus className="size-4" /> Add subscription
          </Button>
        }
      />

      {subs.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="relative overflow-hidden p-6">
            <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full opacity-70 blur-3xl" style={{ background: `radial-gradient(circle, ${ACCENT}33, transparent 70%)` }} />
            <div className="relative">
              <div className="text-[13px] font-medium text-muted">Every month</div>
              <div className="mt-1 font-serif text-[52px] leading-none tracking-tight tabular">{money(t.month)}</div>
              <div className="mt-2 text-[13px] text-muted">
                {money(t.year)} a year · {t.count} {t.count === 1 ? "subscription" : "subscriptions"}
              </div>
              {byCategory.length > 0 && (
                <>
                  <div className="mt-5 flex h-2 gap-[2px] overflow-hidden rounded-full">
                    {byCategory.map(({ c, month }, i) => (
                      <div key={c} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(month / t.month) * 100}%`, background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                    {byCategory.map(({ c, month }, i) => (
                      <span key={c} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                        {CATEGORIES[c]?.label ?? c} <span className="text-ink tabular">{money(month)}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>
          <Tile label="Next up">
            {soon ? (
              <>
                <div className="truncate font-serif text-3xl leading-tight">{soon.sub.name}</div>
                <div className={cn("mt-1 text-[13px]", daysUntil(soon.date) <= 3 ? "font-medium text-[#d99a1e]" : "text-muted")}>
                  {soon.kind === "trial" ? "Trial ends" : `Renews · ${money(soon.sub.price)}`} {whenLabel(soon.date)}
                </div>
              </>
            ) : (
              <div className="text-[14px] text-muted">Nothing renews in the next 30 days.</div>
            )}
          </Tile>
          <Tile label="Free trials">
            {(() => {
              const trials = subs.filter((s) => s.status === "trial");
              return trials.length ? (
                <>
                  <div className="font-serif text-3xl leading-tight tabular">{trials.length}</div>
                  <div className="mt-1 text-[13px] text-muted">
                    {trials
                      .filter((s) => s.trialEnds)
                      .slice(0, 2)
                      .map((s) => `${s.name} ends ${whenLabel(s.trialEnds!)}`)
                      .join(" · ") || "No end dates set"}
                  </div>
                </>
              ) : (
                <div className="text-[14px] text-muted">None running. Add one with its end date so you're warned before it charges you.</div>
              );
            })()}
          </Tile>
        </div>
      )}

      {suggestions.length > 0 && <Suggestions items={suggestions} onAdd={(s) => setDraft(fromSuggestion(s))} onDismiss={(s) => dismiss(s.key)} />}

      {subs.length === 0 ? (
        <Starter onPick={(s) => setDraft(s ? fromService(s) : blank())} />
      ) : (
        <>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip on={filter === "all"} onClick={() => setFilter("all")}>
                All · {live.length}
              </FilterChip>
              {categories.map((c) => (
                <FilterChip key={c} on={filter === c} onClick={() => setFilter(c)}>
                  {CATEGORIES[c]?.emoji} {CATEGORIES[c]?.label ?? c}
                </FilterChip>
              ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {shown.map((s, i) => (
                <motion.div key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }} exit={{ opacity: 0, scale: 0.97 }}>
                  <SubCard sub={s} onClick={() => setDraft({ ...s })} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {inactive.length > 0 && (
            <div>
              <button onClick={() => setShowInactive(!showInactive)} className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint hover:text-muted">
                Paused & cancelled · {inactive.length}
                <ChevronDown className={cn("size-3.5 transition-transform", showInactive && "rotate-180")} />
              </button>
              <AnimatePresence initial={false}>
                {showInactive && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {inactive.map((s) => (
                        <SubCard key={s.id} sub={s} onClick={() => setDraft({ ...s })} />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      <SubDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

const CATEGORY_COLORS = ["#d6589f", "#7c6cff", "#1f9e85", "#d99a1e", "#3b82f6", "#ec7a3c", "#7a8394"];

const nextDate = (s: Subscription) => (s.status === "trial" && s.trialEnds ? s.trialEnds : nextRenewal(s));

function fromSuggestion(s: Suggestion): SubDraft {
  const base = s.service ? fromService(s.service) : blank({ name: s.name });
  return { ...base, price: s.price, cycle: s.cycle, renews: s.next };
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col justify-between gap-3 p-6">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div>{children}</div>
    </Card>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors", on ? "bg-primary text-on-primary" : "bg-surface text-muted shadow-soft hover:text-ink")}
    >
      {children}
    </button>
  );
}

function Logo({ sub, size = "md" }: { sub: Pick<Subscription, "name" | "emoji" | "color">; size?: "md" | "lg" }) {
  const s = swatch(sub.color);
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center font-semibold", size === "lg" ? "size-14 rounded-[20px] text-[26px]" : "size-11 rounded-2xl text-[20px]")}
      style={{ background: s.soft, color: s.fg }}
    >
      {sub.emoji || sub.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function SubCard({ sub, onClick }: { sub: Subscription; onClick: () => void }) {
  const money = useMoney();
  const s = swatch(sub.color);
  const date = nextDate(sub);
  const days = daysUntil(date);
  const inactive = sub.status === "paused" || sub.status === "cancelled";
  const due = payable(sub);
  const today = todayKey();
  const paidNow = !due && sub.status === "active" && !!sub.paidThrough && sub.paidThrough >= (lastRenewal(sub, today) ?? "");
  return (
    <div className={cn("group relative w-full overflow-hidden rounded-3xl border border-line bg-surface p-5 text-left shadow-card transition-transform hover:-translate-y-0.5", inactive && "opacity-60")}>
      <button onClick={onClick} aria-label={`Edit ${sub.name}`} className="absolute inset-0 z-[1] rounded-3xl" />
      <div className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full blur-2xl transition-opacity group-hover:opacity-100" style={{ background: s.soft, opacity: 0.7 }} />
      <div className="relative flex items-start gap-3">
        <Logo sub={sub} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">{sub.name}</div>
          <div className="truncate text-[12px] text-muted">
            {CATEGORIES[sub.category]?.label ?? "Other"}
            {sub.paidWith && ` · ${sub.paidWith}`}
          </div>
        </div>
        {sub.status !== "active" && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              sub.status === "trial" ? "bg-[#d99a1e]/15 text-[#b7791f]" : "bg-sunken text-muted",
            )}
          >
            {sub.status}
          </span>
        )}
      </div>
      <div className="relative mt-5 flex items-end justify-between gap-3">
        <div>
          <span className="font-serif text-[32px] leading-none tabular">{money(sub.price)}</span>
          <span className="ml-1 text-[13px] text-muted">/ {perLabel(sub)}</span>
          {(sub.cycle !== "monthly" || sub.every) && <div className="mt-1 text-[12px] text-faint tabular">≈ {money(monthlyCost(sub))} a month</div>}
        </div>
        {!inactive && (
          <div className={cn("text-right text-[12px]", days <= 3 ? "font-semibold text-[#b7791f]" : "text-muted")}>
            <div>{sub.status === "trial" && sub.trialEnds ? "Trial ends" : "Renews"}</div>
            <div className="tabular">
              {format(parseDay(date), "MMM d")} · {whenLabel(date)}
            </div>
          </div>
        )}
      </div>
      {(due || paidNow) && (
        <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
          {due ? (
            <>
              <span className={cn("text-[12px]", due.overdue ? "font-medium text-neg" : "text-muted")}>
                {due.overdue ? `Unpaid since ${format(parseDay(due.date), "MMM d")}` : due.early ? `${format(parseDay(due.date), "MMM d")} payment, coming up` : `${format(parseDay(due.date), "MMM d")} payment`}
              </span>
              <Button size="sm" variant={due.overdue ? "primary" : undefined} onClick={() => markPaid(sub, due.date)} className="relative z-[2]">
                <Check className="size-3.5" /> Mark paid
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-pos">
              <Check className="size-3.5" /> Paid for {format(parseDay(sub.paidThrough!), "MMM d")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Suggestions({ items, onAdd, onDismiss }: { items: Suggestion[]; onAdd: (s: Suggestion) => void; onDismiss: (s: Suggestion) => void }) {
  const money = useMoney();
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <Sparkles className="size-4" style={{ color: ACCENT }} />
        <div>
          <div className="text-[15px] font-semibold">Found in your transactions</div>
          <div className="text-[13px] text-muted">Charges that repeat like subscriptions. Add the ones you want to keep an eye on.</div>
        </div>
      </div>
      <ul className="p-2">
        {items.slice(0, 6).map((s) => (
          <li key={s.key} className="flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-sunken/60">
            <Logo sub={{ name: s.name, emoji: s.service?.emoji, color: s.service?.color ?? "slate" }} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{s.name}</div>
              <div className="text-[12px] text-muted tabular">
                {money(s.price)} {cycleLabel(s).toLowerCase()} · seen {s.seen} {s.seen === 1 ? "time" : "times"}, last {format(parseDay(s.last), "MMM d")}
              </div>
            </div>
            <Button size="sm" onClick={() => onAdd(s)}>
              <Plus className="size-3.5" /> Add
            </Button>
            <button onClick={() => onDismiss(s)} title="Not a subscription" aria-label={`Not a subscription: ${s.name}`} className="rounded-lg p-1.5 text-faint hover:bg-surface hover:text-ink">
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Starter({ onPick }: { onPick: (s: Service | null) => void }) {
  const popular = ["Netflix", "Spotify", "YouTube Premium", "Disney+", "iCloud+", "Google One", "Microsoft 365", "Claude", "ChatGPT", "Prime Video / Amazon Prime", "Canal+", "Deezer"];
  return (
    <Card className="relative overflow-hidden p-8 sm:p-10">
      <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-70 blur-3xl" style={{ background: `radial-gradient(circle, ${ACCENT}2e, transparent 70%)` }} />
      <div className="relative">
        <h2 className="font-serif text-4xl leading-tight">Everything you're subscribed to, in one place</h2>
        <p className="mt-2 max-w-xl text-[15px] text-muted">See what it all costs each month, what renews next, and when free trials are about to start charging. Tap a service to add it.</p>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {popular.map((name) => {
            const s = SERVICES.find((x) => x.name === name)!;
            return (
              <button key={name} onClick={() => onPick(s)} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left text-[14px] font-medium shadow-soft transition-all hover:-translate-y-0.5 hover:border-line-strong">
                <Logo sub={{ name: s.name, emoji: s.emoji, color: s.color }} />
                <span className="truncate">{s.name}</span>
              </button>
            );
          })}
          <button onClick={() => onPick(null)} className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-line px-3 py-2.5 text-left text-[14px] font-medium text-muted hover:border-line-strong hover:text-ink">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-sunken">
              <Plus className="size-5" />
            </span>
            Something else
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ---------- Editor ---------- */

function SubDialog({ draft, onClose }: { draft: SubDraft | null; onClose: () => void }) {
  const { save, remove } = useSubscriptions();
  const currency = useSettings((s) => s.currency);
  const [form, setForm] = useState<SubDraft | null>(draft);
  const [price, setPrice] = useState("");
  const [query, setQuery] = useState("");
  const [prev, setPrev] = useState(draft);
  if (draft !== prev) {
    setPrev(draft);
    if (draft) {
      setForm(draft);
      setPrice(draft.price ? centsToInput(draft.price) : "");
      setQuery("");
    }
  }
  // `form` outlives `draft` so the dialog keeps its content during the exit animation.
  const f = form ?? draft;
  if (!f) return null;
  const patch = (p: Partial<SubDraft>) => setForm({ ...f, ...p });
  const accounts = useFinance.getState().accounts;
  const cents = parseAmount(price);
  const invalid = !f.name.trim() || cents === null || cents < 0;
  const matches = query.trim() ? SERVICES.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6) : [];

  const submit = () => {
    if (invalid) return;
    // Recognise well-known services typed by hand, for the right look and link.
    const known = !f.emoji && !f.url ? findService(f.name) : undefined;
    save({
      ...f,
      ...(known ? { emoji: known.emoji, url: known.url, color: known.color, category: f.category === "other" ? known.category : f.category } : {}),
      name: f.name.trim(),
      price: cents!,
      trialEnds: f.status === "trial" ? f.trialEnds : undefined,
      paidWith: f.paidWith?.trim() || undefined,
      url: f.url?.trim() || undefined,
      notes: f.notes?.trim() || undefined,
    });
    onClose();
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={f.id ? f.name || "Subscription" : "Add a subscription"}
      accent={swatch(f.color).fg}
      footer={
        <>
          {f.id && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!(await ask({ title: `Remove “${f.name}”?`, body: "It will no longer be tracked. To keep it as history instead, set it to Cancelled.", confirmLabel: "Remove", danger: true }))) return;
                remove(f.id!);
                onClose();
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          {f.url && (
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted hover:bg-sunken hover:text-ink">
              <ExternalLink className="size-4" /> Website
            </a>
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
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a service — Netflix, Spotify, iCloud…" className="pl-10" />
            {matches.length > 0 && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-2xl border border-line bg-raised p-1.5 shadow-float">
                {matches.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setForm(fromService(s, { price: f.price, cycle: f.cycle, renews: f.renews, status: f.status, trialEnds: f.trialEnds, paidWith: f.paidWith }));
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-[14px] hover:bg-sunken"
                  >
                    <span className="text-lg">{s.emoji}</span> {s.name}
                    <span className="ml-auto text-[12px] text-faint">{CATEGORIES[s.category]?.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-end gap-3">
          <input
            value={f.emoji ?? ""}
            onChange={(e) => patch({ emoji: e.target.value.slice(-2) || undefined })}
            placeholder={f.name.slice(0, 1).toUpperCase() || "✦"}
            aria-label="Icon"
            className="size-11 shrink-0 rounded-2xl text-center text-[20px] focus:outline-none"
            style={{ background: swatch(f.color).soft, color: swatch(f.color).fg }}
          />
          <Field label="Name" className="flex-1">
            {(id) => <Input id={id} value={f.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Netflix" autoFocus={!f.id} />}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Price">
            {(id) => (
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-faint">{currencySymbol(currency)}</span>
                <Input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="pl-9 tabular" />
              </div>
            )}
          </Field>
          <CycleField label="Billed" value={f} onChange={(r) => patch({ cycle: r.cycle, every: r.every })} />
        </div>

        <Field label="Status">
          {() => (
            <Segmented
              layoutId="sub-status"
              className="w-full"
              value={f.status}
              onChange={(status: SubStatus) => patch({ status })}
              options={[
                { value: "active", label: "Active" },
                { value: "trial", label: "Free trial" },
                { value: "paused", label: "Paused" },
                { value: "cancelled", label: "Cancelled" },
              ]}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={f.status === "trial" ? "First charge" : "Next renewal"}>
            {(id) => <Input id={id} type="date" value={f.renews} onChange={(e) => e.target.value && patch({ renews: e.target.value })} />}
          </Field>
          {f.status === "trial" ? (
            <Field label="Trial ends">
              {(id) => <Input id={id} type="date" value={f.trialEnds ?? ""} onChange={(e) => patch({ trialEnds: e.target.value || undefined, renews: e.target.value || f.renews })} />}
            </Field>
          ) : (
            <Field label="Category">
              {(id) => (
                <Select id={id} value={f.category} onChange={(e) => patch({ category: e.target.value })}>
                  {Object.entries(CATEGORIES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.emoji} {v.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid with">{(id) => <Input id={id} value={f.paidWith ?? ""} onChange={(e) => patch({ paidWith: e.target.value })} placeholder="e.g. Visa ••4242" />}</Field>
          <Field label="Paid from (in Finances)">
            {(id) => (
              <Select id={id} value={f.accountId ?? accounts[0]?.id ?? ""} onChange={(e) => patch({ accountId: e.target.value })} disabled={!accounts.length}>
                {accounts.length ? accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                )) : <option value="">No accounts yet</option>}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Website">{(id) => <Input id={id} type="url" value={f.url ?? ""} onChange={(e) => patch({ url: e.target.value })} placeholder="https://" />}</Field>

        <Field label="Color">{() => <ColorPicker value={f.color} onChange={(color) => patch({ color })} />}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} value={f.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} placeholder="Shared with family, plan name, how to cancel…" />}</Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
