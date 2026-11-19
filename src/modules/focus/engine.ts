import { useEffect } from "react";
import { notify } from "@/lib/notify";
import { remainingMs, clock, useFocus } from "./store";
import { chime, playMix, stopMix, useFocusSound, usePreview } from "./sound";

/**
 * Runs for the whole app: ends a session when its time is up (bell + notification), ends the break
 * the same way, plays the background sound while focusing, and shows the time left in the window title.
 */
export function useFocusEngine() {
  const active = useFocus((s) => s.active);
  const breakUntil = useFocus((s) => s.breakUntil);
  const mix = useFocusSound((s) => s.mix);
  const volume = useFocusSound((s) => s.volume);
  const beat = useFocusSound((s) => s.beat);
  const preview = usePreview((s) => s.on);
  const running = !!active?.runningSince;

  // Time's up?
  useEffect(() => {
    if (!active && !breakUntil) return;
    const check = () => {
      const { active: a, breakUntil: b } = useFocus.getState();
      const now = Date.now();
      if (a) {
        const left = remainingMs(a, now);
        document.title = a.runningSince ? `${clock(left)} · Focus` : `Paused · Focus`;
        if (left <= 0 && a.runningSince) {
          useFocus.getState().finish();
          chime();
          const brk = !useFocus.getState().breakUntil ? "" : a.longBreak ? ` Time for a long break: ${a.breakMin} minutes.` : ` Take ${a.breakMin} minutes off.`;
          void notify("Focus session done", `${a.planned} minutes${a.intention ? ` on “${a.intention}”` : ""}.${brk}`);
        }
      } else if (b) {
        document.title = `Break ${clock(Math.max(0, b - now))} · Haven`;
        if (now >= b) {
          useFocus.getState().endBreak();
          chime();
          void notify("Break's over", "Ready for the next session?");
        }
      }
    };
    check();
    const t = setInterval(check, 1000);
    return () => {
      clearInterval(t);
      document.title = "Haven";
    };
  }, [!!active, !!breakUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  // Background sound only while the clock runs (or while you listen to it before starting).
  useEffect(() => {
    if (running || preview) playMix(mix, volume, beat);
    else stopMix();
  }, [running, preview, mix, volume, beat]);
  useEffect(() => () => stopMix(), []);
}
