import { useEffect } from "react";
import { inApp, onAndroid } from "@/lib/platform";
import { useSettings } from "@/store/settings";

/** The Windows app (not the phone app, not a browser): tray, background, starting with the computer. */
export const onDesktopApp = inApp && !onAndroid;

const autostart = () => import("@tauri-apps/plugin-autostart");

export async function startsWithComputer(): Promise<boolean> {
  if (!onDesktopApp) return false;
  return (await autostart()).isEnabled().catch(() => false);
}

export async function setStartsWithComputer(on: boolean) {
  const a = await autostart();
  if (on) await a.enable();
  else await a.disable();
  return a.isEnabled();
}

/** Tells the window what closing it should do: hide to the tray (default) or quit. */
export function useBackgroundMode() {
  const on = useSettings((s) => s.runInBackground !== false);
  useEffect(() => {
    if (!onDesktopApp) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_run_in_background", { on })).catch(() => {});
  }, [on]);
}
