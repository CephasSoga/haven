import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CloudOff, Info, X } from "lucide-react";
import { dismissNotice, showNotice, useNotices, type Notice } from "@/lib/notices";
import { syncNow, useSync } from "@/lib/sync";
import { cn } from "@/lib/utils";

const TONES: Record<Notice["tone"], { icon: typeof Info; tint: string }> = {
  error: { icon: AlertTriangle, tint: "bg-neg/10 text-neg" },
  warning: { icon: CloudOff, tint: "bg-note-soft text-note" },
  info: { icon: Info, tint: "bg-cal-soft text-cal" },
};

/** Tells you when syncing stops working — and quietly takes the notice away once it recovers. */
function useSyncNotices() {
  useEffect(
    () =>
      useSync.subscribe((s, prev) => {
        if (s.phase === prev.phase) return;
        if (s.phase === "error")
          showNotice({
            id: "sync",
            tone: "warning",
            title: "Sync isn't working right now",
            body: `Your changes are safe on this device and will be sent when it works again.${s.message ? ` (${s.message})` : ""}`,
            action: { label: "Try again", run: () => void syncNow() },
            sticky: true,
          });
        if (s.phase === "idle" && prev.phase === "error") dismissNotice("sync");
      }),
    [],
  );
}

export function Notices() {
  useSyncNotices();
  const notices = useNotices((s) => s.notices);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] mx-auto flex max-w-md flex-col gap-2 md:inset-x-auto md:right-6 md:top-6 md:w-[380px]"
    >
      <AnimatePresence initial={false}>
        {notices.map((n) => {
          const { icon: Icon, tint } = TONES[n.tone];
          return (
            <motion.div
              key={n.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              role={n.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-raised p-3 pl-3.5 shadow-float"
            >
              <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", tint)}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="text-[14px] font-medium leading-snug">{n.title}</div>
                {n.body && <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-muted">{n.body}</div>}
                {n.action && (
                  <button
                    onClick={() => {
                      n.action!.run();
                      dismissNotice(n.id);
                    }}
                    className="mt-1.5 text-[13px] font-medium text-cal hover:underline"
                  >
                    {n.action.label}
                  </button>
                )}
              </div>
              <button onClick={() => dismissNotice(n.id)} aria-label="Dismiss" className="rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink">
                <X className="size-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
