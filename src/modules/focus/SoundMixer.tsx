import { useEffect, useRef, useState } from "react";
import {
  AudioWaveform, Bell, Bird, Bug, Clock, CloudLightning, CloudRain, Droplets, FileAudio, Flame, Headphones,
  Music, Plane, Play, Plus, SlidersHorizontal, Square, Volume2, Waves, Wind, X, type LucideIcon,
} from "lucide-react";
import { Button, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { showNotice } from "@/lib/notices";
import {
  addOwnSound, BEATS, BELLS, chime, GROUP_LABELS, PRESETS, removeOwnSound, sameMix, SOUNDS, useFocusSound, usePreview,
  type Bell as BellKind, type SoundGroup, type SoundId,
} from "./sound";

const ACCENT = "#e0803a";

const ICONS: Record<SoundId, LucideIcon> = {
  rain: CloudRain, thunder: CloudLightning, waves: Waves, stream: Droplets, wind: Wind, fire: Flame, birds: Bird,
  crickets: Bug, drift: Music, binaural: Headphones, brown: AudioWaveform, pink: AudioWaveform, white: AudioWaveform,
  plane: Plane, clock: Clock,
};

/** Choosing what plays while you focus: ready-made mixes, or your own from any of the sounds. */
export function SoundMixer({ canPreview }: { canPreview?: boolean }) {
  const { mix, volume, set } = useFocusSound();
  const preview = usePreview((s) => s.on);
  const [open, setOpen] = useState(false);
  const on = Object.keys(mix).filter((k) => mix[k] > 0);
  const preset = PRESETS.find((p) => sameMix(p.mix, mix))?.id;

  // Listening stops when you leave the set-up screen (starting the session carries the sound on).
  useEffect(() => {
    if (canPreview) return () => usePreview.getState().set(false);
  }, [canPreview]);

  const chip = (active: boolean) =>
    cn("rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors", active ? "border-ink bg-ink text-canvas" : "border-line hover:border-line-strong");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">Sound</span>
        <div className="flex items-center gap-1">
          {canPreview && on.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => usePreview.getState().set(!preview)}>
              {preview ? <Square className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
              {preview ? "Stop" : "Listen"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            <SlidersHorizontal className="size-3.5" /> {open ? "Done" : "Mix your own"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={chip(!on.length)} onClick={() => set({ mix: {} })}>
          Silence
        </button>
        {PRESETS.map((p) => (
          <button key={p.id} className={chip(preset === p.id)} onClick={() => set({ mix: { ...p.mix } })}>
            {p.label}
          </button>
        ))}
        {on.length > 0 && !preset && (
          <button className={chip(true)} onClick={() => setOpen(true)}>
            Your mix
          </button>
        )}
      </div>

      {open && <Layers />}

      {on.length > 0 && (
        <div className="flex items-center gap-3">
          <Volume2 className="size-4 shrink-0 text-muted" />
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => set({ volume: Number(e.target.value) })}
            aria-label="Volume"
            className="w-full max-w-56 accent-[#e0803a]"
          />
        </div>
      )}
    </div>
  );
}

function Layers() {
  const { mix, beat, bell, own, set, setLayer } = useFocusSound();
  const file = useRef<HTMLInputElement>(null);
  const groups = (Object.keys(GROUP_LABELS) as SoundGroup[]).map((g) => ({ g, sounds: SOUNDS.filter((s) => s.group === g) }));

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-sunken p-4">
      {groups.map(({ g, sounds }) => (
        <div key={g} className="flex flex-col gap-2">
          <span className="text-[12px] font-medium uppercase tracking-wide text-faint">{GROUP_LABELS[g]}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sounds.map((s) => (
              <Tile key={s.id} id={s.id} label={s.label} hint={s.hint} icon={ICONS[s.id]} level={mix[s.id]} onLevel={(v) => setLayer(s.id, v)}>
                {s.id === "binaural" && mix.binaural > 0 && (
                  <Select value={beat} onChange={(e) => set({ beat: Number(e.target.value) as typeof beat })} className="mt-2 h-8 text-[12px]" aria-label="Beat">
                    {BEATS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Tile>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wide text-faint">Yours</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {own.map((o) => (
            <Tile
              key={o.id}
              id={`own:${o.id}`}
              label={o.name}
              icon={FileAudio}
              level={mix[`own:${o.id}`]}
              onLevel={(v) => setLayer(`own:${o.id}`, v)}
              onRemove={() => void removeOwnSound(o.id)}
            />
          ))}
          <button
            onClick={() => file.current?.click()}
            className="flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-left text-sm text-muted transition-colors hover:text-ink"
          >
            <Plus className="size-4" /> Add a sound file
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            addOwnSound(f).catch(() =>
              showNotice({ id: "focus-sound", tone: "error", title: "Couldn't keep that file", body: "There may not be enough room on this device." }),
            );
          }}
        />
        <p className="text-[12px] text-faint">Your files stay on this device and play on a loop.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Bell className="size-4 text-muted" />
        <span className="text-[13px] text-muted">When time's up</span>
        <Select
          value={bell}
          onChange={(e) => {
            const b = e.target.value as BellKind;
            set({ bell: b });
            chime(b);
          }}
          className="h-8 w-40 text-[13px]"
          aria-label="Sound when time's up"
        >
          {BELLS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
        {bell !== "none" && (
          <Button size="sm" variant="ghost" onClick={() => chime(bell)}>
            <Play className="size-3.5" fill="currentColor" /> Hear it
          </Button>
        )}
      </div>
    </div>
  );
}

function Tile({
  id,
  label,
  hint,
  icon: Icon,
  level,
  onLevel,
  onRemove,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  level?: number;
  onLevel: (v: number | null) => void;
  onRemove?: () => void;
  children?: React.ReactNode;
}) {
  const on = (level ?? 0) > 0;
  return (
    <div
      className={cn("group relative rounded-xl border px-3 py-2.5 transition-colors", on ? "bg-surface" : "border-transparent bg-surface/60 hover:bg-surface")}
      style={on ? { borderColor: `${ACCENT}66` } : undefined}
    >
      <button onClick={() => onLevel(on ? null : 0.5)} aria-pressed={on} className="flex w-full min-w-0 items-center gap-2 text-left text-sm font-medium" title={hint}>
        <Icon className="size-4 shrink-0" style={{ color: on ? ACCENT : "var(--muted)" }} />
        <span className="truncate">{label}</span>
      </button>
      {hint && on && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
      {on && (
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={level}
          onChange={(e) => onLevel(Number(e.target.value))}
          aria-label={`${label} volume`}
          className="mt-2 w-full accent-[#e0803a]"
          data-sound={id}
        />
      )}
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          title="Remove"
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-faint opacity-0 hover:text-neg group-hover:opacity-100 focus:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
