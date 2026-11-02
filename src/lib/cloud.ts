import { createClient, type AuthError, type SupabaseClient, type User } from "@supabase/supabase-js";
import { create } from "zustand";

/**
 * Haven accounts, backed by Supabase. Configured with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * (the public "anon"/publishable key — access is enforced by row-level security in the database).
 * Without them, Haven runs exactly as before: local-only, no sign-in.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudEnabled = !!(url && key);

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Emails carry one-time codes instead of links, so nothing arrives via the URL.
        detectSessionInUrl: false,
        storageKey: "haven:auth",
      },
    })
  : null;

export type Account = { id: string; email: string; name: string };

type AuthState = {
  status: "loading" | "signed-out" | "signed-in";
  account: Account | null;
};

export const useAuth = create<AuthState>()(() => ({ status: cloudEnabled ? "loading" : "signed-out", account: null }));

function toAccount(u: User): Account {
  return { id: u.id, email: u.email ?? "", name: (u.user_metadata?.name as string | undefined) ?? "" };
}

/** Follows the session: restored on launch, refreshed in the background, cleared on sign-out. */
export function startAuth() {
  if (!supabase) return;
  supabase.auth.getSession().then(({ data }) => {
    useAuth.setState(data.session ? { status: "signed-in", account: toAccount(data.session.user) } : { status: "signed-out", account: null });
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    useAuth.setState(session ? { status: "signed-in", account: toAccount(session.user) } : { status: "signed-out", account: null });
  });
}

/* ---------- Actions ---------- */

export class AuthProblem extends Error {}

function explain(e: AuthError | null): never | void {
  if (!e) return;
  const m = e.message.toLowerCase();
  if (m.includes("invalid login")) throw new AuthProblem("That email and password don't match.");
  if (m.includes("already registered") || m.includes("already been registered")) throw new AuthProblem("There's already an account with that email. Sign in instead.");
  if (m.includes("email not confirmed")) throw new AuthProblem("CONFIRM");
  if (m.includes("password should be") || m.includes("weak password")) throw new AuthProblem("Choose a longer password — at least 8 characters.");
  if (m.includes("token has expired") || (m.includes("invalid") && m.includes("token"))) throw new AuthProblem("That code is wrong or has expired. Ask for a new one.");
  if (m.includes("rate limit") || m.includes("too many")) throw new AuthProblem("Too many attempts. Wait a minute and try again.");
  if (m.includes("fetch") || m.includes("network")) throw new AuthProblem("Couldn't reach the server. Check your connection.");
  throw new AuthProblem(e.message);
}

const client = () => {
  if (!supabase) throw new AuthProblem("Accounts aren't set up for this copy of Haven.");
  return supabase;
};

/** Returns "confirm" when the project asks new accounts to confirm their email first. */
export async function signUp(email: string, password: string, name: string): Promise<"signed-in" | "confirm"> {
  const { data, error } = await client().auth.signUp({ email, password, options: { data: { name } } });
  explain(error);
  // Supabase doesn't reveal existing accounts on sign-up; an empty identity list means "already registered".
  if (data.user && data.user.identities && data.user.identities.length === 0) throw new AuthProblem("There's already an account with that email. Sign in instead.");
  return data.session ? "signed-in" : "confirm";
}

export async function confirmSignUp(email: string, code: string) {
  const { error } = await client().auth.verifyOtp({ email, token: code.trim(), type: "signup" });
  explain(error);
}

export async function resendConfirmation(email: string) {
  const { error } = await client().auth.resend({ type: "signup", email });
  explain(error);
}

export async function signIn(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email, password });
  explain(error);
}

export async function sendPasswordReset(email: string) {
  const { error } = await client().auth.resetPasswordForEmail(email);
  explain(error);
}

export async function resetPassword(email: string, code: string, password: string) {
  const c = client();
  const { error } = await c.auth.verifyOtp({ email, token: code.trim(), type: "recovery" });
  explain(error);
  const { error: e2 } = await c.auth.updateUser({ password });
  explain(e2);
}

export async function changePassword(password: string) {
  const { error } = await client().auth.updateUser({ password });
  explain(error);
}

export async function endSession() {
  await client().auth.signOut();
}
