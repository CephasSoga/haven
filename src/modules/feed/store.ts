import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import { defaultRegion, type Topic } from "./sources";

export type Interest = {
  id: string;
  name: string;
  /** Optional search words to use instead of the name, e.g. "Cameroun OR Douala" */
  detail?: string;
  emoji?: string;
};

/** Any RSS or Atom feed you want in your morning, e.g. a newspaper's front page */
export type CustomSource = { id: string; name: string; url: string };

export type FeedItem = {
  id: string;
  /** The section the story is filed under */
  interestId: string;
  title: string;
  summary: string;
  why?: string;
  source: string;
  url: string;
  /** yyyy-MM-dd (older editions) */
  published?: string;
  publishedAt?: number;
  image?: string;
  /** How many different outlets are covering this story */
  coverage?: number;
  related?: { source: string; url: string }[];
  /** The single most important story of the morning */
  lead?: boolean;
  read?: boolean;
  savedPageId?: string;
};

export type Section = { id: string; label: string; emoji?: string };

export type Edition = {
  /** yyyy-MM-dd */
  date: string;
  generatedAt: number;
  /** "claude": an AI wrote an overview (the name is historical — `writer` says which) */
  via: "news" | "claude" | "hackernews";
  /** Which AI wrote the overview: "Claude", "GPT"… */
  writer?: string;
  items: FeedItem[];
  sections?: Section[];
  /** A short written overview, when AI briefings are on */
  brief?: string;
  stats?: { stories: number; outlets: number };
};

type FeedState = {
  interests: Interest[];
  topics: Topic[];
  sources: CustomSource[];
  region: string;
  showTop: boolean;
  aiBrief: boolean;
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
  toggleTopic: (t: Topic) => void;
  addSource: (s: Omit<CustomSource, "id">) => void;
  removeSource: (id: string) => void;
  setPrefs: (patch: Partial<Pick<FeedState, "time" | "perInterest" | "auto" | "region" | "showTop" | "aiBrief">>) => void;
  saveEdition: (e: Edition) => void;
  patchItem: (date: string, id: string, patch: Partial<FeedItem>) => void;
  setRun: (running: boolean, error?: string | null) => void;
};

const KEEP = 14;

export const useFeed = create<FeedState>()(
  persist(
    (set) => ({
      interests: [],
      topics: ["WORLD", "NATION", "BUSINESS", "TECHNOLOGY"],
      sources: [],
      region: defaultRegion(),
      showTop: true,
      aiBrief: false,
      time: "07:00",
      perInterest: 6,
      auto: true,
      editions: [],
      running: false,
      error: null,
      addInterest: (i) => set((s) => ({ interests: [...s.interests, { ...i, id: uid() }] })),
      updateInterest: (id, patch) => set((s) => ({ interests: s.interests.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
      removeInterest: (id) => set((s) => ({ interests: s.interests.filter((i) => i.id !== id) })),
      toggleTopic: (t) => set((s) => ({ topics: s.topics.includes(t) ? s.topics.filter((x) => x !== t) : [...s.topics, t] })),
      addSource: (src) => set((s) => ({ sources: [...s.sources, { ...src, id: uid() }] })),
      removeSource: (id) => set((s) => ({ sources: s.sources.filter((x) => x.id !== id) })),
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
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as FeedState;
        if (version < 2) return { ...s, topics: ["WORLD", "NATION", "BUSINESS", "TECHNOLOGY"], sources: [], region: defaultRegion(), showTop: true, aiBrief: false, perInterest: Math.max(s.perInterest ?? 6, 6) } as FeedState;
        return s;
      },
      partialize: ({ interests, topics, sources, region, showTop, aiBrief, time, perInterest, auto, editions }) => ({
        interests,
        topics,
        sources,
        region,
        showTop,
        aiBrief,
        time,
        perInterest,
        auto,
        editions,
      }),
    },
  ),
);

export const SUGGESTED: Omit<Interest, "id">[] = [
  { name: "Artificial intelligence", emoji: "🤖" },
  { name: "Startups", emoji: "🚀" },
  { name: "Climate", emoji: "🌱" },
  { name: "Africa", emoji: "🌍" },
  { name: "Football", emoji: "⚽" },
  { name: "Space", emoji: "🛰️" },
  { name: "Design", emoji: "🎨" },
  { name: "Personal finance", emoji: "💶" },
  { name: "Programming", emoji: "💻" },
  { name: "Elections", emoji: "🗳️" },
  { name: "Cinema", emoji: "🎬" },
  { name: "Electric cars", emoji: "🔋" },
];
