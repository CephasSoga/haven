import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui";
import { canUpdate, checkForUpdate, installUpdate, useUpdates } from "@/lib/updates";
import { onAndroid } from "@/lib/platform";

/** Checks for a new build shortly after launch and every few hours, and offers it when there is one. */
export function UpdateBanner() {
  const { phase, available, progress, dismissed } = useUpdates();

  useEffect(() => {
    if (!canUpdate) return;
    const first = setTimeout(() => void checkForUpdate({ quiet: true }), 8_000);
    const later = setInterval(() => void checkForUpdate({ quiet: true }), 6 * 60 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(later);
    };
  }, []);

  const show = !!available && (phase === "available" || phase === "downloading") && dismissed !== available.version;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed inset-x-3 bottom-24 z-[45] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-raised p-3 pl-4 shadow-float md:inset-x-auto md:bottom-6 md:right-6"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cal-soft text-cal">
            <Download className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">Haven {available.version} is ready</div>
            <div className="text-[12px] text-muted">
              {phase === "downloading"
                ? `Downloading… ${Math.round(progress * 100)}%`
                : onAndroid
                  ? "Download it, then open the file to install."
                  : "Installs in a minute; Haven restarts on its own."}
            </div>
          </div>
          {phase !== "downloading" && (
            <>
              <Button size="sm" variant="primary" onClick={() => void installUpdate()}>
                {onAndroid ? "Download" : "Update"}
              </Button>
              <button
                onClick={() => useUpdates.setState({ dismissed: available.version })}
                aria-label="Not now"
                className="rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
