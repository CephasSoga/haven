import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarClock, Check, Flag, Lock, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { ask } from "@/components/confirm";
import { Button, ColorPicker, Field, Input, Modal, Segmented, Select, Switch, Textarea } from "@/components/ui";
import { cn, swatch } from "@/lib/utils";
import { addTaskType, formatDuration, PRIORITIES, REPEAT_LABELS, removeTaskType, TASK_TYPES, timeRange, useCalendar, useTaskTypes, type Priority, type Repeat, type TaskDraft } from "./store";
import { dayLabel, slotsUntilNow, usePlan } from "./plan";
import { DateField } from "@/components/pickers";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const CHUNKS = [15, 30, 45, 60, 90];

export function newTaskDraft(p: Partial<TaskDraft> = {}): TaskDraft {
  const draft: TaskDraft = { title: "", duration: 30, priority: "medium", type: "deep", schedule: "work", ...p };
  // Anything over two hours goes in sittings of an hour or more, unless told otherwise.
  if (draft.duration > 120 && !("chunk" in p)) draft.chunk = 60;
  return draft;
}

/** "Write report 2h !!" → title "Write report", 120 min, ASAP. One "!" is High. */
export function parseQuickTask(text: string): Partial<TaskDraft> {
  let title = text.trim();
  const out: Partial<TaskDraft> = {};
  const dur = title.match(/\s(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i);
  if (dur) {
    const n = Number(dur[1].replace(",", "."));
    out.duration = Math.max(5, Math.round(dur[2].toLowerCase().startsWith("h") ? n * 60 : n));
    title = title.replace(dur[0], "");
  }
  const bang = title.match(/\s(!{1,2})(?=\s|$)/);
  if (bang) {
    out.priority = bang[1].length === 2 ? "asap" : "high";
    title = title.replace(bang[0], "");
  }
  out.title = title.trim();
  return out;
}

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-all",
        active ? "border-transparent bg-primary text-on-primary shadow-soft" : "border-line text-muted hover:border-line-strong hover:text-ink",
      )}
      style={active && color ? { background: color, color: "#fff" } : undefined}
    >
      {children}
    </button>
  );
}

/** The types of work, plus making your own (and removing ones you made). */
function TypePicker({ value, types, onChange }: { value: string; types: Record<string, { label: string; color: string }>; onChange: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("teal");
  const add = () => {
    if (!name.trim()) return;
    onChange(addTaskType(name, color));
    setName("");
    setAdding(false);
  };
  const remove = async (id: string) => {
    const used = useCalendar.getState().tasks.filter((t) => t.type === id).length;
    const ok =
      !used ||
      (await ask({
        title: `Remove “${types[id].label}”?`,
        body: `${used} ${used === 1 ? "task uses" : "tasks use"} this type; ${used === 1 ? "it becomes" : "they become"} Admin.`,
        confirmLabel: "Remove",
        danger: true,
      }));
    if (!ok) return;
    removeTaskType(id);
    if (value === id) onChange("admin");
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(types).map(([id, t]) => (
          <span key={id} className="group/type relative">
            <Chip active={value === id} onClick={() => onChange(id)} color={swatch(t.color).fg}>
              <span className="size-2 rounded-full" style={{ background: value === id ? "#fff" : swatch(t.color).fg }} />
              {t.label}
            </Chip>
            {!(id in TASK_TYPES) && (
              <button
                type="button"
                onClick={() => void remove(id)}
                aria-label={`Remove the type ${t.label}`}
                title="Remove this type"
                // Shown on hover, and on the selected type for touch screens.
                className={cn(
                  "absolute -right-1.5 -top-1.5 size-5 items-center justify-center rounded-full border border-line bg-raised text-faint shadow-soft hover:text-neg group-hover/type:flex",
                  value === id ? "flex" : "hidden",
                )}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-8 items-center gap-1 rounded-full border border-dashed border-line-strong px-3 text-[13px] font-medium text-muted hover:text-ink"
          >
            <Plus className="size-3.5" /> New type
          </button>
        )}
      </div>
      {adding && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sunken/50 p-3">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setAdding(false);
                }
              }}
              placeholder="e.g. Coaching, Writing, Family"
              autoFocus
              className="h-9"
            />
            <Button size="sm" variant="primary" onClick={add} disabled={!name.trim()}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      )}
    </div>
  );
}

/** Which project it's part of, its stage, what it waits for, and whether it's begun. */
function ProjectFields({ f, patch }: { f: TaskDraft; patch: (p: Partial<TaskDraft>) => void }) {
  const projects = useCalendar((s) => s.projects);
  const tasks = useCalendar((s) => s.tasks);
  const project = projects.find((p) => p.id === f.projectId);
  const choices = projects.filter((p) => p.status === "active" || p.status === "paused" || p.id === f.projectId);
  // What it can wait for: open tasks of the same project (or any open task, outside a project).
  const candidates = tasks.filter((t) => !t.done && t.id !== f.id && (f.projectId ? t.projectId === f.projectId : true) && !f.blockedBy?.includes(t.id));
  const waits = (f.blockedBy ?? []).map((id) => tasks.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
  if (!choices.length && !waits.length && !candidates.length) return null;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line p-4">
      {choices.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project">
            {(id) => (
              <Select
                id={id}
                value={f.projectId ?? ""}
                onChange={(e) => {
                  const next = e.target.value || undefined;
                  // A new project: its own stages, and only its own tasks to wait for.
                  patch({ projectId: next, stageId: undefined, blockedBy: next ? f.blockedBy?.filter((b) => tasks.find((t) => t.id === b)?.projectId === next) : f.blockedBy });
                }}
              >
                <option value="">None</option>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {project && project.stages.length > 0 && (
            <Field label="Stage">
              {(id) => (
                <Select id={id} value={f.stageId ?? ""} onChange={(e) => patch({ stageId: e.target.value || undefined })}>
                  <option value="">No stage</option>
                  {project.stages.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      {i + 1}. {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-muted">Waits for</span>
        {waits.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {waits.map((t) => (
              <span key={t.id} className="flex items-center gap-1 rounded-full bg-sunken py-1 pl-3 pr-1.5 text-[13px]">
                {t.title}
                <button type="button" aria-label={`Doesn't wait for ${t.title}`} onClick={() => patch({ blockedBy: f.blockedBy!.filter((b) => b !== t.id) })} className="rounded-full p-0.5 text-faint hover:text-ink">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {candidates.length > 0 && (
          <Select value="" onChange={(e) => e.target.value && patch({ blockedBy: [...(f.blockedBy ?? []), e.target.value] })} aria-label="Add a task it waits for" className="h-9 text-[13px]">
            <option value="">{waits.length ? "And also…" : "Nothing — it can start any time. Pick a task…"}</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        )}
        {project?.sequential && f.stageId && project.stages.findIndex((s) => s.id === f.stageId) > 0 && (
          <p className="text-[12px] text-muted">It also waits for the earlier stages of {project.name} to be finished.</p>
        )}
      </div>
      {f.id && !f.done && <Switch label="In progress" checked={!!f.started} onChange={(started) => patch({ started })} />}
    </div>
  );
}

export function TaskDialog({ draft, onClose }: { draft: TaskDraft | null; onClose: () => void }) {
  const { saveTask, removeTask, completeTask, reopenTask, lockTask } = useCalendar();
  const plan = usePlan();
  const [form, setForm] = useState<TaskDraft | null>(draft);
  const types = useTaskTypes();
  const [prevDraft, setPrevDraft] = useState(draft);
  const titleRef = useRef<HTMLInputElement>(null);

  if (draft !== prevDraft) {
    setPrevDraft(draft);
    if (draft) setForm(draft);
  }

  useEffect(() => {
    if (draft && !draft.id) requestAnimationFrame(() => titleRef.current?.focus());
  }, [draft]);

  // `form` outlives `draft` so the dialog keeps its content during the exit animation.
  const f = form ?? draft;
  if (!f) return null;

  const patch = (p: Partial<TaskDraft>) => setForm({ ...f, ...p });
  const invalid = !f.title.trim() || f.duration < 5;
  const info = f.id ? plan.byTask.get(f.id) : undefined;
  const typeColor = swatch(types[f.type]?.color ?? "slate").fg;

  const submit = () => {
    if (invalid) return;
    saveTask({ ...f, title: f.title.trim(), notes: f.notes?.trim() || undefined });
    onClose();
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={f.id ? "Edit task" : "New task"}
      accent={typeColor}
      footer={
        <>
          {f.id && (
            <Button
              variant="danger"
              onClick={() => {
                removeTask(f.id!);
                onClose();
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          {f.id &&
            (f.done ? (
              <Button
                onClick={() => {
                  reopenTask(f.id!);
                  onClose();
                }}
              >
                <RotateCcw className="size-4" /> Reopen
              </Button>
            ) : (
              <Button
                onClick={() => {
                  completeTask(f.id!, slotsUntilNow(info?.slots ?? []));
                  onClose();
                }}
              >
                <Check className="size-4" /> Done
              </Button>
            ))}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={invalid}>
            {f.id ? "Save" : "Add task"}
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
        <input
          ref={titleRef}
          value={f.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="What needs doing?"
          className="w-full border-b border-line bg-transparent pb-2 text-xl font-medium tracking-tight placeholder:text-faint focus:border-cal focus:outline-none"
        />

        {/* Where the planner put it */}
        {f.id && info && !f.done && (
          <div
            className={cn(
              "flex items-start gap-3 rounded-2xl px-4 py-3 text-[13px]",
              info.status === "late" || info.status === "unscheduled" || info.status === "blocked" ? "bg-neg/10 text-neg" : "bg-sunken text-muted",
            )}
          >
            {info.status === "late" || info.status === "unscheduled" || info.status === "blocked" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            ) : f.locked ? (
              <Lock className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-cal" />
            )}
            <div className="flex-1">
              {info.slots.length ? (
                <div className="text-ink">
                  {info.slots.slice(0, 3).map((s) => (
                    <div key={s.date + s.start}>
                      {dayLabel(s.date)} · <span className="tabular">{timeRange(s)}</span>
                    </div>
                  ))}
                  {info.slots.length > 3 && <div className="text-muted">+{info.slots.length - 3} more sessions</div>}
                </div>
              ) : (
                <div>
                  {info.status === "paused"
                    ? "Its project is on hold, so it isn't planned for now."
                    : info.status === "blocked"
                      ? "It waits for a task that can't be planned yet (on hold, or no free time for it)."
                      : `No free time fits this task in the next ${plan.horizon} days.`}
                </div>
              )}
              {info.status === "late" && <div className="mt-1 font-medium">Won't be done by the deadline at this rate.</div>}
              {info.status === "tight" && <div className="mt-1">Finishes on its deadline day — cutting it close.</div>}
            </div>
            {f.locked && (
              <button
                type="button"
                onClick={() => {
                  lockTask(f.id!, undefined);
                  patch({ locked: undefined });
                }}
                className="flex items-center gap-1 font-medium text-cal hover:underline"
              >
                <X className="size-3.5" /> Unpin
              </button>
            )}
          </div>
        )}

        <Field label="How long will it take?">
          {() => (
            <div className="flex flex-wrap items-center gap-1.5">
              {DURATIONS.map((d) => (
                <Chip key={d} active={f.duration === d} onClick={() => patch({ duration: d })}>
                  {formatDuration(d)}
                </Chip>
              ))}
              <div className="relative">
                <Input
                  type="number"
                  min={5}
                  step={5}
                  value={DURATIONS.includes(f.duration) ? "" : f.duration}
                  onChange={(e) => patch({ duration: Number(e.target.value) || 0 })}
                  placeholder="Custom"
                  className="h-8 w-24 rounded-full pr-9 text-[13px]"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">min</span>
              </div>
            </div>
          )}
        </Field>

        <Field label="Priority">
          {() => (
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PRIORITIES) as Priority[]).map((p) => (
                <Chip key={p} active={f.priority === p} onClick={() => patch({ priority: p })} color={PRIORITIES[p].color}>
                  <Flag className="size-3.5" style={f.priority === p ? undefined : { color: PRIORITIES[p].color }} />
                  {PRIORITIES[p].label}
                </Chip>
              ))}
            </div>
          )}
        </Field>

        <Field label="Type of work">
          {() => <TypePicker value={f.type} types={types} onChange={(type) => patch({ type })} />}
        </Field>

        <ProjectFields f={f} patch={patch} />

        <Field label="When can it happen?">
          {() => (
            <Segmented
              layoutId="task-schedule"
              className="w-full"
              value={f.schedule}
              onChange={(schedule) => patch({ schedule })}
              options={[
                { value: "work", label: "Work hours" },
                { value: "personal", label: "Personal time" },
              ]}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Deadline">
            {(id) => <DateField id={id} clearable placeholder="None" value={f.deadline ?? ""} onChange={(v) => patch({ deadline: v || undefined })} />}
          </Field>
          <Field label="Start no earlier than">
            {(id) => <DateField id={id} clearable placeholder="Any time" value={f.startDate ?? ""} onChange={(v) => patch({ startDate: v || undefined })} />}
          </Field>
        </div>
        {f.deadline && (
          <div className="-mt-2">
            <Switch label="Hard deadline — must be done by then, even over higher priorities" checked={!!f.hardDeadline} onChange={(hardDeadline) => patch({ hardDeadline })} />
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <Switch label="Split into sessions" checked={!!f.chunk} onChange={(on) => patch({ chunk: on ? 30 : undefined })} />
          {f.chunk ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
              Shortest session
              {CHUNKS.filter((c) => c < f.duration).map((c) => (
                <Chip key={c} active={f.chunk === c} onClick={() => patch({ chunk: c })}>
                  {formatDuration(c)}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">Off: the planner finds one uninterrupted block of {formatDuration(f.duration)}.</p>
          )}
        </div>

        <Field label="Repeat">
          {(id) => (
            <Select id={id} value={f.repeat ?? "none"} onChange={(e) => patch({ repeat: e.target.value as Repeat })}>
              {Object.entries(REPEAT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Notes">
          {(id) => <Textarea id={id} value={f.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} placeholder="Optional" />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
