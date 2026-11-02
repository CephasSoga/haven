/** True inside the installed apps (Windows .exe / Android .apk), false in a regular browser. */
export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Android phone or tablet (installed app or browser). */
export const onAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** This build's version, stamped by the cloud build ("dev" when running locally). */
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || "dev";
