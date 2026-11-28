import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, ColorPicker, Field, Input, Modal, Select, Switch, Textarea } from "@/components/ui";
import { ask } from "@/components/confirm";
import { uid } from "@/lib/utils";
import { PRIORITIES, PROJECT_STATUSES, useCalendar, type Priority, type Project, type ProjectStatus, type Stage } from "@/modules/calendar/store";
import { fromTemplate } from "./logic";
import { DateField } from "@/components/pickers";

export const ACCENT = "#4f6bed";

/** New project (blank or from a template), or changes to one. */
export function ProjectDialog({ open, onClose, project, onCreated }: { open: boolean; onClose: () => void; project?: Project; onCreated?: (id: string) => void }) {
  const templates = useCalendar((s) => s.templates);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("blue");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [priority, setPriority] = useState<Priority>("medium");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [hard, setHard] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [sequential, setSequential] = useState(true);
  const [template, setTemplate] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setColor(project?.color ?? ["blue", "violet", "teal", "green", "amber", "orange", "rose", "pink"][useCalendar.getState().projects.length % 8]);
    setStatus(project?.status ?? "active");
    setPriority(project?.priority ?? "medium");
    setStartDate(project?.startDate ?? "");
    setDeadline(project?.deadline ?? "");
    setHard(!!project?.hardDeadline);
    setStages(project?.stages ?? []);
    setSequential(project?.sequential ?? true);
    setTemplate("");
  }, [open, project]);

  const tpl = templates.find((t) => t.id === template);

  const save = async () => {
    if (!name.trim()) return;
    const fields = {
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      priority,
      startDate: startDate || undefined,
      deadline: deadline || undefined,
      hardDeadline: !!deadline && hard,
    };
    if (project) {
      const gone = project.stages.filter((s) => !stages.some((x) => x.id === s.id));
      if (gone.length && useCalendar.getState().tasks.some((t) => t.projectId === project.id && gone.some((g) => g.id === t.stageId))) {
        if (!(await ask({ title: "Remove stages with tasks in them?", body: "Their tasks stay in the project, without a stage.", confirmLabel: "Remove" }))) return;
      }
      useCalendar.getState().saveProject({
        ...project,
        ...fields,
        status,
        doneAt: status === "done" ? (project.doneAt ?? Date.now()) : undefined,
        stages: stages.map((s) => ({ ...s, name: s.name.trim() || "Stage" })),
        sequential,
      });
      onClose();
      return;
    }
    const id = tpl
      ? fromTemplate(tpl, fields).id
      : useCalendar.getState().saveProject({ ...fields, status: "active", stages: stages.map((s) => ({ ...s, name: s.name.trim() || "Stage" })), sequential });
    onClose();
    onCreated?.(id);
  };

  const move = (i: number, by: -1 | 1) => {
    const next = [...stages];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setStages(next);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "New project"}
      accent={ACCENT}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>
            {project ? "Save" : "Create project"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {!project && templates.length > 0 && (
          <Field label="Start from">
            {(id) => (
              <Select
                id={id}
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t && !name.trim()) setName(t.name);
                }}
              >
                <option value="">A blank project</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    Template: {t.name} ({t.tasks.length} tasks)
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Name">{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Launch the website, Doctoral application" />}</Field>
        <Field label="What it's for (optional)">{(id) => <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start no earlier than">{(id) => <DateField id={id} clearable placeholder="Any time" value={startDate} onChange={setStartDate} />}</Field>
          <Field label="Deadline">{(id) => <DateField id={id} clearable placeholder="None" value={deadline} onChange={setDeadline} min={startDate || undefined} />}</Field>
        </div>
        {deadline && <Switch checked={hard} onChange={setHard} label="Hard deadline: its tasks go ahead of higher priorities if they'd be late" />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority of its tasks">
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {(Object.keys(PRIORITIES) as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITIES[p].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {project && (
            <Field label="Status">
              {(id) => (
                <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
                  {(Object.keys(PROJECT_STATUSES) as ProjectStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUSES[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {!tpl && (
          <div className="flex flex-col gap-3 rounded-2xl bg-sunken p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">Stages</span>
              <Button size="sm" variant="ghost" onClick={() => setStages([...stages, { id: uid(), name: "" }])}>
                <Plus className="size-3.5" /> Add stage
              </Button>
            </div>
            {!stages.length && <p className="text-[12px] text-muted">Optional: the steps the work goes through, in order (e.g. Research → Draft → Review).</p>}
            {stages.map((s, i) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-right text-[12px] text-faint">{i + 1}</span>
                <Input
                  value={s.name}
                  onChange={(e) => setStages(stages.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                  placeholder="Stage name"
                  className="h-9 min-w-0 flex-1 text-[13px]"
                  autoFocus={!s.name}
                />
                <DateField
                  value={s.deadline ?? ""}
                  onChange={(v) => setStages(stages.map((x) => (x.id === s.id ? { ...x, deadline: v || undefined } : x)))}
                  className="h-9 w-44"
                  compact
                  clearable
                  placeholder="No deadline"
                  aria-label={`${s.name || "Stage"} deadline`}
                  title="Stage deadline (optional)"
                />
                <div className="flex">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" className="rounded-md p-1.5 text-muted hover:text-ink disabled:opacity-30">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Move down" className="rounded-md p-1.5 text-muted hover:text-ink disabled:opacity-30">
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => setStages(stages.filter((x) => x.id !== s.id))} aria-label="Remove stage" className="rounded-md p-1.5 text-muted hover:text-neg">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {stages.length > 1 && <Switch checked={sequential} onChange={setSequential} label="One stage at a time: a stage starts once the one before is finished" />}
          </div>
        )}
        {tpl && (
          <p className="rounded-2xl bg-sunken p-4 text-[13px] text-muted">
            {tpl.stages.length ? `${tpl.stages.length} stages and ` : ""}
            {tpl.tasks.length} tasks come from the template, with their order and lengths. The planner fits them in{deadline ? " before the deadline" : ""}.
          </p>
        )}

        <Field label="Colour">{() => <ColorPicker value={color} onChange={setColor} />}</Field>
      </div>
    </Modal>
  );
}
