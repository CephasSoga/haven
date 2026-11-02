import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";

export type Interest = {
  id: string;
  name: string;
  /** Extra guidance, e.g. "focus on European startups, skip celebrity news" */
  detail?: string;
  emoji?: string;
};

export type FeedItem = {
  id: string;
  interestId: string;
  title: string;
  summary: string;
  why?: string;
  source: string;
  url: string;
  published?: string;
  /** The single most important story of the morning */
  lead?: boolean;
  read?: boolean;
  savedPageId?: string;
};

export type Edition = {
  /** yyyy-MM-dd */
  date: string;
  generatedAt: number;
  via: "claude" | "hackernews";
  items: FeedItem[];
};

type FeedState = {
  interests: Interest[];
  /** HH:mm — the morning edition is prepared from this time on */
  time: string;
  perInterest: number;
  auto: boolean;
  editions: Edition[];
  /** Not persisted: whether an edition is being prepared right now */
  running: boolean;
  error: string | null;
  addInterest: (i: Omit<Interest, "id">) => void;
  updateInterest: (id: string, patch: Partial<Interest>) => void;
  removeInterest: (id: string) => void;
  setPrefs: (patch: Partial<Pick<FeedState, "time" | "perInterest" | "auto">>) => void;
  saveEdition: (e: Edition) => void;
  patchItem: (date: string, id: string, patch: Partial<FeedItem>) => void;
  setRun: (running: boolean, error?: string | null) => void;
};

const KEEP = 14;

export const useFeed = create<FeedState>()(
  persist(
    (set) => ({
      interests: [],
      time: "07:00",
      perInterest: 4,
      auto: true,
      editions: [],
      running: false,
      error: null,
      addInterest: (i) => set((s) => ({ interests: [...s.interests, { ...i, id: uid() }] })),
      updateInterest: (id, patch) => set((s) => ({ interests: s.interests.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
      removeInterest: (id) => set((s) => ({ interests: s.interests.filter((i) => i.id !== id) })),
      setPrefs: (patch) => set(patch),
      saveEdition: (e) =>
        set((s) => ({ editions: [e, ...s.editions.filter((x) => x.date !== e.date)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP) })),
      patchItem: (date, id, patch) =>
        set((s) => ({
          editions: s.editions.map((e) => (e.date === date ? { ...e, items: e.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) } : e)),
        })),
      setRun: (running, error = null) => set({ running, error }),
    }),
    {
      name: "haven:feed",
      version: 1,
      partialize: ({ interests, time, perInterest, auto, editions }) => ({ interests, time, perInterest, auto, editions }),
    },
  ),
);

export const SUGGESTED: Omit<Interest, "id">[] = [
  { name: "Artificial intelligence", emoji: "🤖" },
  { name: "Startups & venture", emoji: "🚀" },
  { name: "Markets & economy", emoji: "📈" },
  { name: "Climate & energy", emoji: "🌍" },
  { name: "Africa", emoji: "🌍" },
  { name: "Football", emoji: "⚽" },
  { name: "Space", emoji: "🛰️" },
  { name: "Health & science", emoji: "🧬" },
  { name: "Design", emoji: "🎨" },
  { name: "World politics", emoji: "🗳️" },
  { name: "Personal finance", emoji: "💶" },
  { name: "Programming", emoji: "💻" },
];
