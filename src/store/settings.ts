import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";

export type ReminderPrefs = {
  /** Minutes before an event starts; null turns event reminders off */
  events: number | null;
  /** When the planner has placed a task */
  tasks: boolean;
  /** The morning a bill is due */
  bills: boolean;
  /** The day before a subscription renews or a free trial ends */
  subscriptions: boolean;
  /** The morning something you follow in Releases comes out (missing in settings saved before it existed: on) */
  releases?: boolean;
};

export const DEFAULT_REMINDERS: ReminderPrefs = { events: 10, tasks: false, bills: true, subscriptions: true, releases: true };

type SettingsState = {
  name: string;
  theme: Theme;
  currency: string;
  weekStartsOn: 0 | 1;
  reminders: ReminderPrefs;
  set: (patch: Partial<Omit<SettingsState, "set">>) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      name: "",
      theme: "system",
      currency: "EUR",
      weekStartsOn: 1,
      reminders: DEFAULT_REMINDERS,
      set: (patch) => set(patch),
    }),
    { name: "haven:settings", version: 1 },
  ),
);

export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
