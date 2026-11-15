import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { format, formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, Check, ChevronLeft, GitBranch, KeyRound, Lock, Plus, RotateCw, Shield, Swords, Trash2, X } from "lucide-react";
import { ask } from "@/components/confirm";
import { Button, Card, EmptyState, Field, IconButton, Input, PageHeader, Segmented, Select, Textarea } from "@/components/ui";
import { explain, useAiReady } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { strength, STRENGTH } from "@/modules/vault/crypto";
import { analyzeDossier } from "./analyze";
import { calibration, TERRAINS, useDecisions, VERDICTS, type Dossier, type Terrain, type Verdict } from "./store";

const ACCENT = "#0f766e";

export function DecisionsPage() {
  const status = useDecisions((s) => s.status);
  return status === "unlocked" ? <Room /> : <Gate creating={status === "none"} />;
}

/* ---------- The lock ---------- */

function Gate({ creating }: { creating: boolean }) {
  const { create, unlock } = useDecisions();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = strength(password);

  const submit = async () => {
    setError(null);
    if (creating && password.length < 8) return setError("Use at least 8 characters.");
    if (creating && password !== again) return setError("The two passwords don't match.");
    setBusy(true);
    if (creating) await create(password);
    else if (!(await unlock(password))) setError("That isn't the password.");
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Decisions" title="Decisions" />
      <Card className="mx-auto w-full max-w-md p-8">
        <div className="mb-5 flex size-14 items-center justify-center rounded-[20px] text-white shadow-card" style={{ background: ACCENT }}>
          {creating ? <KeyRound className="size-6" /> : <Lock className="size-6" />}
        </div>
        <div className="font-serif text-3xl">{creating ? "A private room for hard choices" : "Decisions are locked"}</div>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {creating
            ? "Set a password for this room. Your dossiers are encrypted with it on this device; your account only ever stores the locked version. It can't be recovered if you forget it."
            : "Enter the password for Decisions. It locks again after 10 minutes without activity."}
        </p>
        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoFocus autoComplete={creating ? "new-password" : "current-password"} />
          {creating && (
            <>
              {password && (
                <div className="text-[12px]" style={{ color: STRENGTH[s].color }}>
                  {STRENGTH[s].label}
                </div>
              )}
              <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="The same password again" autoComplete="new-password" />
            </>
          )}
          {error && <div className="text-[13px] text-neg">{error}</div>}
          <Button type="submit" variant="primary" disabled={busy || !password}>
            {busy ? "One moment…" : creating ? "Create the room" : "Unlock"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

/* ---------- Inside ---------- */

function Room() {
  const [params, setParams] = useSearchParams();
  const { dossiers, lock } = useDecisions();
  const go = (p: Record<string, string>) => setParams(p);
  const editing = params.get("edit");
  const open = dossiers.find((d) => d.id === params.get("d"));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Decisions"
        title="Decisions"
        actions={
          <>
            <Button variant="primary" onClick={() => go({ edit: "new" })}>
              <Plus className="size-4" /> New problem
            </Button>
            <IconButton label="Lock" onClick={lock}>
              <Lock className="size-[18px]" />
            </IconButton>
          </>
        }
      />
      {editing ? (
        <DossierForm dossier={dossiers.find((d) => d.id === editing)} onDone={(id) => go(id ? { d: id } : {})} />
      ) : open ? (
        <DossierView dossier={open} onBack={() => go({})} onEdit={() => go({ edit: open.id })} />
      ) : (
        <DossierList dossiers={dossiers} onOpen={(id) => go({ d: id })} onNew={() => go({ edit: "new" })} />
      )}
    </div>
  );
}

function stage(d: Dossier) {
  if (d.outcome) return { label: VERDICTS[d.outcome.verdict].label, tone: "text-pos" };
  if (d.decision) return { label: "Decided", tone: "text-cal" };
  if (d.analysis) return { label: "To decide", tone: "text-[#b7791f]" };
  return { label: "Draft", tone: "text-faint" };
}

function DossierList({ dossiers, onOpen, onNew }: { dossiers: Dossier[]; onOpen: (id: string) => void; onNew: () => void }) {
  if (!dossiers.length)
    return (
      <Card>
        <EmptyState
          icon={<GitBranch className="size-5" />}
          title="See several moves ahead"
          body="Bring a hard choice. You get branches with explicit odds, their consequences at 1, 5 and 10 years, a red team that attacks your favourite, and the biases pushing you to decide too fast."
          action={
            <Button variant="primary" onClick={onNew}>
              <Plus className="size-4" /> New problem
            </Button>
          }
        />
      </Card>
    );
  const cal = calibration(dossiers);
  const decided = dossiers.filter((d) => d.decision).length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">
        {dossiers.length} {dossiers.length === 1 ? "problem" : "problems"} · {decided} decided ·{" "}
        {cal.score === null ? "record what happened after a decision to see how well predictions hold up" : `predictions held up ${cal.score}% of the time (${cal.reviewed} reviewed)`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {dossiers.map((d) => {
          const st = stage(d);
          return (
            <button key={d.id} onClick={() => onOpen(d.id)} className="rounded-3xl border border-line bg-surface p-5 text-left shadow-card transition-transform hover:-translate-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="font-semibold uppercase tracking-[0.08em] text-muted">{TERRAINS[d.terrain]}</span>
                <span className={cn("font-medium", st.tone)}>{st.label}</span>
              </div>
              <div className="mt-2 line-clamp-2 font-serif text-xl leading-snug">{d.title || "Untitled"}</div>
              <div className="mt-2 text-[12px] text-faint">Updated {formatDistanceToNowStrict(d.updatedAt, { addSuffix: true })}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Writing the problem down ---------- */

function DossierForm({ dossier, onDone }: { dossier?: Dossier; onDone: (id?: string) => void }) {
  const { save, patch } = useDecisions();
  const ready = useAiReady();
  const [title, setTitle] = useState(dossier?.title ?? "");
  const [terrain, setTerrain] = useState<Terrain>(dossier?.terrain ?? "professional");
  const [problem, setProblem] = useState(dossier?.problem ?? "");
  const [context, setContext] = useState(dossier?.context ?? "");
  const [options, setOptions] = useState<string[]>(dossier?.options.length ? dossier.options : [""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (analyze: boolean) => {
    setError(null);
    const id = await save({ ...dossier, id: dossier?.id, title: title.trim(), terrain, problem, context, options: options.map((o) => o.trim()).filter(Boolean) });
    if (!analyze) return onDone(id);
    setBusy(true);
    try {
      const all = useDecisions.getState().dossiers;
      await patch(id, { analysis: await analyzeDossier(all.find((d) => d.id === id)!, all) });
      onDone(id);
    } catch (e) {
      setError(explain(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <IconButton label="Back" onClick={() => onDone(dossier?.id)} className="-ml-2">
          <ChevronLeft className="size-5" />
        </IconButton>
        <div className="font-serif text-2xl">{dossier ? "Edit the problem" : "Lay out the problem"}</div>
      </div>
      <Card className="flex flex-col gap-5 p-6">
        <Field label="The problem, in one line">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leave a stable job to start my own practice" />}</Field>
        <Field label="Terrain">
          {() => <Segmented<Terrain> layoutId="dossier-terrain" value={terrain} onChange={setTerrain} options={(Object.keys(TERRAINS) as Terrain[]).map((t) => ({ value: t, label: TERRAINS[t] }))} />}
        </Field>
        <Field label="Lay it out without smoothing it">
          {(id) => <Textarea id={id} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What's at stake, what you fear, what you secretly hope, by when you must decide…" className="min-h-32" />}
        </Field>
        <Field label="Useful context">
          {(id) => <Textarea id={id} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Money, commitments, who's affected, how much room you really have…" className="min-h-24" />}
        </Field>
        <Field label="Options you're considering">
          {() => (
            <div className="flex flex-col gap-2">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder="One possible branch" />
                  {options.length > 1 && (
                    <IconButton label="Remove" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </IconButton>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setOptions([...options, ""])} className="flex items-center gap-1 self-start text-[13px] font-medium" style={{ color: ACCENT }}>
                <Plus className="size-3.5" /> Add an option
              </button>
            </div>
          )}
        </Field>
      </Card>
      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-neg/10 px-4 py-3 text-[14px] text-neg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" className="h-11 px-5" disabled={!title.trim() || busy || !ready} onClick={() => void submit(true)}>
          <GitBranch className={cn("size-4", busy && "animate-pulse")} /> {busy ? "Building the tree… this can take a minute or two" : "Generate the decision tree"}
        </Button>
        <Button disabled={!title.trim() || busy} onClick={() => void submit(false)}>
          Save as draft
        </Button>
        {!ready && <span className="text-[13px] text-muted">Needs an AI key in Settings.</span>}
      </div>
    </div>
  );
}

/* ---------- A dossier ---------- */

function Block({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
        <span style={{ color: ACCENT }}>{icon}</span> {title}
      </div>
      {children}
    </Card>
  );
}

function DossierView({ dossier: d, onBack, onEdit }: { dossier: Dossier; onBack: () => void; onEdit: () => void }) {
  const { patch, remove } = useDecisions();
  const ready = useAiReady();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = d.analysis;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await patch(d.id, { analysis: await analyzeDossier(d, useDecisions.getState().dossiers) });
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2">
        <IconButton label="All problems" onClick={onBack} className="-ml-2 mt-1">
          <ChevronLeft className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{TERRAINS[d.terrain]}</div>
          <div className="font-serif text-[30px] leading-tight">{d.title}</div>
        </div>
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <IconButton
          label="Delete"
          className="hover:text-neg"
          onClick={async () => {
            if (!(await ask({ title: "Delete this problem?", body: "Its analysis, decision and outcome are deleted for good.", confirmLabel: "Delete", danger: true }))) return;
            await remove(d.id);
            onBack();
          }}
        >
          <Trash2 className="size-[18px]" />
        </IconButton>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-neg/10 px-4 py-3 text-[14px] text-neg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {!a ? (
        <Card>
          <EmptyState
            icon={<GitBranch className="size-5" />}
            title="No tree yet"
            body={ready ? "Generate the decision tree when the problem is laid out." : "Add an AI key in Settings to generate the tree."}
            action={
              <Button variant="primary" onClick={() => void generate()} disabled={busy || !ready}>
                <GitBranch className={cn("size-4", busy && "animate-pulse")} /> {busy ? "Building the tree…" : "Generate the decision tree"}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="p-6">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: ACCENT }}>
              The real question
            </div>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{a.brief}</p>
            <div className="mt-4 rounded-2xl bg-sunken/60 p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Recommendation · {a.recommendation.confidence}% confident</div>
              <div className="mt-1 font-serif text-xl">{a.recommendation.branch}</div>
              <p className="mt-1 text-[14px] leading-relaxed text-muted">{a.recommendation.why}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-faint">
              By {a.writer} · {formatDistanceToNowStrict(a.generatedAt, { addSuffix: true })}
              <Button size="sm" variant="ghost" onClick={() => void generate()} disabled={busy || !ready}>
                <RotateCw className={cn("size-3.5", busy && "animate-spin")} /> {busy ? "Building…" : "Generate again"}
              </Button>
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            {a.branches.map((b) => {
              const chosen = d.decision?.branch === b.name;
              return (
                <div key={b.name} className={cn("flex flex-col gap-3 rounded-3xl border bg-surface p-5 shadow-card", chosen ? "border-2" : "border-line")} style={chosen ? { borderColor: ACCENT } : undefined}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-serif text-xl leading-snug">{b.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {b.statusQuo && <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-muted">Status quo</span>}
                        {b.unseen && (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: ACCENT }}>
                            You hadn't listed it
                          </span>
                        )}
                        {chosen && <span className="rounded-full bg-cal px-2 py-0.5 text-[11px] font-medium text-white">Your decision</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-serif text-3xl leading-none tabular">{b.probability}%</div>
                      <div className="text-[11px] text-faint">chance of success</div>
                    </div>
                  </div>
                  <p className="text-[14px] leading-relaxed text-muted">{b.description}</p>
                  <div className="text-[12.5px] text-muted">
                    <span className="font-medium text-ink">Success means: </span>
                    {b.success}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["1 year", b.y1],
                        ["5 years", b.y5],
                        ["10 years", b.y10],
                      ] as const
                    ).map(([h, text]) => (
                      <div key={h} className="rounded-2xl bg-sunken/60 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{h}</div>
                        <div className="mt-1 text-[13px] leading-relaxed">{text}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full" style={{ width: `${b.reversibility}%`, background: ACCENT }} />
                    </div>
                    <span className="text-[12px] tabular text-muted">{b.reversibility}/100 reversible</span>
                  </div>
                  {b.stopCriteria.length > 0 && (
                    <div className="text-[12.5px]">
                      <div className="font-medium">Stop if…</div>
                      <ul className="mt-1 list-disc pl-5 text-muted">
                        {b.stopCriteria.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Block icon={<Swords className="size-4" />} title="Red team">
              <ul className="flex flex-col gap-3">
                {a.redTeam.map((r, i) => (
                  <li key={i}>
                    <div className="text-[13px] font-medium">{r.adversary}</div>
                    <p className="text-[13.5px] leading-relaxed text-muted">{r.attack}</p>
                  </li>
                ))}
              </ul>
            </Block>
            <Block icon={<Shield className="size-4" />} title="Blind spots">
              <ul className="flex flex-col gap-3">
                {a.biases.map((b, i) => (
                  <li key={i}>
                    <div className="text-[13px] font-medium">{b.name}</div>
                    <p className="text-[13.5px] leading-relaxed text-muted">{b.evidence}</p>
                    <p className="text-[13px] leading-relaxed">
                      <span className="font-medium">Correction: </span>
                      {b.correction}
                    </p>
                  </li>
                ))}
              </ul>
            </Block>
          </div>

          <DecisionPanel dossier={d} />
        </>
      )}
    </div>
  );
}

/** Recording what you decide, and later what happened. */
function DecisionPanel({ dossier: d }: { dossier: Dossier }) {
  const { patch } = useDecisions();
  const branches = d.analysis!.branches;
  const [branch, setBranch] = useState(d.decision?.branch ?? d.analysis!.recommendation.branch ?? branches[0]?.name ?? "");
  const [confidence, setConfidence] = useState(d.decision?.confidence ?? 60);
  const [note, setNote] = useState(d.decision?.note ?? "");
  const [verdict, setVerdict] = useState<Verdict>(d.outcome?.verdict ?? "matched");
  const [outcome, setOutcome] = useState(d.outcome?.note ?? "");
  const [editing, setEditing] = useState(!d.decision);

  if (!d.decision || editing)
    return (
      <Block icon={<Check className="size-4" />} title="Record your decision">
        <Field label="The branch you choose">
          {(id) => (
            <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="mt-3">
          <Field label={`How confident you are: ${confidence}%`}>
            {(id) => <input id={id} type="range" min={0} max={100} step={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="w-full" style={{ accentColor: ACCENT }} />}
          </Field>
        </div>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this one — a sentence or two for your future self" className="mt-3 min-h-20" />
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            disabled={!branch}
            onClick={async () => {
              await patch(d.id, { decision: { branch, confidence, note: note.trim(), decidedAt: d.decision?.decidedAt ?? Date.now() } });
              setEditing(false);
            }}
          >
            Record the decision
          </Button>
          {d.decision && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </Block>
    );

  return (
    <Block icon={<Check className="size-4" />} title="Your decision">
      <div className="font-serif text-xl">{d.decision.branch}</div>
      <div className="mt-1 text-[13px] text-muted">
        {format(d.decision.decidedAt, "MMM d, yyyy")} · {d.decision.confidence}% confident
      </div>
      {d.decision.note && <p className="mt-2 text-[14px] leading-relaxed">{d.decision.note}</p>}
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEditing(true)}>
        Change
      </Button>
      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
        <div>
          <div className="text-[13px] font-semibold">What actually happened?</div>
          <p className="text-[12.5px] text-muted">Recording the real outcome is what sharpens the next analyses.</p>
        </div>
        <Segmented<Verdict> layoutId={`verdict-${d.id}`} value={verdict} onChange={setVerdict} options={(Object.keys(VERDICTS) as Verdict[]).map((v) => ({ value: v, label: VERDICTS[v].label }))} />
        <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What happened, and what you'd do differently…" className="min-h-20" />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => void patch(d.id, { outcome: { verdict, note: outcome.trim(), at: Date.now() } })}>
            {d.outcome ? "Update the outcome" : "Record the outcome"}
          </Button>
          {d.outcome && <span className="text-[12px] text-faint">Recorded {formatDistanceToNowStrict(d.outcome.at, { addSuffix: true })}</span>}
        </div>
      </div>
    </Block>
  );
}
