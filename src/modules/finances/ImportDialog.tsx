import { useMemo, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, ArrowLeft, Check, FileUp, Sparkles } from "lucide-react";
import { Button, Field, Modal, Segmented, Select, Switch } from "@/components/ui";
import { explain, useAi } from "@/lib/ai";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { guessCategory, ruleKeyFor, sortWithClaude, type Guess } from "./categorize";
import { applyMapping, decode, fingerprint, parseStatement, tidy, type DateOrder, type Mapping, type RawTx, type Table } from "./importers";
import { useFinance, type TxKind } from "./store";

type Row = {
  key: string;
  date: string;
  kind: TxKind;
  amount: number;
  raw: string;
  title: string;
  categoryId: string;
  source: Guess["source"] | "claude" | "you";
  status: "new" | "imported" | "maybe";
  include: boolean;
};

type Source = { name: string; format: string; table?: Table; signature?: string; txs?: RawTx[] };

export type ImportSummary = { count: number; latest: string | null };

const FORMATS = "CSV, OFX/QFX, QIF or CAMT.053 (XML)";

export function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (s: ImportSummary) => void }) {
  const { accounts, categories, transactions, rules, csvPresets, addTransactions, saveRule, savePreset } = useFinance();
  const hasKey = useAi((s) => !!s.apiKey.trim());
  const money = useMoney();
  const [step, setStep] = useState<"pick" | "map" | "review">("pick");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [source, setSource] = useState<Source | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [showImported, setShowImported] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("pick");
    setSource(null);
    setMapping(null);
    setRows([]);
    setError(null);
    setShowImported(false);
  };
  const close = () => {
    onClose();
    setTimeout(reset, 300);
  };

  /** Compares statement lines with what's already in the account. */
  const buildRows = (txs: RawTx[]): Row[] => {
    const existing = transactions.filter((t) => t.accountId === accountId);
    const imported = new Set(existing.map((t) => t.importKey).filter(Boolean));
    // Lines you typed in yourself have no import key; match them on date and amount.
    const typed = new Map<string, number>();
    for (const t of existing) if (!t.importKey) typed.set(`${t.date}|${t.kind === "income" ? t.amount : -t.amount}`, (typed.get(`${t.date}|${t.kind === "income" ? t.amount : -t.amount}`) ?? 0) + 1);
    const seen = new Map<string, number>();
    return txs.map((t) => {
      const fp = fingerprint(t);
      const n = (seen.get(fp) ?? 0) + 1;
      seen.set(fp, n);
      const key = t.bankId ? `id:${t.bankId}` : `${fp}#${n}`;
      const kind: TxKind = t.amount < 0 ? "expense" : "income";
      const title = tidy(t.description) || "Bank transaction";
      const guess = guessCategory(`${t.description} ${title}`, kind, rules, categories);
      const typedKey = `${t.date}|${t.amount}`;
      const status: Row["status"] = imported.has(key) ? "imported" : typed.get(typedKey) ? "maybe" : "new";
      if (status === "maybe") typed.set(typedKey, typed.get(typedKey)! - 1);
      return { key, date: t.date, kind, amount: Math.abs(t.amount), raw: t.description, title, categoryId: guess.categoryId, source: guess.source, status, include: status === "new" };
    });
  };

  const readFile = async (file: File) => {
    setError(null);
    try {
      const parsed = parseStatement(decode(await file.arrayBuffer()), file.name);
      if (parsed.kind === "table") {
        const signature = parsed.table.header.join("|").toLowerCase();
        const m = csvPresets[signature] ?? parsed.mapping;
        setSource({ name: file.name, format: parsed.format, table: parsed.table, signature });
        setMapping(m);
        // A layout seen before goes straight to review.
        if (csvPresets[signature]) {
          setRows(buildRows(applyMapping(parsed.table, m)));
          setStep("review");
        } else setStep("map");
      } else {
        if (!parsed.txs.length) throw new Error("No transactions were found in this file.");
        setSource({ name: file.name, format: parsed.format, txs: parsed.txs });
        setRows(buildRows(parsed.txs));
        setStep("review");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const preview = useMemo(() => (source?.table && mapping ? applyMapping(source.table, mapping) : []), [source, mapping]);

  const visible = rows.filter((r) => showImported || r.status !== "imported");
  const chosen = rows.filter((r) => r.include);
  const unsorted = chosen.filter((r) => r.source === "none");
  const counts = {
    fresh: rows.filter((r) => r.status === "new").length,
    imported: rows.filter((r) => r.status === "imported").length,
    maybe: rows.filter((r) => r.status === "maybe").length,
  };
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const sort = async () => {
    setSorting(true);
    setError(null);
    try {
      const lines = rows.map((r, index) => ({ r, index })).filter(({ r }) => r.include && r.source === "none");
      const result = await sortWithClaude(
        lines.map(({ r, index }) => ({ index, description: `${r.title} (${r.raw})`, amount: r.amount, kind: r.kind })),
        categories,
      );
      setRows((rs) => rs.map((r, i) => (result.has(i) ? { ...r, categoryId: result.get(i)!, source: "claude" } : r)));
    } catch (e) {
      setError(explain(e));
    } finally {
      setSorting(false);
    }
  };

  const finish = () => {
    addTransactions(chosen.map((r) => ({ kind: r.kind, amount: r.amount, categoryId: r.categoryId, accountId, date: r.date, note: r.title, importKey: r.key })));
    if (remember) for (const r of chosen) if (r.source === "you") saveRule(ruleKeyFor(r.title), r.categoryId);
    if (source?.signature && mapping) savePreset(source.signature, mapping);
    onDone({ count: chosen.length, latest: chosen.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null) });
    close();
  };

  const colOptions = (source?.table?.header ?? []).map((h, i) => (
    <option key={i} value={i}>
      {h || `Column ${i + 1}`}
    </option>
  ));

  return (
    <Modal
      open={open}
      onClose={close}
      size={step === "pick" ? "md" : "lg"}
      title={step === "pick" ? "Import a statement" : step === "map" ? "Match the columns" : "Review & import"}
      accent="var(--fin)"
      footer={
        step === "pick" ? undefined : (
          <>
            <Button variant="ghost" onClick={() => (step === "review" && source?.table ? setStep("map") : reset())}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            <div className="flex-1" />
            {step === "map" ? (
              <Button
                variant="primary"
                disabled={!preview.length}
                onClick={() => {
                  setRows(buildRows(preview));
                  setStep("review");
                }}
              >
                Continue with {preview.length} lines
              </Button>
            ) : (
              <Button variant="primary" disabled={!chosen.length} onClick={finish}>
                <Check className="size-4" /> Import {chosen.length} {chosen.length === 1 ? "transaction" : "transactions"}
              </Button>
            )}
          </>
        )
      }
    >
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-neg/10 px-3.5 py-2.5 text-[13px] text-neg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {step === "pick" && (
        <div className="flex flex-col gap-5">
          <Field label="Into which account?">
            {(id) => (
              <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <button
            onClick={() => input.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) readFile(f);
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging ? "border-fin bg-fin-soft" : "border-line hover:border-line-strong hover:bg-sunken/50",
            )}
          >
            <span className="flex size-12 items-center justify-center rounded-2xl bg-fin-soft text-fin">
              <FileUp className="size-5" />
            </span>
            <span className="font-medium">Drop your bank statement here</span>
            <span className="text-[13px] text-muted">or click to choose a file · {FORMATS}</span>
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".csv,.txt,.ofx,.qfx,.qif,.xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = "";
            }}
          />
          <p className="text-[12px] leading-relaxed text-faint">
            Most banks offer this under “Download” or “Export” next to your account history. Pick OFX or CSV if you can. Lines you've already imported are skipped
            automatically, so overlapping statements are fine. Everything stays on this device.
          </p>
        </div>
      )}

      {step === "map" && source?.table && mapping && (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] text-muted">
            Haven guessed how <span className="font-medium text-ink">{source.name}</span> is laid out. Check the preview — it'll remember this layout for next time.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">
              {(id) => (
                <Select id={id} value={mapping.date} onChange={(e) => setMapping({ ...mapping, date: Number(e.target.value) })}>
                  {colOptions}
                </Select>
              )}
            </Field>
            <Field label="Date order">
              {(id) => (
                <Select id={id} value={mapping.dateOrder} onChange={(e) => setMapping({ ...mapping, dateOrder: e.target.value as DateOrder })}>
                  <option value="dmy">Day / month / year</option>
                  <option value="mdy">Month / day / year</option>
                  <option value="ymd">Year / month / day</option>
                </Select>
              )}
            </Field>
            <Field label="Description">
              {(id) => (
                <Select id={id} value={mapping.description[0] ?? 0} onChange={(e) => setMapping({ ...mapping, description: [Number(e.target.value), ...mapping.description.slice(1)] })}>
                  {colOptions}
                </Select>
              )}
            </Field>
            <Field label="Extra detail (optional)">
              {(id) => (
                <Select
                  id={id}
                  value={mapping.description[1] ?? -1}
                  onChange={(e) => setMapping({ ...mapping, description: Number(e.target.value) >= 0 ? [mapping.description[0], Number(e.target.value)] : [mapping.description[0]] })}
                >
                  <option value={-1}>None</option>
                  {colOptions}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
            <Segmented
              layoutId="import-amounts"
              className="self-start"
              value={mapping.amount !== null ? "one" : "two"}
              onChange={(v) =>
                setMapping(
                  v === "one"
                    ? { ...mapping, amount: mapping.debit ?? mapping.credit ?? 0, debit: null, credit: null }
                    : { ...mapping, debit: mapping.amount ?? 0, credit: mapping.amount ?? 0, amount: null },
                )
              }
              options={[
                { value: "one", label: "One amount column" },
                { value: "two", label: "Separate money out / in" },
              ]}
            />
            {mapping.amount !== null ? (
              <Field label="Amount">
                {(id) => (
                  <Select id={id} value={mapping.amount!} onChange={(e) => setMapping({ ...mapping, amount: Number(e.target.value) })}>
                    {colOptions}
                  </Select>
                )}
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Money out">
                  {(id) => (
                    <Select id={id} value={mapping.debit ?? 0} onChange={(e) => setMapping({ ...mapping, debit: Number(e.target.value) })}>
                      {colOptions}
                    </Select>
                  )}
                </Field>
                <Field label="Money in">
                  {(id) => (
                    <Select id={id} value={mapping.credit ?? 0} onChange={(e) => setMapping({ ...mapping, credit: Number(e.target.value) })}>
                      {colOptions}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <Switch label="Spending is shown as positive numbers (flip signs)" checked={mapping.flip} onChange={(flip) => setMapping({ ...mapping, flip })} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">
              Preview · {preview.length} of {source.table.rows.length} lines recognised
            </div>
            <div className="overflow-hidden rounded-2xl border border-line">
              {preview.slice(0, 6).map((t, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0">
                  <span className="w-24 shrink-0 text-muted tabular">{t.date}</span>
                  <span className="min-w-0 flex-1 truncate">{tidy(t.description)}</span>
                  <span className={cn("font-medium tabular", t.amount > 0 ? "text-pos" : "")}>{money(t.amount, { sign: true })}</span>
                </div>
              ))}
              {!preview.length && <div className="px-4 py-6 text-center text-[13px] text-neg">No lines match — try different columns or date order.</div>}
            </div>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-full bg-sunken px-3 py-1 font-medium">{source?.format}</span>
            <span className="text-muted">{source?.name}</span>
            <span className="flex-1" />
            <span className="font-medium text-pos">{counts.fresh} new</span>
            {counts.maybe > 0 && <span className="text-[#d99a1e]">· {counts.maybe} maybe already entered</span>}
            {counts.imported > 0 && (
              <button onClick={() => setShowImported(!showImported)} className="text-muted hover:text-ink hover:underline">
                · {counts.imported} already imported {showImported ? "(hide)" : "(show)"}
              </button>
            )}
          </div>

          {hasKey && unsorted.length > 0 && (
            <div className="flex items-center gap-3 rounded-2xl bg-cal-soft/60 px-4 py-3 text-[13px]">
              <Sparkles className="size-4 shrink-0 text-cal" />
              <span className="flex-1">{unsorted.length} lines didn't match a known merchant.</span>
              <Button size="sm" onClick={sort} disabled={sorting}>
                {sorting ? "Sorting…" : "Sort them with Claude"}
              </Button>
            </div>
          )}

          <div className="max-h-[48dvh] overflow-y-auto rounded-2xl border border-line">
            {visible.map((r) => {
              const options = categories.filter((c) => c.kind === r.kind);
              return (
                <div key={r.key} className={cn("flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0", !r.include && "opacity-50")}>
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={(e) => patch(r.key, { include: e.target.checked })}
                    aria-label={`Include ${r.title}`}
                    className="size-4 shrink-0 accent-[var(--fin)]"
                  />
                  <span className="hidden w-[84px] shrink-0 text-[12px] text-muted tabular sm:block">{r.date}</span>
                  <div className="min-w-0 flex-1" title={r.raw}>
                    <div className="truncate text-[14px] font-medium">{r.title}</div>
                    <div className="truncate text-[11px] text-faint">
                      <span className="sm:hidden">{r.date} · </span>
                      {r.status === "imported" ? "Already imported" : r.status === "maybe" ? "Looks like one you entered by hand" : r.raw}
                    </div>
                  </div>
                  <select
                    value={r.categoryId}
                    onChange={(e) => patch(r.key, { categoryId: e.target.value, source: "you" })}
                    className={cn(
                      "h-8 w-32 shrink-0 cursor-pointer rounded-lg border bg-surface px-2 text-[12px] focus:outline-none sm:w-36",
                      r.source === "none" ? "border-dashed border-line-strong text-muted" : "border-line",
                    )}
                  >
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className={cn("w-24 shrink-0 text-right text-[13px] font-medium tabular", r.kind === "income" && "text-pos")}>
                    {money(r.kind === "income" ? r.amount : -r.amount, { sign: true })}
                  </span>
                </div>
              );
            })}
          </div>
          <Switch label="Remember my category changes for future imports" checked={remember} onChange={setRemember} />
        </div>
      )}
    </Modal>
  );
}
