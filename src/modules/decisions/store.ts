import { create } from "zustand";
import { uid } from "@/lib/utils";
import { deriveKey, ITERATIONS, newSalt, open, seal, type Sealed } from "@/modules/vault/crypto";

/**
 * Decisions: hard choices worked through with AI, behind their own password. Dossiers, decisions and
 * outcomes are encrypted on this device with a key made from that password (the same scheme as the
 * Vault); only the ciphertext is saved and synced. The key lives in memory while unlocked.
 */

export type Terrain = "professional" | "financial" | "personal";
export const TERRAINS: Record<Terrain, string> = { professional: "Professional", financial: "Financial", personal: "Personal" };

export type Branch = {
  name: string;
  description: string;
  statusQuo: boolean;
  /** An option you hadn't listed */
  unseen: boolean;
  /** Chance of success, 0–100 */
  probability: number;
  /** What "success" means for this branch */
  success: string;
  y1: string;
  y5: string;
  y10: string;
  /** How easily it can be undone, 0 (one-way door) … 100 (fully reversible) */
  reversibility: number;
  stopCriteria: string[];
};

export type Analysis = {
  brief: string;
  branches: Branch[];
  redTeam: { adversary: string; attack: string }[];
  biases: { name: string; evidence: string; correction: string }[];
  recommendation: { branch: string; why: string; confidence: number };
  generatedAt: number;
  /** Which AI wrote it ("Claude", "GPT"…) */
  writer: string;
};

export type Verdict = "matched" | "partial" | "contradicted";
export const VERDICTS: Record<Verdict, { label: string; score: number }> = {
  matched: { label: "As predicted", score: 1 },
  partial: { label: "Partly", score: 0.5 },
  contradicted: { label: "Contradicted", score: 0 },
};

export type Dossier = {
  id: string;
  title: string;
  terrain: Terrain;
  /** The problem, told without smoothing it: what's at stake, fears, hopes, deadline */
  problem: string;
  /** Resources, constraints, the people involved */
  context: string;
  options: string[];
  createdAt: number;
  updatedAt: number;
  analysis?: Analysis;
  decision?: { branch: string; note: string; confidence: number; decidedAt: number };
  outcome?: { verdict: Verdict; note: string; at: number };
};

/** What's written to disk and synced: only the salt and the ciphertext. */
export type DecisionsFile = { app: "haven-decisions"; version: 1; salt: string; iterations: number; sealed: Sealed; updatedAt: number };

export const STORAGE_KEY = "haven:decisions";
const AUTO_LOCK_MINUTES = 10;

export function readDecisionsFile(): DecisionsFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DecisionsFile) : null;
  } catch {
    return null;
  }
}

function writeDecisionsFile(file: DecisionsFile | null) {
  if (file) localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
  else localStorage.removeItem(STORAGE_KEY);
}

type DossierDraft = Omit<Dossier, "id" | "createdAt" | "updatedAt"> & { id?: string };

type DecisionsState = {
  status: "none" | "locked" | "unlocked";
  dossiers: Dossier[];
  create: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  save: (d: DossierDraft) => Promise<string>;
  patch: (id: string, patch: Partial<Dossier>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Another device changed it: open the new version if the key still fits, else lock. */
  restore: (file: DecisionsFile | null) => Promise<void>;
};

// The key lives only in memory, outside React state, and is dropped on lock.
let key: CryptoKey | null = null;
let salt = "";
let lastActive = Date.now();
let timer: number | undefined;
const bump = () => (lastActive = Date.now());

export const useDecisions = create<DecisionsState>()((set, get) => {
  const persist = async (dossiers: Dossier[]) => {
    if (!key) throw new Error("Decisions are locked");
    writeDecisionsFile({ app: "haven-decisions", version: 1, salt, iterations: ITERATIONS, sealed: await seal(key, { dossiers }), updatedAt: Date.now() });
    set({ dossiers });
  };

  const watchIdle = () => {
    lastActive = Date.now();
    for (const e of ["pointerdown", "keydown", "wheel"]) window.addEventListener(e, bump, { passive: true });
    clearInterval(timer);
    timer = window.setInterval(() => {
      if (Date.now() - lastActive > AUTO_LOCK_MINUTES * 60_000) get().lock();
    }, 10_000);
  };

  return {
    status: readDecisionsFile() ? "locked" : "none",
    dossiers: [],

    create: async (password) => {
      salt = newSalt();
      key = await deriveKey(password, salt);
      await persist([]);
      set({ status: "unlocked" });
      watchIdle();
    },

    unlock: async (password) => {
      const file = readDecisionsFile();
      if (!file) return false;
      try {
        const k = await deriveKey(password, file.salt, file.iterations);
        const { dossiers } = await open<{ dossiers: Dossier[] }>(k, file.sealed);
        key = k;
        salt = file.salt;
        set({ status: "unlocked", dossiers });
        watchIdle();
        return true;
      } catch {
        return false;
      }
    },

    lock: () => {
      key = null;
      clearInterval(timer);
      set({ status: readDecisionsFile() ? "locked" : "none", dossiers: [] });
    },

    save: async (d) => {
      const now = Date.now();
      const id = d.id ?? uid();
      const existing = get().dossiers.find((x) => x.id === id);
      const dossier: Dossier = { ...existing, ...d, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
      await persist(existing ? get().dossiers.map((x) => (x.id === id ? dossier : x)) : [dossier, ...get().dossiers]);
      return id;
    },

    patch: async (id, patch) => persist(get().dossiers.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x))),

    remove: async (id) => persist(get().dossiers.filter((x) => x.id !== id)),

    restore: async (file) => {
      writeDecisionsFile(file);
      if (!file) return void ((key = null), clearInterval(timer), set({ status: "none", dossiers: [] }));
      // Still the same password: show the new contents without asking again.
      if (key && get().status === "unlocked" && file.salt === salt) {
        try {
          const { dossiers } = await open<{ dossiers: Dossier[] }>(key, file.sealed);
          return void set({ dossiers });
        } catch {
          /* fall through to lock */
        }
      }
      key = null;
      clearInterval(timer);
      set({ status: "locked", dossiers: [] });
    },
  };
});

/** How well past predictions held up: 100% when every outcome matched. */
export function calibration(dossiers: Dossier[]) {
  const reviewed = dossiers.filter((d) => d.outcome);
  return {
    reviewed: reviewed.length,
    score: reviewed.length ? Math.round((reviewed.reduce((s, d) => s + VERDICTS[d.outcome!.verdict].score, 0) / reviewed.length) * 100) : null,
  };
}
