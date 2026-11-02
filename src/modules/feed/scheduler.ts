import { useEffect } from "react";
import { explain } from "@/lib/ai";
import { todayKey } from "@/lib/dates";
import { gather } from "./gather";
import { useFeed } from "./store";

let inFlight: Promise<void> | null = null;
export let progress = "";

/** Prepares today's edition now (or joins one already in progress). */
export function refreshFeed(onStep?: (s: string) => void) {
  inFlight ??= (async () => {
    const { interests, perInterest, setRun, saveEdition } = useFeed.getState();
    setRun(true);
    try {
      saveEdition(await gather(interests, perInterest, (s) => ((progress = s), onStep?.(s))));
      setRun(false);
    } catch (e) {
      setRun(false, explain(e));
    } finally {
      inFlight = null;
      progress = "";
    }
  })();
  return inFlight;
}

/**
 * Haven runs in your browser, so "every morning" means: the first time the app is open on or after
 * your chosen time, the edition is prepared once for the day.
 */
export function useMorningScheduler() {
  useEffect(() => {
    const check = () => {
      const { auto, interests, time, editions, running, error } = useFeed.getState();
      if (!auto || !interests.length || running || error) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (hhmm < time || editions.some((e) => e.date === todayKey())) return;
      refreshFeed();
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);
}
