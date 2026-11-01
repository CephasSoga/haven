import type { ComponentType } from "react";
import { CalendarDays, Wallet, type LucideIcon } from "lucide-react";
import { CalendarPage } from "./calendar/CalendarPage";
import { FinancesPage } from "./finances/FinancesPage";

export type ModuleDef = {
  id: string;
  name: string;
  path: string;
  icon: LucideIcon;
  /** CSS color used for the module's accents in navigation */
  accent: string;
  page: ComponentType;
};

/**
 * Every module of Haven. Adding a module = building its page and adding an entry here;
 * navigation and routing pick it up automatically.
 */
export const MODULES: ModuleDef[] = [
  { id: "calendar", name: "Calendar", path: "/calendar", icon: CalendarDays, accent: "var(--cal)", page: CalendarPage },
  { id: "finances", name: "Finances", path: "/finances", icon: Wallet, accent: "var(--fin)", page: FinancesPage },
];
