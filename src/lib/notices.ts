import { create } from "zustand";

/**
 * Small notices for things that happen out of sight — a sync that stopped, a book that couldn't be
 * uploaded, a full disk. Problems right next to what you're doing are still shown in place.
 */

export type Notice = {
  id: string;
  tone: "error" | "warning" | "info";
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
  /** Errors stay until dismissed; the others fade after a while */
  sticky?: boolean;
};

type NoticesState = { notices: Notice[] };
export const useNotices = create<NoticesState>()(() => ({ notices: [] }));

const timers = new Map<string, number>();

/**
 * Shows a notice. A notice with the same `id` replaces the earlier one instead of stacking,
 * so a problem that keeps happening is shown once.
 */
export function showNotice(n: Omit<Notice, "id"> & { id?: string }) {
  const notice: Notice = { ...n, id: n.id ?? crypto.randomUUID(), sticky: n.sticky ?? n.tone === "error" };
  useNotices.setState((s) => ({ notices: [...s.notices.filter((x) => x.id !== notice.id), notice].slice(-4) }));
  clearTimeout(timers.get(notice.id));
  if (!notice.sticky) timers.set(notice.id, window.setTimeout(() => dismissNotice(notice.id), 8_000));
  return notice.id;
}

export function dismissNotice(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  useNotices.setState((s) => ({ notices: s.notices.filter((x) => x.id !== id) }));
}

export const isStorageFull = (e: unknown) =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");

export const STORAGE_FULL = {
  id: "storage-full",
  tone: "error" as const,
  title: "This device's storage for Haven is full",
  body: "Your latest changes may not be saved. Free up space — for example, delete books you no longer need from the Library — then try again.",
};

/** Errors nothing else caught: explain the ones we understand, and mention the rest rather than failing silently. */
export function installErrorNotices() {
  const report = (error: unknown) => {
    if (isStorageFull(error)) return showNotice(STORAGE_FULL);
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    // Harmless browser noise, and cancellations we caused on purpose.
    if (!message || /ResizeObserver loop|AbortError|aborted|cancelled|Worker was destroyed/i.test(message)) return;
    if (error instanceof Error && error.name === "AbortError") return;
    showNotice({ id: `error:${message}`, tone: "error", title: "Something went wrong", body: message });
  };
  window.addEventListener("error", (e) => report(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => report(e.reason));
}
