import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, ColorPicker, Field, Input, Modal, Switch, Textarea } from "@/components/ui";
import { swatch } from "@/lib/utils";
import { fromMinutes, toMinutes, useCalendar, type EventDraft } from "./store";

export function EventDialog({ draft, onClose }: { draft: EventDraft | null; onClose: () => void }) {
  const save = useCalendar((s) => s.save);
  const remove = useCalendar((s) => s.remove);
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
  const invalid = !f.title.trim() || (!!f.start && !!f.end && f.end <= f.start);

  const submit = () => {
    if (invalid) return;
    save({
      ...f,
      title: f.title.trim(),
      location: f.location?.trim() || undefined,
      notes: f.notes?.trim() || undefined,
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
          <Field label="Date" className="col-span-2 sm:col-span-1">
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
