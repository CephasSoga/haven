import { useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Eye, EyeOff, Mail } from "lucide-react";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { AuthProblem, confirmSignUp, resendConfirmation, resetPassword, sendPasswordReset, signIn, signUp } from "@/lib/cloud";
import { cn } from "@/lib/utils";
import { strength, STRENGTH } from "@/modules/vault/crypto";

type Step = "signin" | "signup" | "confirm" | "forgot" | "reset";

/** Shown when accounts are on and nobody is signed in. */
export function AuthScreen() {
  const [step, setStep] = useState<Step>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const go = (s: Step) => {
    setStep(s);
    setError(null);
    setNote(null);
    setCode("");
  };

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof AuthProblem && err.message === "CONFIRM") {
        await resendConfirmation(email).catch(() => {});
        go("confirm");
      } else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grain relative grid min-h-dvh bg-canvas lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0" style={{ background: "linear-gradient(150deg, #2a2c55 0%, #6a4c93 42%, #1f9e85 100%)" }} />
        <div className="absolute inset-0 opacity-50 mix-blend-soft-light" style={{ background: "radial-gradient(circle at 25% 20%, rgba(255,255,255,.8), transparent 40%), radial-gradient(circle at 80% 85%, rgba(0,0,0,.4), transparent 50%)" }} />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="size-10 rounded-xl shadow-float" />
            <span className="font-serif text-3xl">Haven</span>
          </div>
          <div className="max-w-md">
            <p className="font-serif text-[44px] leading-[1.08]">A calm home for your days, your money and your thoughts.</p>
            <p className="mt-5 text-[15px] leading-relaxed text-white/75">
              Sign in once, and your planner, finances, notes, library and vault follow you — on your computer, your phone and the web.
            </p>
          </div>
          <p className="text-[12px] text-white/60">Your vault is encrypted with your master password before it ever leaves your device.</p>
        </div>
      </div>

      {/* Form */}
      <div className="relative z-10 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-9 rounded-xl" />
            <span className="font-serif text-[28px]">Haven</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
              {(step === "signin" || step === "signup") && (
                <>
                  <h1 className="font-serif text-[40px] leading-tight">{step === "signin" ? "Welcome back" : "Create your account"}</h1>
                  <p className="mt-1.5 text-[15px] text-muted">{step === "signin" ? "Sign in to pick up where you left off." : "One account for Haven on all your devices."}</p>
                  <Segmented
                    layoutId="auth-mode"
                    className="mt-7 w-full"
                    value={step}
                    onChange={(s) => go(s)}
                    options={[
                      { value: "signin", label: "Sign in" },
                      { value: "signup", label: "Create account" },
                    ]}
                  />
                  <form
                    className="mt-6 flex flex-col gap-4"
                    onSubmit={run(async () => {
                      if (step === "signin") await signIn(email.trim(), password);
                      else if ((await signUp(email.trim(), password, name.trim())) === "confirm") go("confirm");
                    })}
                  >
                    {step === "signup" && (
                      <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="How Haven should greet you" />}</Field>
                    )}
                    <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />}</Field>
                    <Field label="Password">
                      {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete={step === "signin" ? "current-password" : "new-password"} />}
                    </Field>
                    {step === "signup" && <Strength password={password} />}
                    <Problem text={error} />
                    <Button variant="primary" type="submit" className="mt-1 h-11" disabled={busy || !email || password.length < (step === "signup" ? 8 : 1)}>
                      {busy ? "One moment…" : step === "signin" ? "Sign in" : "Create account"}
                    </Button>
                    {step === "signin" && (
                      <button type="button" onClick={() => go("forgot")} className="self-center text-[13px] font-medium text-muted hover:text-ink">
                        Forgot your password?
                      </button>
                    )}
                  </form>
                </>
              )}

              {step === "confirm" && (
                <CodeStep
                  title="Check your inbox"
                  body={
                    <>
                      We sent a code to <span className="font-medium text-ink">{email}</span>. Enter it to confirm your email.
                      <span className="mt-2 block text-[13px]">
                        Got a link instead of a code? Open it to confirm, then{" "}
                        <button type="button" onClick={() => go("signin")} className="font-medium text-cal hover:underline">
                          sign in here
                        </button>
                        .
                      </span>
                    </>
                  }
                  code={code}
                  setCode={setCode}
                  busy={busy}
                  error={error}
                  note={note}
                  submitLabel="Confirm and continue"
                  onSubmit={run(() => confirmSignUp(email.trim(), code))}
                  onResend={async () => {
                    await resendConfirmation(email.trim()).catch(() => {});
                    setNote("A new code is on its way.");
                  }}
                  onBack={() => go("signin")}
                />
              )}

              {step === "forgot" && (
                <>
                  <BackLink onClick={() => go("signin")} />
                  <h1 className="font-serif text-[40px] leading-tight">Reset your password</h1>
                  <p className="mt-1.5 text-[15px] text-muted">Enter your email and we'll send you a code.</p>
                  <form
                    className="mt-6 flex flex-col gap-4"
                    onSubmit={run(async () => {
                      await sendPasswordReset(email.trim());
                      go("reset");
                    })}
                  >
                    <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />}</Field>
                    <Problem text={error} />
                    <Button variant="primary" type="submit" className="h-11" disabled={busy || !email}>
                      {busy ? "Sending…" : "Send the code"}
                    </Button>
                  </form>
                </>
              )}

              {step === "reset" && (
                <CodeStep
                  title="Choose a new password"
                  body={
                    <>
                      Enter the code we sent to <span className="font-medium text-ink">{email}</span>, then your new password.
                    </>
                  }
                  code={code}
                  setCode={setCode}
                  busy={busy}
                  error={error}
                  note={note}
                  submitLabel="Save and sign in"
                  disabled={password.length < 8}
                  extra={
                    <>
                      <Field label="New password">{(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />}</Field>
                      <Strength password={password} />
                    </>
                  }
                  onSubmit={run(() => resetPassword(email.trim(), code, password))}
                  onResend={async () => {
                    await sendPasswordReset(email.trim()).catch(() => {});
                    setNote("A new code is on its way.");
                  }}
                  onBack={() => go("signin")}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-6 flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
      <ArrowLeft className="size-4" /> Back to sign in
    </button>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? <div className="rounded-xl bg-neg/10 px-3.5 py-2.5 text-[13px] text-neg">{text}</div> : null;
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required className="pr-11" />
      <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-faint hover:text-ink">
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function Strength({ password }: { password: string }) {
  const score = strength(password);
  return (
    <div className="-mt-1 flex items-center gap-3">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-1 flex-1 rounded-full" style={{ background: password && i < Math.max(score, 1) ? STRENGTH[score].color : "var(--sunken)" }} />
        ))}
      </div>
      <span className="w-28 text-right text-[12px] text-muted">{password.length < 8 ? "8+ characters" : STRENGTH[score].label}</span>
    </div>
  );
}

function CodeStep(props: {
  title: string;
  body: ReactNode;
  code: string;
  setCode: (c: string) => void;
  busy: boolean;
  error: string | null;
  note: string | null;
  submitLabel: string;
  disabled?: boolean;
  extra?: ReactNode;
  onSubmit: (e: FormEvent) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <BackLink onClick={props.onBack} />
      <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-cal-soft text-cal">
        <Mail className="size-5" />
      </div>
      <h1 className="font-serif text-[40px] leading-tight">{props.title}</h1>
      <p className="mt-1.5 text-[15px] text-muted">{props.body}</p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={props.onSubmit}>
        <Field label="Code">
          {(id) => (
            <Input
              id={id}
              value={props.code}
              onChange={(e) => props.setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
              className={cn("h-14 text-center font-mono text-[24px] tracking-[0.4em]")}
            />
          )}
        </Field>
        {props.extra}
        <Problem text={props.error} />
        {props.note && <div className="text-[13px] text-pos">{props.note}</div>}
        <Button variant="primary" type="submit" className="h-11" disabled={props.busy || props.code.length < 6 || props.disabled}>
          {props.busy ? "One moment…" : props.submitLabel}
        </Button>
        <button type="button" onClick={props.onResend} className="self-center text-[13px] font-medium text-muted hover:text-ink">
          Didn't get it? Send a new code
        </button>
      </form>
    </>
  );
}
