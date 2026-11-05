import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Square } from "lucide-react";
import { elapsedFor, stopRecording, useRecording } from "./session";
import { clock, useMeetings } from "./store";

/**
 * While a meeting is being recorded and you're elsewhere in Haven, a small pill at the top says so,
 * takes you back to it, and stops it.
 */
export function RecordingPill() {
  const { meetingId, since, starting } = useRecording();
  const meeting = useMeetings((s) => s.meetings.find((m) => m.id === meetingId));
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [since]);

  const onItsPage = pathname === "/meetings" && new URLSearchParams(search).get("id") === meetingId;
  const show = !!meeting && (!!since || !!starting) && !onItsPage;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[55] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-raised py-1 pl-3 pr-1 shadow-float"
        >
          <button onClick={() => navigate(`/meetings?id=${meetingId}`)} className="flex min-w-0 items-center gap-2 py-1 pr-1 text-[13px]" title="Back to the meeting">
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-neg opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-neg" />
            </span>
            <span className="font-medium tabular">{since ? `Recording · ${clock(elapsedFor(meeting!))}` : "Starting…"}</span>
            <span className="truncate text-muted">{meeting!.title || meeting!.analysis?.title || "Untitled meeting"}</span>
          </button>
          <button
            onClick={() => stopRecording()}
            aria-label="Stop recording"
            title="Stop recording"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neg/10 text-neg transition-colors hover:bg-neg hover:text-white"
          >
            <Square className="size-3.5" fill="currentColor" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
