import { lazy, type ComponentType } from "react";
import { CalendarDays, Clapperboard, GraduationCap, Library, MessagesSquare, Mic, BookHeadphones, Newspaper, NotebookPen, Podcast, Repeat, Scale, Timer, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";

export type ModuleDef = {
  id: string;
  name: string;
  path: string;
  icon: LucideIcon;
  /** CSS color used for the module's accents in navigation */
  accent: string;
  /** Where it sits in the menu; none = at the top, next to Today */
  group?: GroupId;
  page: ComponentType;
};

export type GroupId = "work" | "money" | "leisure" | "private";

/** Menu sections, in order. */
export const GROUPS: { id: GroupId; name: string }[] = [
  { id: "work", name: "Work" },
  { id: "money", name: "Money" },
  { id: "leisure", name: "Read, watch & listen" },
  { id: "private", name: "Private" },
];

/**
 * Every module of Haven. Adding a module = building its page and adding an entry here;
 * navigation and routing pick it up automatically. Pages load on first visit, so heavy
 * pieces (the block editor, the PDF reader) don't slow down the rest of the app.
 */
export const MODULES: ModuleDef[] = [
  { id: "assistant", name: "Assistant", path: "/assistant", icon: MessagesSquare, accent: "#8b5cf6", page: lazy(() => import("./assistant/AssistantPage").then((m) => ({ default: m.AssistantPage }))) },
  { id: "calendar", name: "Calendar", path: "/calendar", icon: CalendarDays, accent: "var(--cal)", group: "work", page: lazy(() => import("./calendar/CalendarPage").then((m) => ({ default: m.CalendarPage }))) },
  { id: "focus", name: "Focus", path: "/focus", icon: Timer, accent: "#e0803a", group: "work", page: lazy(() => import("./focus/FocusPage").then((m) => ({ default: m.FocusPage }))) },
  { id: "notes", name: "Notes", path: "/notes", icon: NotebookPen, accent: "var(--note)", group: "work", page: lazy(() => import("./notes/NotesPage").then((m) => ({ default: m.NotesPage }))) },
  { id: "meetings", name: "Meetings", path: "/meetings", icon: Mic, accent: "var(--neg)", group: "work", page: lazy(() => import("./meetings/MeetingsPage").then((m) => ({ default: m.MeetingsPage }))) },
  { id: "finances", name: "Finances", path: "/finances", icon: Wallet, accent: "var(--fin)", group: "money", page: lazy(() => import("./finances/FinancesPage").then((m) => ({ default: m.FinancesPage }))) },
  { id: "subscriptions", name: "Subscriptions", path: "/subscriptions", icon: Repeat, accent: "#d6589f", group: "money", page: lazy(() => import("./subscriptions/SubscriptionsPage").then((m) => ({ default: m.SubscriptionsPage }))) },
  { id: "feed", name: "Morning", path: "/morning", icon: Newspaper, accent: "#c0583f", group: "leisure", page: lazy(() => import("./feed/FeedPage").then((m) => ({ default: m.FeedPage }))) },
  { id: "library", name: "Library", path: "/library", icon: Library, accent: "#3b82f6", group: "leisure", page: lazy(() => import("./library/LibraryPage").then((m) => ({ default: m.LibraryPage }))) },
  { id: "podcasts", name: "Podcasts", path: "/podcasts", icon: Podcast, accent: "#9b5de5", group: "leisure", page: lazy(() => import("./podcasts/PodcastsPage").then((m) => ({ default: m.PodcastsPage }))) },
  { id: "audiobooks", name: "Audiobooks", path: "/audiobooks", icon: BookHeadphones, accent: "#c2410c", group: "leisure", page: lazy(() => import("./audiobooks/AudiobooksPage").then((m) => ({ default: m.AudiobooksPage }))) },
  { id: "learning", name: "Learning", path: "/learning", icon: GraduationCap, accent: "#2f7d6d", group: "leisure", page: lazy(() => import("./learning/LearningPage").then((m) => ({ default: m.LearningPage }))) },
  { id: "releases", name: "Releases", path: "/releases", icon: Clapperboard, accent: "#0ea5b7", group: "leisure", page: lazy(() => import("./releases/ReleasesPage").then((m) => ({ default: m.ReleasesPage }))) },
  { id: "decisions", name: "Decisions", path: "/decisions", icon: Scale, accent: "#0f766e", group: "private", page: lazy(() => import("./decisions/DecisionsPage").then((m) => ({ default: m.DecisionsPage }))) },
  { id: "vault", name: "Vault", path: "/vault", icon: ShieldCheck, accent: "var(--pos)", group: "private", page: lazy(() => import("./vault/VaultPage").then((m) => ({ default: m.VaultPage }))) },
];
