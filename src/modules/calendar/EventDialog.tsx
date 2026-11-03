import { useEffect, useRef, useState } from "react";
import { addDays, addMonths, format } from "date-fns";
import { Repeat as RepeatIcon, Trash2 } from "lucide-react";
import { Button, ColorPicker, Field, Input, Modal, Select, Switch, Textarea } from "@/components/ui";
import { dayKey, parseDay } from "@/lib/dates";
import { cn, swatch } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { fromMinutes, REPEAT_LABELS, repeatSummary, toMinutes, useCalendar, weeklyDays, type EventDraft, type Repeat } from "./store";

export function EventDialog({ draft, onClose }: { draft: EventDraft | null; onClose: () => void }) {
  const save = useCalendar((s) => s.save);
  const remove = useCalendar((s) => s.remove);
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const [form, setForm] = useState<EventDraft | null>(draft);
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

  const patch = (p: Partial<EventDraft>) => setForm({ ...f, ...p });
  const allDay = !f.start;
  const repeating = !!f.repeat && f.repeat !== "none";
  const endsBeforeStart = repeating && !!f.until && f.until < f.date;
  const invalid = !f.title.trim() || (!!f.start && !!f.end && f.end <= f.start) || endsBeforeStart;
  // Monday-first or Sunday-first, as in Settings.
  const week = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
  const chosen = weeklyDays(f);

  const submit = () => {
    if (invalid) return;
    save({
      ...f,
      title: f.title.trim(),
      location: f.location?.trim() || undefined,
      notes: f.notes?.trim() || undefined,
      // Weekdays only mean something for weekly events, and an end date only for repeating ones.
      days: f.repeat === "weekly" ? chosen : undefined,
      until: repeating ? f.until : undefined,
    });
    onClose();
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={f.id ? "Edit event" : "New event"}
      accent={swatch(f.color).fg}
      footer={
        <>
          {f.id && (
            <Button
              variant="danger"
              onClick={() => {
                remove(f.id!);
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
          <Button variant="primary" onClick={submit} disabled={invalid}>
            {f.id ? "Save changes" : "Add event"}
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
          placeholder="What's happening?"
          className="w-full border-b border-line bg-transparent pb-2 text-xl font-medium tracking-tight placeholder:text-faint focus:border-cal focus:outline-none"
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label={repeating ? "Starts on" : "Date"} className="col-span-2 sm:col-span-1">
            {(id) => <Input id={id} type="date" value={f.date} onChange={(e) => e.target.value && patch({ date: e.target.value })} />}
          </Field>
          <div className="col-span-2 flex items-end pb-2.5 sm:col-span-1">
            <Switch
              label="All day"
              checked={allDay}
              onChange={(v) =>
                v ? patch({ start: undefined, end: undefined }) : patch({ start: "09:00", end: "10:00" })
              }
            />
          </div>
          {!allDay && (
            <>
              <Field label="Starts">
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    value={f.start}
                    onChange={(e) => {
                      const start = e.target.value;
                      if (!start) return;
                      // Keep the duration when the start moves.
                      const dur = f.start && f.end ? toMinutes(f.end) - toMinutes(f.start) : 60;
                      patch({ start, end: fromMinutes(toMinutes(start) + Math.max(dur, 15)) });
                    }}
                  />
                )}
              </Field>
              <Field label="Ends">
                {(id) => (
                  <Input id={id} type="time" value={f.end ?? ""} onChange={(e) => patch({ end: e.target.value || undefined })} />
                )}
              </Field>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Repeat">
            {(id) => (
              <Select id={id} value={f.repeat ?? "none"} onChange={(e) => patch({ repeat: e.target.value as Repeat })}>
                {Object.entries(REPEAT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {k === "weekly" ? "Every week, on certain days" : v}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {f.repeat === "weekly" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-muted">On</span>
              <div className="flex gap-1.5" role="group" aria-label="Days of the week">
                {week.map((d) => {
                  const on = chosen.includes(d);
                  const name = format(addDays(new Date(2026, 0, 4), d), "EEEE");
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={name}
                      title={name}
                      // At least one day has to stay chosen.
                      onClick={() => patch({ days: on ? (chosen.length > 1 ? chosen.filter((x) => x !== d) : chosen) : [...chosen, d] })}
                      className={cn(
                        "flex h-10 min-w-0 flex-1 items-center justify-center rounded-xl border text-[13px] font-medium transition-colors",
                        on ? "border-transparent text-white" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
                      )}
                      style={on ? { background: swatch(f.color).fg } : undefined}
                    >
                      {format(addDays(new Date(2026, 0, 4), d), "EEEEEE")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {repeating && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ends">
                {(id) => (
                  <Select
                    id={id}
                    value={f.until ? "date" : "never"}
                    onChange={(e) => patch({ until: e.target.value === "date" ? dayKey(addMonths(parseDay(f.date), 3)) : undefined })}
                  >
                    <option value="never">Never</option>
                    <option value="date">On a date</option>
                  </Select>
                )}
              </Field>
              {f.until && (
                <Field label="Last day">
                  {(id) => <Input id={id} type="date" min={f.date} value={f.until} onChange={(e) => e.target.value && patch({ until: e.target.value })} />}
                </Field>
              )}
            </div>
          )}

          {repeating && (
            <div className={cn("flex items-center gap-2 text-[13px]", endsBeforeStart ? "text-neg" : "text-muted")}>
              <RepeatIcon className="size-3.5 shrink-0" />
              {endsBeforeStart ? "The last day is before the first one." : repeatSummary({ ...f, days: chosen }, weekStartsOn, { withStart: true })}
            </div>
          )}
        </div>

        <Field label="Color">{() => <ColorPicker value={f.color} onChange={(color) => patch({ color })} />}</Field>

        <Field label="Location">
          {(id) => (
            <Input id={id} value={f.location ?? ""} onChange={(e) => patch({ location: e.target.value })} placeholder="Optional" />
          )}
        </Field>

        <Field label="Notes">
          {(id) => (
            <Textarea id={id} value={f.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} placeholder="Optional" />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
