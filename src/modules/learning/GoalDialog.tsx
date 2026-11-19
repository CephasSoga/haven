import { useEffect, useState } from "react";
import { Button, ColorPicker, Field, Input, Modal, Segmented, Select, Switch, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { LEVELS, setSessions, useLearning, type Goal, type Level } from "./store";
import { ACCENT } from "./parts";

const HOURS = [1, 2, 3, 4, 5, 6, 8, 10, 15];
const LENGTHS = [20, 30, 45, 60, 90, 120];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Days of the week starting Monday or Sunday, as the calendar does. */
export const weekDays = () => (useSettings.getState().weekStartsOn === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0]);

export function DayPicker({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex gap-1.5">
      {weekDays().map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={DAY_NAMES[d]}
            title={DAY_NAMES[d]}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d])}
            className={cn("size-9 rounded-full border text-[13px] font-medium transition-colors", on ? "border-transparent text-white" : "border-line text-muted hover:border-line-strong")}
            style={on ? { background: ACCENT } : undefined}
          >
            {DAY_LETTERS[d]}
          </button>
        );
      })}
    </div>
  );
}

/** New goal, or changes to one. */
export function GoalDialog({ open, onClose, goal, onCreated }: { open: boolean; onClose: () => void; goal?: Goal; onCreated?: (id: string) => void }) {
  const { addGoal, updateGoal } = useLearning.getState();
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<Level>("beginner");
  const [target, setTarget] = useState("");
  const [hours, setHours] = useState(3);
  const [schedule, setSchedule] = useState<Goal["schedule"]>("personal");
  const [color, setColor] = useState("teal");
  const [remind, setRemind] = useState(true);
  const [days, setDays] = useState<number[]>([2, 4, 6]);
  const [time, setTime] = useState("18:30");
  const [length, setLength] = useState(45);

  useEffect(() => {
    if (!open) return;
    setTitle(goal?.title ?? "");
    setWhy(goal?.why ?? "");
    setTopic(goal?.topic ?? "");
    setLevel(goal?.level ?? "beginner");
    setTarget(goal?.targetDate ?? "");
    setHours(goal ? Math.max(1, Math.round(goal.weeklyMinutes / 60)) : 3);
    setSchedule(goal?.schedule ?? "personal");
    setColor(goal?.color ?? "teal");
    setRemind(goal ? !!goal.sessions : true);
    setDays(goal?.sessions?.days ?? [2, 4, 6]);
    setTime(goal?.sessions?.time ?? "18:30");
    setLength(goal?.sessions?.minutes ?? 45);
  }, [open, goal]);

  const save = () => {
    if (!title.trim()) return;
    const draft = { title: title.trim(), why: why.trim() || undefined, topic: topic.trim() || title.trim(), level, targetDate: target || undefined, weeklyMinutes: hours * 60, schedule, color };
    let id = goal?.id;
    if (goal) updateGoal(goal.id, draft);
    else id = addGoal(draft);
    const saved = useLearning.getState().goals.find((g) => g.id === id)!;
    // The study event follows the goal (its name, colour and end date).
    if (remind && days.length) setSessions(saved, { days, time, minutes: length });
    else if (saved.sessions) setSessions(saved, null);
    onClose();
    if (!goal && id) onCreated?.(id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={goal ? "Edit goal" : "New learning goal"}
      accent={ACCENT}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!title.trim()}>
            {goal ? "Save" : "Create goal"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="What do you want to learn?">
          {(id) => <Input id={id} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Understand linear algebra for machine learning" />}
        </Field>
        <Field label="Why, or what you'll be able to do (optional)">
          {(id) => <Textarea id={id} rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Follow the maths in ML papers; pass the exam in June" />}
        </Field>
        <Field label="Words to search for material">
          {(id) => <Input id={id} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={title || "e.g. linear algebra"} />}
        </Field>
        <div className="flex flex-wrap gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted">Where you are now</span>
            <Segmented<Level> layoutId="learn-level" value={level} onChange={setLevel} options={(Object.keys(LEVELS) as Level[]).map((l) => ({ value: l, label: <span className="whitespace-nowrap">{LEVELS[l]}</span> }))} />
          </div>
          <Field label="By (optional)">{(id) => <Input id={id} type="date" value={target} onChange={(e) => setTarget(e.target.value)} className="w-44" />}</Field>
        </div>
        <div className="flex flex-wrap gap-5">
          <Field label="Time each week">
            {(id) => (
              <Select id={id} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-36">
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h} hour{h > 1 ? "s" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted">Learning tasks go in</span>
            <Segmented<Goal["schedule"]>
              layoutId="learn-schedule"
              value={schedule}
              onChange={setSchedule}
              options={[
                { value: "personal", label: "Free time" },
                { value: "work", label: "Work hours" },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl bg-sunken p-4">
          <Switch checked={remind} onChange={setRemind} label="Study sessions with a reminder" />
          {remind && (
            <>
              <DayPicker value={days} onChange={setDays} />
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-muted">at</span>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-32" aria-label="Time" />
                <span className="text-muted">for</span>
                <Select value={length} onChange={(e) => setLength(Number(e.target.value))} className="h-9 w-28" aria-label="Length">
                  {LENGTHS.map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60}` : ""}`}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-[12px] text-muted">They go on your Calendar as a repeating event{target ? " until the date above" : ""}, so the usual event reminder comes before each one.</p>
            </>
          )}
        </div>

        <Field label="Colour">{() => <ColorPicker value={color} onChange={setColor} />}</Field>
      </div>
    </Modal>
  );
}
