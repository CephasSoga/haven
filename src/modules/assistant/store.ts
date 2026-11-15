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
  /** The request failed (or was stopped); the text says why */
  error?: boolean;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  messages: ChatMessage[];
};

/**
 * Your conversations with the assistant. They stay on this device (they aren't synced): what they
 * change lands in your calendar, tasks, finances and notes, which are.
 */
type AssistantState = {
  chats: Chat[];
  /** Chats waiting for an answer, with when they started (kept while Haven is open, not saved) */
  pending: Record<string, number>;
  create: () => string;
  add: (chatId: string, m: Omit<ChatMessage, "id" | "at">) => string;
  patchProposal: (chatId: string, messageId: string, proposalId: string, patch: Partial<Proposal>) => void;
  update: (chatId: string, patch: Partial<Pick<Chat, "title" | "pinned" | "archived">>) => void;
  remove: (chatId: string) => void;
  setPending: (chatId: string, waiting: boolean) => void;
};

/** A chat's title from its first message: the first line, shortened. */
const titleFrom = (text: string) => {
  const line = text.trim().split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
};

export const useAssistant = create<AssistantState>()(
  persist(
    (set) => ({
      chats: [],
      pending: {},
      create: () => {
        const id = uid();
        const now = Date.now();
        set((s) => ({ chats: [{ id, title: "", createdAt: now, updatedAt: now, messages: [] }, ...s.chats] }));
        return id;
      },
      add: (chatId, m) => {
        const id = uid();
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  title: c.title || (m.role === "user" ? titleFrom(m.text) : c.title),
                  updatedAt: Date.now(),
                  // A sent message brings an archived chat back.
                  archived: m.role === "user" ? false : c.archived,
                  messages: [...c.messages, { ...m, id, at: Date.now() }].slice(-300),
                }
              : c,
          ),
        }));
        return id;
      },
      patchProposal: (chatId, messageId, proposalId, patch) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, proposals: m.proposals?.map((p) => (p.id === proposalId ? { ...p, ...patch } : p)) } : m)) }
              : c,
          ),
        })),
      update: (chatId, patch) => set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, ...patch } : c)) })),
      remove: (chatId) => set((s) => ({ chats: s.chats.filter((c) => c.id !== chatId) })),
      setPending: (chatId, waiting) =>
        set((s) => {
          const pending = { ...s.pending };
          if (waiting) pending[chatId] = Date.now();
          else delete pending[chatId];
          return { pending };
        }),
    }),
    {
      name: "haven:assistant",
      version: 2,
      partialize: ({ chats }) => ({ chats }),
      // Version 1 held a single conversation; it becomes the first chat.
      migrate: (persisted, version) => {
        if (version < 2) {
          const messages = ((persisted as { messages?: ChatMessage[] }).messages ?? []).filter(Boolean);
          if (!messages.length) return { chats: [] } as unknown as AssistantState;
          const first = messages.find((m) => m.role === "user");
          return {
            chats: [{ id: uid(), title: first ? titleFrom(first.text) : "Conversation", createdAt: messages[0].at, updatedAt: messages.at(-1)!.at, messages }],
          } as unknown as AssistantState;
        }
        return persisted as AssistantState;
      },
    },
  ),
);

/** Pinned first, then the most recently active. */
export function sortChats(chats: Chat[]) {
  return [...chats].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
}
