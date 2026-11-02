import Anthropic from "@anthropic-ai/sdk";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Haven's connection to Claude. The API key you enter stays in this browser and requests go
 * straight from here to Anthropic — there is no Haven server in between.
 */

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Most capable" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Faster, about half the cost" },
] as const;

export type AiModel = (typeof AI_MODELS)[number]["id"];

type AiState = {
  apiKey: string;
  model: AiModel;
  set: (patch: Partial<Pick<AiState, "apiKey" | "model">>) => void;
};

export const useAi = create<AiState>()(
  persist(
    (set) => ({
      apiKey: "",
      model: "claude-opus-5-5",
      set: (patch) => set(patch),
    }),
    { name: "haven:ai", version: 1 },
  ),
);

export function aiReady() {
  return !!useAi.getState().apiKey.trim();
}

export function client() {
  const { apiKey } = useAi.getState();
  if (!apiKey.trim()) throw new AiError("Add your Anthropic API key in Settings to use AI features.");
  // This is a personal, local app: the key is the user's own and never leaves their device except to Anthropic.
  return new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
}

export class AiError extends Error {}

/** Common request options: the chosen model, and a server-side fallback if a safety classifier declines. */
export function baseRequest() {
  return {
    model: useAi.getState().model,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}

/** Turns SDK errors into sentences a person can act on. */
export function explain(error: unknown): string {
  if (error instanceof AiError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return "Anthropic didn't accept the API key. Check it in Settings.";
  if (error instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model or feature.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic — wait a minute and try again.";
  if (error instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your internet connection.";
  if (error instanceof Anthropic.APIError) return `Anthropic error ${error.status ?? ""}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** A tiny request to confirm the key works. */
export async function testConnection() {
  const res = await client().beta.messages.create({
    ...baseRequest(),
    max_tokens: 64,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
  });
  return res.content.some((b) => b.type === "text");
}
