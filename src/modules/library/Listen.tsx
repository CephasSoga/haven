import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { pauseReading, resumeReading, setReadingSpeed, skip, stopReading, switchVoice, useReadAloud } from "./readAloud";
import { LANGS, liveVoices, useVoicePrefs } from "./voices";
import { cn } from "@/lib/utils";

const SPEEDS = [0.8, 1, 1.2, 1.5];

/** The read-aloud controls, over the top of the page while the book is being read. */
export function ListenBar({ theme }: { theme: { bg: string; fg: string } }) {
  const { status, progress, voice, lang, error } = useReadAloud();
  const speed = useVoicePrefs((s) => s.speed);
  // The computer's voices arrive a moment after the page loads.
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const on = () => refresh((n) => n + 1);
    speechSynthesis.addEventListener("voiceschanged", on);
    return () => speechSynthesis.removeEventListener("voiceschanged", on);
  }, []);

  const voices = lang ? liveVoices(lang) : [];
  const busy = status === "loading" || status === "waiting";
  const label =
    status === "loading"
      ? progress > 0 && progress < 1
        ? `Getting the voice ready — ${Math.round(progress * 100)}% (one time only)`
        : "Getting the voice ready…"
      : status === "waiting"
        ? "Making the next sentence…"
        : status === "paused"
          ? "Paused"
          : status === "error"
            ? error
            : `Reading${lang ? ` · ${LANGS[lang]}` : ""}`;

  return (
    <AnimatePresence>
      {status !== "idle" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-2xl p-1 shadow-float sm:gap-1 sm:p-1.5"
          style={{ background: theme.fg, color: theme.bg }}
        >
          {status !== "error" && (
            <>
              <Btn label="Previous sentence" onClick={() => skip(-1)} disabled={status === "loading"}>
                <SkipBack className="size-4" />
              </Btn>
              <Btn label={status === "paused" ? "Resume" : "Pause"} onClick={() => (status === "paused" ? resumeReading() : pauseReading())} disabled={status === "loading"}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : status === "paused" ? <Play className="size-4" fill="currentColor" /> : <Pause className="size-4" fill="currentColor" />}
              </Btn>
              <Btn label="Next sentence" onClick={() => skip(1)} disabled={status === "loading"}>
                <SkipForward className="size-4" />
              </Btn>
              <button
                onClick={() => setReadingSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)}
                title="Reading speed"
                className="min-w-10 rounded-xl px-1.5 py-1.5 text-[12px] font-semibold tabular hover:opacity-75"
              >
                {speed}×
              </button>
              {voices.length > 1 && (
                <select
                  value={voice?.id ?? ""}
                  onChange={(e) => {
                    const v = voices.find((x) => x.id === e.target.value);
                    if (v) void switchVoice(v);
                  }}
                  aria-label="Voice"
                  className="max-w-36 rounded-xl bg-transparent px-1.5 py-1.5 text-[12px] font-medium outline-none hover:opacity-75"
                  style={{ color: theme.bg }}
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id} style={{ color: "initial" }}>
                      {v.label}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <span className={cn("max-w-64 truncate px-2 text-[12px] opacity-80", status !== "error" && status !== "loading" && "max-sm:hidden")} title={label ?? ""}>
            {label}
          </span>
          <Btn label="Stop reading" onClick={stopReading}>
            <X className="size-4" />
          </Btn>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Btn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className="flex size-8 items-center justify-center rounded-xl transition-opacity hover:opacity-75 disabled:opacity-40">
      {children}
    </button>
  );
}
