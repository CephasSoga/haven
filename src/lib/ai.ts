import Anthropic from "@anthropic-ai/sdk";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { inApp, because } from "@/lib/platform";
import { dismissNotice, showNotice } from "@/lib/notices";

/**
 * Haven's connection to an AI model: Claude (Anthropic), GPT (OpenAI) or GPT-OSS on Groq, with
 * your own API key. Keys stay in this browser and requests go straight to the service — there is
 * no Haven server in between. The OpenAI and Groq keys are the same ones meeting transcription uses.
 */

export type AiProvider = "anthropic" | "openai" | "groq";

export const AI_PROVIDERS: Record<
  AiProvider,
  { label: string; assistant: string; keyHint: string; keyUrl: string; models: { id: string; label: string; hint: string }[] }
> = {
  anthropic: {
    label: "Anthropic",
    assistant: "Claude",
    keyHint: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Most capable" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Faster, about half the cost" },
    ],
  },
  openai: {
    label: "OpenAI",
    assistant: "GPT",
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra", hint: "Most capable" },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", hint: "Nearly as good, much cheaper" },
      { id: "gpt-6-luna", label: "GPT-6 Luna", hint: "Cheapest, for simple jobs" },
    ],
  },
  groq: {
    label: "Groq",
    assistant: "GPT-OSS",
    keyHint: "gsk_…",
    keyUrl: "https://console.groq.com/keys",
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Most capable on Groq" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", hint: "Fastest and cheapest" },
    ],
  },
};

type AiState = {
  provider: AiProvider;
  keys: Record<AiProvider, string>;
  /** The model chosen for each service */
  models: Record<AiProvider, string>;
  set: (patch: Partial<Pick<AiState, "provider">>) => void;
  setKey: (provider: AiProvider, key: string) => void;
  setModel: (provider: AiProvider, model: string) => void;
};

const defaultModels = () => Object.fromEntries((Object.keys(AI_PROVIDERS) as AiProvider[]).map((p) => [p, AI_PROVIDERS[p].models[0].id])) as Record<AiProvider, string>;

/** Keys typed for meeting transcription before AI could use them too. */
function transcriptionKeys(): Partial<Record<AiProvider, string>> {
  try {
    return JSON.parse(localStorage.getItem("haven:stt") ?? "{}").state?.keys ?? {};
  } catch {
    return {};
  }
}

export const useAi = create<AiState>()(
  persist(
    (set) => ({
      provider: "anthropic",
      keys: { anthropic: "", openai: "", groq: "" },
      models: defaultModels(),
      set: (patch) => set(patch),
      setKey: (provider, key) => set((s) => ({ keys: { ...s.keys, [provider]: key } })),
      setModel: (provider, model) => set((s) => ({ models: { ...s.models, [provider]: model } })),
    }),
    {
      name: "haven:ai",
      version: 2,
      migrate: (persisted, version) => {
        // Version 1 knew only Anthropic: { apiKey, model }.
        if (version < 2) {
          const old = persisted as { apiKey?: string; model?: string };
          const stt = transcriptionKeys();
          return {
            provider: "anthropic",
            keys: { anthropic: old.apiKey ?? "", openai: stt.openai ?? "", groq: stt.groq ?? "" },
            models: { ...defaultModels(), ...(old.model ? { anthropic: old.model } : {}) },
          } as unknown as AiState;
        }
        return persisted as AiState;
      },
    },
  ),
);

/** Whether the chosen service has a key, i.e. AI features can run. */
export function aiReady() {
  const { provider, keys } = useAi.getState();
  return !!keys[provider].trim();
}

export const useAiReady = () => useAi((s) => !!s.keys[s.provider].trim());

/** "Claude", "GPT"… — for sentences like "Claude is reading the meeting". */
export const useAssistant = () => useAi((s) => AI_PROVIDERS[s.provider].assistant);
export const assistantName = () => AI_PROVIDERS[useAi.getState().provider].assistant;

export class AiError extends Error {}

/** The answer didn't come within the time allowed. */
export class AiTimeout extends AiError {}

/** The answer needed more room than the request allowed. */
export class AiTooLong extends AiError {
  constructor() {
    super("That was too long to handle in one go.");
  }
}

/** What was sent is more than the service takes in one request (Groq's per-minute allowance). */
export class AiTooBig extends AiError {
  constructor(
    message: string,
    /** Tokens the request took to read, by the service's own count */
    public reading: number,
    public limit: number,
  ) {
    super(message);
  }
}

/** The request was stopped on purpose (it isn't a failure to report). */
export class AiStopped extends AiError {
  constructor() {
    super("Stopped.");
  }
}

/** A service's answer that wasn't a success, keeping its status and own explanation. */
class ServiceError extends AiError {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
    /** The service's own error code, e.g. Groq's "json_validate_failed" */
    public code?: string,
    /** What the model wrote before the service rejected it (Groq) */
    public failed?: string,
  ) {
    super(message);
  }
}

/** Turns errors from any of the services into sentences a person can act on. */
/**
 * Whether trying the same request again could work: not when it was stopped on purpose, the key or
 * model is wrong, there's no key, or the model declined. Timeouts, dropped connections, busy servers
 * and unreadable answers are worth another go.
 */
export function worthRetrying(error: unknown) {
  if (error instanceof AiStopped || error instanceof AiTooLong || error instanceof AiTooBig) return false;
  if (error instanceof ServiceError) return error.status === 429 || error.status >= 500;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.NotFoundError || error instanceof Anthropic.BadRequestError) return false;
  if (error instanceof AiError && /API key|declined/i.test(error.message)) return false;
  return true;
}

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

/* ---------- Staying within a per-minute token allowance ---------- */

/*
 * Groq limits how many tokens each minute may use — 8,000 on its free plan — and counts the longest
 * answer a request allows as well as what it sends. Haven learns the limit from Groq's refusals,
 * paces requests to it, and long jobs (a whole meeting) send their text in consecutive pieces that
 * each fit. Anthropic and OpenAI allow far more, so their requests go in one piece.
 */

const TPM_KEY = "haven:groq-tpm";
let groqTpm = (() => {
  try {
    return Number(localStorage.getItem(TPM_KEY)) || 8000;
  } catch {
    return 8000;
  }
})();
const spent: { at: number; tokens: number }[] = [];

function learnGroqLimit(limit: number) {
  groqTpm = limit;
  try {
    localStorage.setItem(TPM_KEY, String(limit));
  } catch {
    /* only an optimisation */
  }
}

/** A rough count of the tokens a text takes (about 3–4 characters each). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.2);

/** How many tokens one request may take in all (what's sent plus the answer) with the chosen service. */
export function tokenBudget() {
  return useAi.getState().provider === "groq" ? groqTpm : 200_000;
}

/** Waits, if need be, until the last minute's requests leave room for `tokens` more. */
async function pace(tokens: number, signal?: AbortSignal) {
  for (;;) {
    const now = Date.now();
    while (spent.length && now - spent[0].at > 60_000) spent.shift();
    const used = spent.reduce((sum, x) => sum + x.tokens, 0);
    if (!spent.length || used + tokens <= groqTpm) break;
    const wait = 60_000 - (now - spent[0].at) + 500;
    showNotice({ id: "groq-wait", tone: "info", sticky: true, title: "Waiting for Groq", body: `Your Groq plan allows ${groqTpm.toLocaleString()} tokens a minute, so long jobs go in parts. Carrying on in about ${Math.ceil(wait / 1000)} s.` });
    // Waiting can be stopped too.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, wait);
      signal?.addEventListener("abort", () => (clearTimeout(t), dismissNotice("groq-wait"), reject(new DOMException("Stopped", "AbortError"))), { once: true });
    });
  }
  dismissNotice("groq-wait");
  spent.push({ at: Date.now(), tokens });
}

/** Splits items into consecutive groups whose text comes to at most about `tokens` tokens each. */
export function inPieces<T>(items: T[], text: (item: T) => string, tokens: number): T[][] {
  const out: T[][] = [];
  let piece: T[] = [];
  let size = 0;
  for (const item of items) {
    const n = estimateTokens(text(item)) + 2;
    if (piece.length && size + n > tokens) {
      out.push(piece);
      piece = [];
      size = 0;
    }
    piece.push(item);
    size += n;
  }
  if (piece.length) out.push(piece);
  return out;
}

/* ---------- Asking for a structured answer ---------- */

export type JsonRequest = {
  /** A short name for the answer's shape (OpenAI and Groq want one) */
  name: string;
  system: string;
  user: string;
  /** JSON Schema of the answer: every object closed (additionalProperties: false) with all its fields required */
  schema: Record<string, unknown>;
  /** How hard to think: low for sorting and summaries, higher for reading a whole meeting */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** The least room the answer needs: when what's sent leaves less (Groq's small plans), it's too big to send */
  minAnswer?: number;
  /** Lets the caller stop the request (a Stop button) */
  signal?: AbortSignal;
  /** Give up after this long; default 3 minutes */
  timeoutMs?: number;
};

/** Asks the chosen service for an answer in the given JSON shape, and returns it parsed. */
export async function askJson<T>(original: JsonRequest): Promise<T> {
  const { provider, keys, models } = useAi.getState();
  const key = keys[provider].trim();
  if (!key) throw new AiError(`Add your ${AI_PROVIDERS[provider].label} API key in Settings to use AI features.`);
  // Never wait forever: a stalled connection used to leave things "thinking" indefinitely.
  const limit = original.timeoutMs ?? 180_000;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => ((timedOut = true), controller.abort()), limit);
  const stop = () => controller.abort();
  if (original.signal?.aborted) controller.abort();
  original.signal?.addEventListener("abort", stop);
  const req = { ...original, signal: controller.signal };
  let text: string;
  try {
    text = provider === "anthropic" ? await viaAnthropic(req, key, models.anthropic) : provider === "openai" ? await viaOpenAi(req, key, models.openai) : await viaGroq(req, key, models.groq);
  } catch (e) {
    if (controller.signal.aborted) {
      if (timedOut)
        throw new AiTimeout(
          `${AI_PROVIDERS[provider].assistant} took more than ${Math.round(limit / 1000)} seconds to answer, so Haven stopped waiting. Try again, or pick a faster model in Settings.`,
        );
      throw new AiStopped();
    }
    throw e;
  } finally {
    clearTimeout(timer);
    original.signal?.removeEventListener("abort", stop);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError(`${AI_PROVIDERS[provider].assistant}'s answer couldn't be read. Try again.`);
  }
}

async function viaAnthropic(req: JsonRequest, apiKey: string, model: string) {
  // This is a personal, local app: the key is the user's own and never leaves their device except to Anthropic.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  // Streaming keeps long inputs (a whole meeting) clear of request timeouts.
  const res = await client.beta.messages
    .stream({
      model,
      // If a safety classifier declines, the request is retried on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: req.maxTokens ?? 16000,
      output_config: { effort: req.effort ?? "medium", format: { type: "json_schema", schema: req.schema } },
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }, { signal: req.signal })
    .finalMessage();
  if (res.stop_reason === "refusal") throw new AiError("Claude declined to do this.");
  if (res.stop_reason === "max_tokens") throw new AiTooLong();
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** The apps send requests natively, so the services' browser rules (CORS) don't get in the way. */
async function post(name: string, url: string, key: string, body: unknown, signal?: AbortSignal) {
  const doFetch = inApp ? (await import("@tauri-apps/plugin-http")).fetch : fetch;
  let res: Response;
  try {
    res = await doFetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiError(inApp ? `Couldn't reach ${name}${because(e)}. Check your internet connection.` : `Couldn't reach ${name} from this browser — check your connection, or use the Haven app.`);
  }
  if (res.ok) return res.json();
  const error = await res
    .json()
    .then((j: { error?: { message?: string; code?: string; failed_generation?: string } }) => j.error)
    .catch(() => undefined);
  const detail = error?.message;
  const fail = (message: string) => new ServiceError(message, res.status, detail, error?.code, error?.failed_generation);
  if (res.status === 401) throw fail(`${name} didn't accept the API key. Check it in Settings.`);
  if (res.status === 404) throw fail(`${name} doesn't offer that model to your key${detail ? ` (${detail})` : ""}. Pick another model in Settings.`);
  if (res.status === 429) throw fail(`Rate limited by ${name} — wait a minute and try again.`);
  throw fail(`${name} answered ${res.status}${detail ? `: ${detail}` : ""}.`);
}

async function viaOpenAi(req: JsonRequest, key: string, model: string) {
  type Out = { status?: string; incomplete_details?: { reason?: string }; output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[] };
  const res = (await post("OpenAI", "https://api.openai.com/v1/responses", key, {
    model,
    instructions: req.system,
    input: req.user,
    text: { format: { type: "json_schema", name: req.name, schema: req.schema, strict: true } },
    reasoning: { effort: req.effort ?? "medium" },
    max_output_tokens: req.maxTokens ?? 16000,
  }, req.signal)) as Out;
  const parts = (res.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
  if (parts.some((p) => p.type === "refusal")) throw new AiError("GPT declined to do this.");
  if (res.status === "incomplete" && res.incomplete_details?.reason === "max_output_tokens") throw new AiTooLong();
  return parts.map((p) => (p.type === "output_text" ? (p.text ?? "") : "")).join("");
}

/** "Limit 8000, Requested 12998" — from Groq's "tokens per minute" refusals. */
function tokensPerMinute(detail?: string) {
  const m = detail?.match(/tokens per minute[^]*?Limit\s*(\d+)[^]*?Requested\s*(\d+)/i);
  return m ? { limit: Number(m[1]), requested: Number(m[2]) } : null;
}

async function viaGroq(req: JsonRequest, key: string, model: string) {
  type Out = { choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[] };
  const ask = (maxTokens: number, effort: string) =>
    post("Groq", "https://api.groq.com/openai/v1/chat/completions", key, {
      model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: req.name, schema: req.schema, strict: true } },
      max_completion_tokens: maxTokens,
      // GPT-OSS thinks before answering, and the thinking comes out of the same allowance as the answer.
      ...(model.includes("gpt-oss") ? { reasoning_effort: effort } : {}),
    }, req.signal) as Promise<Out>;
  const wanted = Math.min(req.maxTokens ?? 16000, 65536);
  // Groq counts the longest answer allowed against the allowance, so allow only what fits.
  let reading = estimateTokens(req.system + req.user + JSON.stringify(req.schema)) + 50;
  let max = Math.max(1000, Math.min(wanted, groqTpm - reading - 256));
  // With little room, think briefly so the answer itself fits; "high" is only worth it with plenty.
  const thinking = () => (max < 4000 ? "low" : req.effort === "high" && max >= 12000 ? "high" : req.effort === "low" ? "low" : "medium");
  let effort = thinking();
  let retriedShorter = false;
  let res: Out;
  for (let attempt = 0; ; attempt++) {
    await pace(reading + max, req.signal);
    try {
      res = await ask(max, effort);
      break;
    } catch (e) {
      // The answer didn't fit the requested shape — usually because it ran out of room and stopped mid-way.
      if (e instanceof ServiceError && e.code === "json_validate_failed") {
        // Often what it wrote is fine after all (Groq is strict about the shape); use it when it reads as JSON.
        if (e.failed) {
          try {
            JSON.parse(e.failed);
            return e.failed;
          } catch {
            /* cut off: try again */
          }
        }
        if (!retriedShorter) {
          retriedShorter = true;
          effort = "low";
          continue;
        }
        throw new AiTooLong();
      }
      const tpm = e instanceof ServiceError && (e.status === 413 || e.status === 429) ? tokensPerMinute(e.detail) : null;
      if (!tpm) throw e;
      if (attempt >= 2) throw new AiError(`Groq's per-minute token allowance (${tpm.limit.toLocaleString()} on your plan) is used up — wait a minute and try again.`);
      learnGroqLimit(tpm.limit);
      reading = Math.max(0, tpm.requested - max);
      const room = tpm.limit - reading - 256;
      if (room < Math.max(1000, Math.min(wanted, req.minAnswer ?? 0)))
        throw new AiTooBig(
          `This is more than your Groq plan allows in a minute (${tpm.limit.toLocaleString()} tokens; reading this alone takes about ${reading.toLocaleString()}). Try a shorter request, Groq's paid tier, or another AI service in Settings.`,
          reading,
          tpm.limit,
        );
      max = Math.min(wanted, room);
      effort = thinking();
      // It would have fitted: the minute's allowance was simply used up. Wait for it to refill.
      if (tpm.requested <= tpm.limit) spent.push({ at: Date.now(), tokens: tpm.limit });
    }
  }
  const choice = res.choices?.[0];
  if (choice?.message?.refusal) throw new AiError("The model declined to do this.");
  if (choice?.finish_reason === "length") throw new AiTooLong();
  return choice?.message?.content ?? "";
}

/** A tiny request to confirm the key and model work. */
export async function testConnection() {
  const out = await askJson<{ reply: string }>({
    name: "ping",
    system: "Answer in the requested format.",
    user: "Reply with the single word: ready",
    schema: { type: "object", additionalProperties: false, required: ["reply"], properties: { reply: { type: "string" } } },
    effort: "low",
    maxTokens: 1000,
  });
  return typeof out.reply === "string";
}
