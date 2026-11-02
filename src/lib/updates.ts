import { create } from "zustand";
import { APP_VERSION, inApp, onAndroid } from "@/lib/platform";

/** Where builds are published for the apps to find. */
export const RELEASES = "https://github.com/CephasSoga/haven/releases";
const VERSION_FILE = `${RELEASES}/latest/download/version.json`;

/** Written by the cloud build next to the installers. */
type VersionFile = { version: string; notes?: string; date?: string; exe?: string; apk?: string };

export type Available = { version: string; notes?: string; apk?: string };

type UpdateState = {
  phase: "idle" | "checking" | "current" | "available" | "downloading" | "error";
  available: Available | null;
  progress: number;
  message?: string;
  dismissed?: string;
};

export const useUpdates = create<UpdateState>()(() => ({ phase: "idle", available: null, progress: 0 }));

/** "0.2.14" > "0.2.9" */
export function isNewer(candidate: string, current: string) {
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** Updates only make sense in an installed app built by the cloud build. */
export const canUpdate = inApp && APP_VERSION !== "dev";

/** Looks for a newer build. Quietly does nothing in the browser or in a local build. */
export async function checkForUpdate({ quiet = false } = {}) {
  if (!canUpdate) return;
  if (!quiet) useUpdates.setState({ phase: "checking", message: undefined });
  try {
    if (onAndroid) {
      // Android can't replace itself: find the new .apk and let you install it.
      const { fetch } = await import("@tauri-apps/plugin-http");
      const res = await fetch(`${VERSION_FILE}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`The update server answered ${res.status}`);
      const v = (await res.json()) as VersionFile;
      if (v.version && isNewer(v.version, APP_VERSION)) useUpdates.setState({ phase: "available", available: { version: v.version, notes: v.notes, apk: v.apk } });
      else useUpdates.setState({ phase: "current", available: null });
    } else {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) useUpdates.setState({ phase: "available", available: { version: update.version, notes: update.body } });
      else useUpdates.setState({ phase: "current", available: null });
    }
  } catch (e) {
    useUpdates.setState(quiet ? { phase: "idle" } : { phase: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

/** Windows: download, install and restart. Android: open the new .apk so you can install it. */
export async function installUpdate() {
  const { available } = useUpdates.getState();
  if (!available) return;
  try {
    if (onAndroid) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(available.apk ?? RELEASES);
      return;
    }
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return useUpdates.setState({ phase: "current", available: null });
    useUpdates.setState({ phase: "downloading", progress: 0 });
    let total = 0;
    let got = 0;
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      if (e.event === "Progress") {
        got += e.data.chunkLength;
        if (total) useUpdates.setState({ progress: got / total });
      }
    });
    // Windows closes the app to run the installer; elsewhere, restart into the new version.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdates.setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
