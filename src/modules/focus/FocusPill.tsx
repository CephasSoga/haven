import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { useRecording } from "@/modules/meetings/session";
import { clock, remainingMs, useFocus } from "./store";

/** Away from the Focus page, a small pill shows the time left (or the break) and pauses or resumes it. */
export function FocusPill() {
  const active = useFocus((s) => s.active);
  const breakUntil = useFocus((s) => s.breakUntil);
  const { pathname } = useLocation();
  // The recording pill hides on the Meetings page, so only make room for it elsewhere.
  const recording = useRecording((s) => !!s.since || !!s.starting) && !pathname.startsWith("/meetings");
  const navigate = useNavigate();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active && !breakUntil) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active, breakUntil]);

  const show = (!!active || !!breakUntil) && pathname !== "/focus";
  const paused = !!active && !active.runningSince;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          // Sits under the recording pill when both are showing.
          style={{ top: recording ? "calc(max(0.75rem, env(safe-area-inset-top)) + 3.25rem)" : "max(0.75rem, env(safe-area-inset-top))" }}
          className="fixed left-1/2 z-[55] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-raised py-1 pl-3 pr-1 shadow-float"
        >
          <button onClick={() => navigate("/focus")} className="flex min-w-0 items-center gap-2 py-1 pr-1 text-[13px]" title="Open Focus">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: active ? "#e0803a" : "var(--pos)", opacity: paused ? 0.4 : 1 }} />
            <span className="font-medium tabular">
              {active ? (paused ? `Paused · ${clock(remainingMs(active))}` : `Focus · ${clock(remainingMs(active))}`) : `Break · ${clock(Math.max(0, breakUntil! - Date.now()))}`}
            </span>
            {active?.intention && <span className="truncate text-muted">{active.intention}</span>}
          </button>
          {active && (
            <button
              onClick={() => (paused ? useFocus.getState().resume() : useFocus.getState().pause())}
              aria-label={paused ? "Resume" : "Pause"}
              title={paused ? "Resume" : "Pause"}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-ink transition-colors hover:bg-line"
            >
              {paused ? <Play className="size-3.5" fill="currentColor" /> : <Pause className="size-3.5" fill="currentColor" />}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
