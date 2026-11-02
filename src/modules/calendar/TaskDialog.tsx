import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarClock, Check, Flag, Lock, RotateCcw, Trash2, X } from "lucide-react";
import { Button, Field, Input, Modal, Segmented, Select, Switch, Textarea } from "@/components/ui";
import { cn, swatch } from "@/lib/utils";
import { formatDuration, PRIORITIES, REPEAT_LABELS, TASK_TYPES, timeRange, useCalendar, type Priority, type Repeat, type TaskDraft } from "./store";
import { dayLabel, slotsUntilNow, usePlan } from "./plan";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const CHUNKS = [15, 30, 45, 60, 90];

export function newTaskDraft(p: Partial<TaskDraft> = {}): TaskDraft {
  return { title: "", duration: 30, priority: "medium", type: "deep", schedule: "work", ...p };
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

export function TaskDialog({ draft, onClose }: { draft: TaskDraft | null; onClose: () => void }) {
  const { saveTask, removeTask, completeTask, reopenTask, lockTask } = useCalendar();
  const plan = usePlan();
  const [form, setForm] = useState<TaskDraft | null>(draft);
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
  const typeColor = swatch(TASK_TYPES[f.type]?.color ?? "slate").fg;

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
              info.status === "late" || info.status === "unscheduled" ? "bg-neg/10 text-neg" : "bg-sunken text-muted",
            )}
          >
            {info.status === "late" || info.status === "unscheduled" ? (
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
                <div>No free time fits this task in the next {useCalendar.getState().prefs.horizon} days.</div>
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
          {() => (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(TASK_TYPES).map(([id, t]) => (
                <Chip key={id} active={f.type === id} onClick={() => patch({ type: id })} color={swatch(t.color).fg}>
                  <span className="size-2 rounded-full" style={{ background: f.type === id ? "#fff" : swatch(t.color).fg }} />
                  {t.label}
                </Chip>
              ))}
            </div>
          )}
        </Field>

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
            {(id) => <Input id={id} type="date" value={f.deadline ?? ""} onChange={(e) => patch({ deadline: e.target.value || undefined })} />}
          </Field>
          <Field label="Start no earlier than">
            {(id) => <Input id={id} type="date" value={f.startDate ?? ""} onChange={(e) => patch({ startDate: e.target.value || undefined })} />}
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
