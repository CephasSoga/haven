/** True inside the installed apps (Windows .exe / Android .apk), false in a regular browser. */
export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Android phone or tablet (installed app or browser). */
export const onAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * What actually went wrong with a request, as a short " (…)" to add to a message. "Couldn't reach X"
 * alone once hid a broken connection layer behind what looked like being offline.
 */
export function because(e: unknown) {
  const m = (e instanceof Error ? e.message : typeof e === "string" ? e : "").trim();
  return m ? ` (${m.length > 160 ? `${m.slice(0, 159)}…` : m})` : "";
}

/** This build's version, stamped by the cloud build ("dev" when running locally). */
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || "dev";
