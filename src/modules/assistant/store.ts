import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import type { Action } from "./actions";

/** A proposed action and what became of it. */
export type Proposal = {
  id: string;
  action: Action;
  /** Ticked to be applied */
  include: boolean;
  status: "pending" | "applied" | "skipped" | "failed" | "undone";
  /** Why it can't be applied (checked against your data), or why applying failed */
  problem?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  proposals?: Proposal[];
  /** The request failed; the text says why */
  error?: boolean;
};

/**
 * The conversation with the assistant. It stays on this device (it isn't synced): what it changes
 * lands in your calendar, tasks, finances and notes, which are.
 */
type AssistantState = {
  messages: ChatMessage[];
  add: (m: Omit<ChatMessage, "id" | "at">) => string;
  patch: (id: string, patch: Partial<ChatMessage>) => void;
  patchProposal: (messageId: string, proposalId: string, patch: Partial<Proposal>) => void;
  clear: () => void;
};

export const useAssistant = create<AssistantState>()(
  persist(
    (set) => ({
      messages: [],
      add: (m) => {
        const id = uid();
        set((s) => ({ messages: [...s.messages, { ...m, id, at: Date.now() }].slice(-200) }));
        return id;
      },
      patch: (id, patch) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      patchProposal: (messageId, proposalId, patch) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === messageId ? { ...m, proposals: m.proposals?.map((p) => (p.id === proposalId ? { ...p, ...patch } : p)) } : m,
          ),
        })),
      clear: () => set({ messages: [] }),
    }),
    { name: "haven:assistant", version: 1 },
  ),
);
