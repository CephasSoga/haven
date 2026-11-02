import { useState } from "react";
import { Button, Field, Input, Modal, Segmented } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useCalendar, type WeekHours } from "./store";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BUFFERS = [0, 5, 10, 15, 30];

/** Working hours, personal hours and meeting buffers. Changes apply instantly — the plan reflows behind the dialog. */
export function HoursDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = useCalendar((s) => s.prefs);
  const setPrefs = useCalendar((s) => s.setPrefs);
  const weekStartsOn = useSettings((s) => s.weekStartsOn);
  const [which, setWhich] = useState<"work" | "personal">("work");
  const hours = prefs[which];
  const order = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);

  const setDay = (d: number, patch: Partial<WeekHours[number]>) =>
    setPrefs({ [which]: hours.map((h, i) => (i === d ? { ...h, ...patch } : h)) });

  return (
    <Modal open={open} onClose={onClose} title="Planning hours" accent="var(--cal)" footer={<><div className="flex-1" /><Button variant="primary" onClick={onClose}>Done</Button></>}>
      <div className="flex flex-col gap-6">
        <p className="text-[14px] text-muted">
          Tasks are only placed inside these hours. Pick <em>Work hours</em> or <em>Personal time</em> on each task.
        </p>
        <Segmented
          layoutId="hours-which"
          className="w-full"
          value={which}
          onChange={setWhich}
          options={[
            { value: "work", label: "Work hours" },
            { value: "personal", label: "Personal time" },
          ]}
        />
        <div className="flex flex-col gap-1.5">
          {order.map((d) => {
            const h = hours[d];
            return (
              <div key={d} className={cn("flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors", h.on ? "bg-sunken/60" : "")}>
                <button
                  type="button"
                  onClick={() => setDay(d, { on: !h.on })}
                  className={cn(
                    "w-24 shrink-0 rounded-lg py-1.5 text-left text-[14px] font-medium",
                    h.on ? "text-ink" : "text-faint line-through",
                  )}
                >
                  {DAY_NAMES[d]}
                </button>
                {h.on ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input type="time" value={h.start} onChange={(e) => e.target.value && setDay(d, { start: e.target.value })} className="h-9" />
                    <span className="text-faint">–</span>
                    <Input type="time" value={h.end} onChange={(e) => e.target.value && setDay(d, { end: e.target.value })} className="h-9" />
                  </div>
                ) : (
                  <span className="flex-1 text-[13px] text-faint">Off — tap the day to turn on</span>
                )}
              </div>
            );
          })}
        </div>
        <Field label="Breathing room around events">
          {() => (
            <div className="flex flex-wrap gap-1.5">
              {BUFFERS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setPrefs({ buffer: b })}
                  className={cn(
                    "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors",
                    prefs.buffer === b ? "border-transparent bg-primary text-on-primary" : "border-line text-muted hover:text-ink",
                  )}
                >
                  {b ? `${b} min` : "None"}
                </button>
              ))}
            </div>
          )}
        </Field>
      </div>
    </Modal>
  );
}
