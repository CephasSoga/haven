/** True inside the installed apps (Windows .exe / Android .apk), false in a regular browser. */
export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
