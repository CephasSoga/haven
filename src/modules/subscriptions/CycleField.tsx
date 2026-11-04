import { Field, Input, Select } from "@/components/ui";
import { CYCLES, nearestCycle, UNITS, type Cycle, type Repeats, type Unit } from "./store";

/** "How often": the usual cycles, or every N days, weeks, months or years. Used by subscriptions and bills. */
export function CycleField({ label, value, onChange }: { label: string; value: Repeats; onChange: (r: Repeats) => void }) {
  const every = value.every;
  return (
    <div className="flex flex-col gap-2">
      <Field label={label}>
        {(id) => (
          <Select
            id={id}
            value={every ? "custom" : value.cycle}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") onChange({ cycle: "monthly", every: { n: 2, unit: "month" } });
              else onChange({ cycle: v as Cycle, every: undefined });
            }}
          >
            {(Object.keys(CYCLES) as Cycle[]).map((c) => (
              <option key={c} value={c}>
                {CYCLES[c].label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        )}
      </Field>
      {every && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={365}
            inputMode="numeric"
            aria-label="Every how many"
            value={every.n}
            onChange={(e) => {
              const n = Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1)));
              onChange({ cycle: nearestCycle(every.unit), every: { ...every, n } });
            }}
            className="h-10 w-16 shrink-0 px-3 tabular"
          />
          <Select
            aria-label="Days, weeks, months or years"
            value={every.unit}
            onChange={(e) => {
              const unit = e.target.value as Unit;
              onChange({ cycle: nearestCycle(unit), every: { ...every, unit } });
            }}
            className="h-10 min-w-0 flex-1"
          >
            {(Object.keys(UNITS) as Unit[]).map((u) => (
              <option key={u} value={u}>
                {every.n === 1 ? UNITS[u].one : UNITS[u].many}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
