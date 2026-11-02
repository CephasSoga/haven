import { create } from "zustand";
import { uid } from "@/lib/utils";
import { deriveKey, ITERATIONS, newSalt, open, seal, type Sealed } from "./crypto";
import type { VaultItem } from "./kinds";

/** What is written to disk: only the salt and the ciphertext. */
export type VaultFile = { app: "haven-vault"; version: 1; salt: string; iterations: number; sealed: Sealed; updatedAt: number };

const STORAGE_KEY = "haven:vault";
const PREFS_KEY = "haven:vault-prefs";

export function readVaultFile(): VaultFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VaultFile) : null;
  } catch {
    return null;
  }
}

function writeVaultFile(file: VaultFile | null) {
  if (file) localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
  else localStorage.removeItem(STORAGE_KEY);
}

function readAutoLock() {
  const n = Number(localStorage.getItem(PREFS_KEY));
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export type ItemDraft = Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: number };

type VaultState = {
  status: "none" | "locked" | "unlocked";
  items: VaultItem[];
  /** Minutes of inactivity before the vault locks itself */
  autoLock: number;
  create: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  save: (draft: ItemDraft) => Promise<string>;
  remove: (id: string) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<boolean>;
  setAutoLock: (minutes: number) => void;
  /** Replaces the vault with an exported file; it stays locked until unlocked with that file's password. */
  restore: (file: VaultFile | null) => void;
};

// The key lives only in memory, outside React state, and is dropped on lock.
let key: CryptoKey | null = null;
let salt = "";
let lastActive = Date.now();
let timer: number | undefined;
const bump = () => (lastActive = Date.now());

export const useVault = create<VaultState>()((set, get) => {
  const persist = async (items: VaultItem[]) => {
    if (!key) throw new Error("Vault is locked");
    writeVaultFile({ app: "haven-vault", version: 1, salt, iterations: ITERATIONS, sealed: await seal(key, items), updatedAt: Date.now() });
  };

  const watchIdle = () => {
    lastActive = Date.now();
    // Same function reference each time, so repeated unlocks don't stack listeners.
    for (const e of ["pointerdown", "keydown", "wheel"]) window.addEventListener(e, bump, { passive: true });
    clearInterval(timer);
    timer = window.setInterval(() => {
      if (Date.now() - lastActive > get().autoLock * 60_000) get().lock();
    }, 10_000);
  };

  return {
    status: readVaultFile() ? "locked" : "none",
    items: [],
    autoLock: readAutoLock(),

    create: async (password) => {
      salt = newSalt();
      key = await deriveKey(password, salt);
      await persist([]);
      set({ status: "unlocked", items: [] });
      watchIdle();
    },

    unlock: async (password) => {
      const file = readVaultFile();
      if (!file) return false;
      try {
        const k = await deriveKey(password, file.salt, file.iterations);
        const items = await open<VaultItem[]>(k, file.sealed);
        key = k;
        salt = file.salt;
        set({ status: "unlocked", items });
        watchIdle();
        return true;
      } catch {
        return false;
      }
    },

    lock: () => {
      key = null;
      clearInterval(timer);
      set({ status: readVaultFile() ? "locked" : "none", items: [] });
    },

    save: async (draft) => {
      const now = Date.now();
      const id = draft.id ?? uid();
      const item: VaultItem = { ...draft, id, createdAt: draft.createdAt ?? now, updatedAt: now };
      const items = draft.id ? get().items.map((i) => (i.id === id ? item : i)) : [...get().items, item];
      await persist(items);
      set({ items });
      return id;
    },

    remove: async (id) => {
      const items = get().items.filter((i) => i.id !== id);
      await persist(items);
      set({ items });
    },

    changePassword: async (current, next) => {
      const file = readVaultFile();
      if (!file) return false;
      try {
        await open(await deriveKey(current, file.salt, file.iterations), file.sealed);
      } catch {
        return false;
      }
      salt = newSalt();
      key = await deriveKey(next, salt);
      await persist(get().items);
      return true;
    },

    setAutoLock: (minutes) => {
      localStorage.setItem(PREFS_KEY, String(minutes));
      set({ autoLock: minutes });
    },

    restore: (file) => {
      key = null;
      clearInterval(timer);
      writeVaultFile(file);
      set({ status: file ? "locked" : "none", items: [] });
    },
  };
});
