import { useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { AiStopped, explain, useAssistant } from "@/lib/ai";
import { formatDuration } from "@/modules/calendar/store";
import { draftProject, type Draft } from "./draft";
import { createProject } from "./logic";
import { ACCENT } from "./ProjectDialog";

/** Describe a project, or paste a plan: the AI drafts stages and tasks, you review, then it's created. */
export function DraftDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const assistant = useAssistant();
  const [text, setText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const stop = useRef<AbortController | null>(null);

  const close = () => {
    stop.current?.abort();
    setBusy(null);
    setDraft(null);
    setError(null);
    onClose();
  };

  const run = async () => {
    setError(null);
    setBusy("Reading it");
    stop.current = new AbortController();
    try {
      setDraft(await draftProject(text, { deadline: deadline || undefined, onStep: setBusy, signal: stop.current.signal }));
    } catch (e) {
      if (!(e instanceof AiStopped)) setError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  const create = () => {
    if (!draft) return;
    const { id } = createProject({ name: draft.name, description: draft.description || undefined, deadline: deadline || undefined, stages: draft.stages.map((name) => ({ name })) }, draft.tasks);
    setText("");
    setDeadline("");
    close();
    onCreated(id);
  };

  const removeTask = (i: number) =>
    setDraft((d) =>
      d && {
        ...d,
        // Later tasks' "after" indexes shift down by one.
        tasks: d.tasks
          .filter((_, j) => j !== i)
          .map((t) => ({ ...t, after: (t.after ?? []).filter((a) => a !== i).map((a) => (a > i ? a - 1 : a)) })),
      },
    );

  const total = draft?.tasks.reduce((n, t) => n + t.duration, 0) ?? 0;

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      accent={ACCENT}
      title={draft ? draft.name || "New project" : "Draft a project with AI"}
      footer={
        draft ? (
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Back
            </Button>
            <Button variant="primary" onClick={create} disabled={!draft.tasks.length}>
              Create project
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void run()} disabled={!text.trim() || !!busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Draft it
            </Button>
          </>
        )
      }
    >
      {!draft ? (
        <div className="flex flex-col gap-4">
          <Field label="What's the project? Describe it, or paste a plan you already have">
            {(id) => (
              <Textarea
                id={id}
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Apply for a funded PhD for 2028: find labs, write a research proposal, get recommendation letters, apply to 5 programmes, prepare interviews."
              />
            )}
          </Field>
          <Field label="Deadline (optional)">{(id) => <Input id={id} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-44" />}</Field>
          {busy && (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="size-4 animate-spin" /> {assistant}: {busy}…
            </p>
          )}
          {error && <p className="text-[13px] text-neg">{error}</p>}
          <p className="text-[12px] text-faint">You'll see the stages and tasks before anything is created.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Project name" className="font-medium" />
          {draft.description && <p className="text-[14px] text-muted">{draft.description}</p>}
          <p className="text-[13px] text-muted">
            {draft.stages.length ? `${draft.stages.length} stages · ` : ""}
            {draft.tasks.length} tasks · {formatDuration(total)} of work
          </p>
          {(draft.stages.length ? draft.stages.map((s, i) => ({ name: `${i + 1}. ${s}`, i })) : [{ name: "", i: -1 }]).concat(draft.stages.length && draft.tasks.some((t) => t.stage === undefined) ? [{ name: "No stage", i: -2 }] : []).map((g) => {
            const items = draft.tasks.map((t, i) => ({ t, i })).filter(({ t }) => (g.i === -1 ? true : g.i === -2 ? t.stage === undefined : t.stage === g.i));
            if (!items.length) return null;
            return (
              <section key={g.i} className="flex flex-col gap-1">
                {g.name && <h3 className="text-[13px] font-semibold">{g.name}</h3>}
                <ul className="flex flex-col">
                  {items.map(({ t, i }) => (
                    <li key={i} className="group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-sunken">
                      <span className="w-6 text-right text-[11px] text-faint">{i + 1}</span>
                      <input
                        value={t.title}
                        onChange={(e) => setDraft({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                        className="min-w-0 flex-1 bg-transparent text-[14px] focus:outline-none"
                        aria-label="Task"
                      />
                      {t.after?.length ? <span className="shrink-0 text-[11px] text-faint">after {t.after.map((a) => a + 1).join(", ")}</span> : null}
                      <Select
                        value={t.duration}
                        onChange={(e) => setDraft({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? { ...x, duration: Number(e.target.value) } : x)) })}
                        className="h-8 w-24 shrink-0 text-[12px]"
                        aria-label="How long"
                      >
                        {[...new Set([15, 30, 45, 60, 90, 120, 180, 240, 360, 480, t.duration])].sort((a, b) => a - b).map((m) => (
                          <option key={m} value={m}>
                            {formatDuration(m)}
                          </option>
                        ))}
                      </Select>
                      <button onClick={() => removeTask(i)} aria-label="Leave this task out" className="rounded-md p-1 text-faint hover:text-neg">
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="text-[12px] text-faint">Once created, the planner fits the tasks into your free time{deadline ? " before the deadline" : ""}, in order.</p>
        </div>
      )}
    </Modal>
  );
}
