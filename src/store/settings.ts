import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";

type SettingsState = {
  name: string;
  theme: Theme;
  currency: string;
  weekStartsOn: 0 | 1;
  set: (patch: Partial<Omit<SettingsState, "set">>) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      name: "",
      theme: "system",
      currency: "EUR",
      weekStartsOn: 1,
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
