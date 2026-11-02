import { lazy, type ComponentType } from "react";
import { CalendarDays, Library, NotebookPen, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";

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
 * navigation and routing pick it up automatically. Pages load on first visit, so heavy
 * pieces (the block editor, the PDF reader) don't slow down the rest of the app.
 */
export const MODULES: ModuleDef[] = [
  { id: "calendar", name: "Calendar", path: "/calendar", icon: CalendarDays, accent: "var(--cal)", page: lazy(() => import("./calendar/CalendarPage").then((m) => ({ default: m.CalendarPage }))) },
  { id: "finances", name: "Finances", path: "/finances", icon: Wallet, accent: "var(--fin)", page: lazy(() => import("./finances/FinancesPage").then((m) => ({ default: m.FinancesPage }))) },
  { id: "notes", name: "Notes", path: "/notes", icon: NotebookPen, accent: "var(--note)", page: lazy(() => import("./notes/NotesPage").then((m) => ({ default: m.NotesPage }))) },
  { id: "library", name: "Library", path: "/library", icon: Library, accent: "#c0583f", page: lazy(() => import("./library/LibraryPage").then((m) => ({ default: m.LibraryPage }))) },
  { id: "vault", name: "Vault", path: "/vault", icon: ShieldCheck, accent: "var(--pos)", page: lazy(() => import("./vault/VaultPage").then((m) => ({ default: m.VaultPage }))) },
];
