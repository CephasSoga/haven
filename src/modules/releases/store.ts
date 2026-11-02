import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Offer } from "./platforms";

export type Kind = "movie" | "tv" | "music" | "game";

export const KINDS: Record<Kind, { label: string; plural: string; source: string }> = {
  movie: { label: "Movie", plural: "Movies", source: "TMDB" },
  tv: { label: "TV show", plural: "TV shows", source: "TMDB" },
  music: { label: "Album", plural: "Music", source: "MusicBrainz" },
  game: { label: "Game", plural: "Games", source: "IGDB" },
};

export type Release = {
  /** "movie:123", "music:<mbid>"… */
  id: string;
  kind: Kind;
  title: string;
  /** yyyy-MM-dd */
  date: string;
  /** Artist, platforms, "New series"… */
  subtitle?: string;
  image?: string;
  genres: string[];
  overview?: string;
  url: string;
  /** Where it can be watched, heard or bought, on any platform (only yours are shown) */
  offers?: Offer[];
  /** TMDB's "where to watch" page, the fallback when a platform has no search link */
  watchUrl?: string;
};

/** Your choices — synced with your account so every device follows the same genres. */
type ReleasesState = {
  kinds: Record<Kind, boolean>;
  /** TMDB genre ids for movies and TV, MusicBrainz tags for music, IGDB genre/theme ids ("g12", "t19") for games */
  genres: { movie: number[]; tv: number[]; music: string[]; game: string[] };
  /** Releases you follow, kept whole so the release-day reminder works without fetching anything */
  follows: Record<string, Release>;
  /** The platforms you pay for; null means "whatever my Subscriptions say" */
  platforms: string[] | null;
  set: (patch: Partial<Pick<ReleasesState, "kinds" | "genres" | "platforms" | "follows">>) => void;
  toggleGenre: <K extends Kind>(kind: K, genre: ReleasesState["genres"][K][number]) => void;
  toggleFollow: (r: Release) => void;
};

export const useReleases = create<ReleasesState>()(
  persist(
    (set) => ({
      kinds: { movie: true, tv: true, music: true, game: true },
      genres: { movie: [], tv: [], music: [], game: [] },
      follows: {},
      platforms: null,
      set: (patch) => set(patch),
      toggleGenre: (kind, genre) =>
        set((s) => {
          const list = s.genres[kind] as (string | number)[];
          return { genres: { ...s.genres, [kind]: list.includes(genre) ? list.filter((g) => g !== genre) : [...list, genre] } };
        }),
      toggleFollow: (r) =>
        set((s) => {
          const follows = { ...s.follows };
          if (follows[r.id]) delete follows[r.id];
          else follows[r.id] = r;
          return { follows };
        }),
    }),
    { name: "haven:releases", version: 1 },
  ),
);

/**
 * This device only: API keys (like the Anthropic key, they never leave the device except to the
 * service itself), the latest results, and what you've already been told about.
 */
type LocalState = {
  keys: { tmdb: string; igdbId: string; igdbSecret: string };
  igdbToken?: { value: string; expires: number };
  items: Release[];
  checkedAt: number | null;
  /** The genres the latest results were fetched for */
  signature?: string;
  /** Ids already announced, so only genuinely new releases are notified */
  seen: string[];
  /** Ids that turned up in the latest check and weren't there before */
  fresh: string[];
  errors: Partial<Record<Kind, string>>;
  /** IGDB's genre and theme names, fetched once keys are set */
  gameGenres: { id: string; name: string }[];
  set: (patch: Partial<Omit<LocalState, "set">>) => void;
};

export const useReleasesLocal = create<LocalState>()(
  persist(
    (set) => ({
      keys: { tmdb: "", igdbId: "", igdbSecret: "" },
      items: [],
      checkedAt: null,
      seen: [],
      fresh: [],
      errors: {},
      gameGenres: [],
      set: (patch) => set(patch),
    }),
    { name: "haven:releases-local", version: 1 },
  ),
);

/** Genres people pick most; any MusicBrainz tag works. */
export const MUSIC_GENRES = [
  "pop", "rock", "hip hop", "rap", "r&b", "soul", "jazz", "blues", "electronic", "house", "techno", "ambient",
  "classical", "metal", "punk", "indie rock", "alternative rock", "folk", "country", "reggae", "afrobeats",
  "latin", "k-pop", "soundtrack", "chanson", "funk", "gospel",
];

/** TMDB's genre ids are fixed. */
export const MOVIE_GENRES: [number, string][] = [
  [28, "Action"], [12, "Adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"], [99, "Documentary"], [18, "Drama"],
  [10751, "Family"], [14, "Fantasy"], [36, "History"], [27, "Horror"], [10402, "Music"], [9648, "Mystery"], [10749, "Romance"],
  [878, "Science fiction"], [53, "Thriller"], [10752, "War"], [37, "Western"],
];

export const TV_GENRES: [number, string][] = [
  [10759, "Action & adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"], [99, "Documentary"], [18, "Drama"],
  [10751, "Family"], [10762, "Kids"], [9648, "Mystery"], [10764, "Reality"], [10765, "Sci-fi & fantasy"], [10768, "War & politics"], [37, "Western"],
];
