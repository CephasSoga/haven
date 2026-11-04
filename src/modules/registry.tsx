import { lazy, type ComponentType } from "react";
import { CalendarDays, Clapperboard, Library, MessagesSquare, Mic, Newspaper, NotebookPen, Repeat, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";

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
  { id: "assistant", name: "Assistant", path: "/assistant", icon: MessagesSquare, accent: "#8b5cf6", page: lazy(() => import("./assistant/AssistantPage").then((m) => ({ default: m.AssistantPage }))) },
  { id: "feed", name: "Morning", path: "/morning", icon: Newspaper, accent: "#c0583f", page: lazy(() => import("./feed/FeedPage").then((m) => ({ default: m.FeedPage }))) },
  { id: "calendar", name: "Calendar", path: "/calendar", icon: CalendarDays, accent: "var(--cal)", page: lazy(() => import("./calendar/CalendarPage").then((m) => ({ default: m.CalendarPage }))) },
  { id: "meetings", name: "Meetings", path: "/meetings", icon: Mic, accent: "var(--neg)", page: lazy(() => import("./meetings/MeetingsPage").then((m) => ({ default: m.MeetingsPage }))) },
  { id: "finances", name: "Finances", path: "/finances", icon: Wallet, accent: "var(--fin)", page: lazy(() => import("./finances/FinancesPage").then((m) => ({ default: m.FinancesPage }))) },
  { id: "subscriptions", name: "Subscriptions", path: "/subscriptions", icon: Repeat, accent: "#d6589f", page: lazy(() => import("./subscriptions/SubscriptionsPage").then((m) => ({ default: m.SubscriptionsPage }))) },
  { id: "notes", name: "Notes", path: "/notes", icon: NotebookPen, accent: "var(--note)", page: lazy(() => import("./notes/NotesPage").then((m) => ({ default: m.NotesPage }))) },
  { id: "library", name: "Library", path: "/library", icon: Library, accent: "#3b82f6", page: lazy(() => import("./library/LibraryPage").then((m) => ({ default: m.LibraryPage }))) },
  { id: "releases", name: "Releases", path: "/releases", icon: Clapperboard, accent: "#0ea5b7", page: lazy(() => import("./releases/ReleasesPage").then((m) => ({ default: m.ReleasesPage }))) },
  { id: "vault", name: "Vault", path: "/vault", icon: ShieldCheck, accent: "var(--pos)", page: lazy(() => import("./vault/VaultPage").then((m) => ({ default: m.VaultPage }))) },
];
