import { useRef, useState, type ReactNode } from "react";
import { ask } from "@/components/confirm";
import { Check, Download, Eye, EyeOff, Monitor, Moon, Sparkles, Sun, Upload } from "lucide-react";
import { Button, Card, Input, PageHeader, Segmented, Select, Switch } from "@/components/ui";
import { sampleEvents, sampleFinances, sampleNotes, sampleTasks } from "@/lib/sample";
import { useSettings, type Theme } from "@/store/settings";
import { useCalendar } from "@/modules/calendar/store";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, useFinance } from "@/modules/finances/store";
import { fromPages, useNotes } from "@/modules/notes/store";
import { readVaultFile, useVault } from "@/modules/vault/store";
import { useLibrary } from "@/modules/library/store";
import { clearFiles } from "@/modules/library/files";
import { useFeed } from "@/modules/feed/store";
import { useMeetings } from "@/modules/meetings/store";
import { useSubscriptions } from "@/modules/subscriptions/store";
import { AI_MODELS, explain, testConnection, useAi, type AiModel } from "@/lib/ai";
import { AuthProblem, changePassword, cloudEnabled, endSession, useAuth } from "@/lib/cloud";
import { signOutAndClear, syncNow, useSync } from "@/lib/sync";
import { formatDistanceToNowStrict } from "date-fns";
import { BellRing, CloudCheck, CloudOff, LogOut, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { askNotificationPermission, notificationPermission, notify, type Permission } from "@/lib/notify";
import { APP_VERSION, inApp, onAndroid } from "@/lib/platform";
import { RELEASES, canUpdate, checkForUpdate, installUpdate, useUpdates } from "@/lib/updates";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "XAF", "XOF", "NGN", "MAD", "JPY"];

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line px-6 py-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-[13px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{title}</h2>
      <Card>{children}</Card>
    </section>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const calendar = useCalendar();
  const finance = useFinance();
  const notes = useNotes();
  const vault = useVault();
  const library = useLibrary();
  const feed = useFeed();
  const meetings = useMeetings();
  const subscriptions = useSubscriptions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(null), 3500);
  };

  const exportData = () => {
    const data = {
      app: "haven",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { name: settings.name, theme: settings.theme, currency: settings.currency, weekStartsOn: settings.weekStartsOn },
      calendar: { events: calendar.events, tasks: calendar.tasks, prefs: calendar.prefs },
      finances: { accounts: finance.accounts, categories: finance.categories, transactions: finance.transactions, rules: finance.rules, bills: finance.bills },
      notes: { notes: notes.notes },
      // Already encrypted — the backup never contains vault contents in the clear.
      vault: readVaultFile(),
      // Shelf and reading progress; the book files themselves stay in this browser.
      library: { books: library.books },
      feed: { interests: feed.interests, time: feed.time, perInterest: feed.perInterest, auto: feed.auto, editions: feed.editions },
      meetings: { meetings: meetings.meetings },
      subscriptions: { subs: subscriptions.subs, dismissed: subscriptions.dismissed },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `haven-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash("Backup downloaded.");
  };

  const importData = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "haven") throw new Error("Not a Haven backup");
      if (!(await ask({ title: "Restore this backup?", body: "Everything in Haven will be replaced with the contents of the backup file.", confirmLabel: "Restore", danger: true }))) return;
      if (data.settings) settings.set(data.settings);
      calendar.replaceAll({ events: data.calendar?.events ?? [], tasks: data.calendar?.tasks ?? [], prefs: data.calendar?.prefs });
      finance.replaceAll({
        accounts: data.finances?.accounts ?? DEFAULT_ACCOUNTS,
        categories: data.finances?.categories ?? DEFAULT_CATEGORIES,
        transactions: data.finances?.transactions ?? [],
        rules: data.finances?.rules ?? [],
        bills: data.finances?.bills ?? [],
      });
      // Backups made while Notes used block pages hold `pages`; convert them back to notes.
      notes.replaceAll(data.notes?.notes ?? fromPages(data.notes?.pages ?? []));
      if (data.vault?.app === "haven-vault") vault.restore(data.vault);
      if (data.library?.books) library.replaceAll(data.library.books);
      if (data.feed) useFeed.setState({ ...data.feed, running: false, error: null });
      if (data.meetings?.meetings) meetings.replaceAll(data.meetings.meetings);
      if (data.subscriptions?.subs) useSubscriptions.setState({ subs: data.subscriptions.subs, dismissed: data.subscriptions.dismissed ?? [] });
      flash("Backup restored.");
    } catch (e) {
      flash(`Couldn't read that file: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader eyebrow="Haven" title="Settings" />

      {cloudEnabled && <AccountSection />}

      <Section title="You">
        <Row title="Your name" hint="Used to greet you on the Today page">
          <Input value={settings.name} onChange={(e) => settings.set({ name: e.target.value })} placeholder="Your name" className="sm:w-60" />
        </Row>
      </Section>

      <RemindersSection />

      <AiSection />

      <Section title="Appearance">
        <Row title="Theme">
          <Segmented<Theme>
            layoutId="theme"
            value={settings.theme}
            onChange={(theme) => settings.set({ theme })}
            options={[
              { value: "light", label: <><Sun className="size-3.5" /> Light</> },
              { value: "dark", label: <><Moon className="size-3.5" /> Dark</> },
              { value: "system", label: <><Monitor className="size-3.5" /> Auto</> },
            ]}
          />
        </Row>
      </Section>

      <Section title="Preferences">
        <Row title="Currency" hint="How amounts are displayed">
          <Select value={settings.currency} onChange={(e) => settings.set({ currency: e.target.value })} className="sm:w-40">
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Row>
        <Row title="Week starts on">
          <Segmented
            layoutId="week-start"
            value={String(settings.weekStartsOn)}
            onChange={(v) => settings.set({ weekStartsOn: Number(v) as 0 | 1 })}
            options={[
              { value: "1", label: "Monday" },
              { value: "0", label: "Sunday" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Your data">
        <Row title="Back up" hint="Your data lives only in this browser. The backup includes your vault (still encrypted) and reading progress, but not book files.">
          <Button onClick={exportData}>
            <Download className="size-4" /> Export
          </Button>
        </Row>
        <Row title="Restore" hint="Replace everything with a backup file">
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Import
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importData(f);
              e.target.value = "";
            }}
          />
        </Row>
        <Row title="Sample data" hint="Fill Haven with realistic examples to explore">
          <Button
            onClick={async () => {
              if (!(await ask({ title: "Load sample data?", body: "Your calendar, finances and notes will be replaced with sample data.", confirmLabel: "Load samples", danger: true }))) return;
              finance.replaceAll(sampleFinances());
              calendar.replaceAll({ events: sampleEvents(new Date(), settings.weekStartsOn), tasks: sampleTasks() });
              notes.replaceAll(sampleNotes());
              flash("Sample data loaded.");
            }}
          >
            Load samples
          </Button>
        </Row>
        <Row title="Erase everything" hint={cloudEnabled ? "Deletes everything — calendar, finances, notes, vault, library — from your account and all your devices" : "Deletes everything: calendar, finances, notes, your vault and your library"}>
          <Button
            variant="danger"
            onClick={async () => {
              if (!(await ask({ title: "Erase everything?", body: "All of your Haven data will be deleted from this browser, including your vault and library. Export a backup first if you might want it back.", confirmLabel: "Erase everything", danger: true }))) return;
              calendar.replaceAll({ events: [], tasks: [] });
              notes.replaceAll([]);
              vault.restore(null);
              library.replaceAll([]);
              meetings.replaceAll([]);
              useSubscriptions.setState({ subs: [], dismissed: [] });
              useFeed.setState({ interests: [], editions: [], error: null });
              clearFiles();
              finance.replaceAll({ accounts: DEFAULT_ACCOUNTS, categories: DEFAULT_CATEGORIES, transactions: [] });
              flash("All data erased.");
            }}
          >
            Erase
          </Button>
        </Row>
      </Section>

      <AboutSection />

      {message && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-on-primary shadow-float md:bottom-8">
          {message}
        </div>
      )}
    </div>
  );
}

function AiSection() {
  const { apiKey, model, set } = useAi();
  const [shown, setShown] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  return (
    <Section title="AI">
      <div className="flex gap-3 border-b border-line px-6 py-5 text-[13px] leading-relaxed text-muted">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-cal" />
        <p>
          The Meeting assistant uses Claude, and the Morning feed can add a written overview with it. Add your own Anthropic API key (from console.anthropic.com). It stays in this
          browser and requests go straight to Anthropic; usage is billed to your Anthropic account — a meeting summary is typically a few cents.
        </p>
      </div>
      <Row title="API key" hint={apiKey ? "Saved on this device" : "Not set"}>
        <div className="flex gap-2">
          <div className="relative sm:w-72">
            <Input
              type={shown ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                set({ apiKey: e.target.value });
                setStatus(null);
              }}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              className="pr-10 font-mono text-[13px]"
            />
            <button onClick={() => setShown(!shown)} aria-label={shown ? "Hide key" : "Show key"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-faint hover:text-ink">
              {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <Button
            disabled={!apiKey.trim() || testing}
            onClick={async () => {
              setTesting(true);
              try {
                await testConnection();
                setStatus({ ok: true, text: "Connected" });
              } catch (e) {
                setStatus({ ok: false, text: explain(e) });
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "Testing…" : "Test"}
          </Button>
        </div>
        {status && (
          <div className={`mt-2 flex items-center gap-1.5 text-[13px] ${status.ok ? "text-pos" : "text-neg"}`}>
            {status.ok && <Check className="size-3.5" />} {status.text}
          </div>
        )}
      </Row>
      <Row title="Model" hint="Opus is the most capable; Sonnet is faster and cheaper">
        <Select value={model} onChange={(e) => set({ model: e.target.value as AiModel })} className="sm:w-60">
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.hint}
            </option>
          ))}
        </Select>
      </Row>
    </Section>
  );
}

function AccountSection() {
  const account = useAuth((s) => s.account);
  const sync = useSync();
  const [pw, setPw] = useState("");
  const [pwState, setPwState] = useState<{ ok: boolean; text: string } | null>(null);
  if (!account) return null;

  const status =
    sync.phase === "syncing"
      ? { icon: <RefreshCw className="size-4 animate-spin" />, text: "Syncing…", tone: "text-muted" }
      : sync.phase === "offline"
        ? { icon: <CloudOff className="size-4" />, text: "Offline — your changes will sync when you're back online", tone: "text-[#b7791f]" }
        : sync.phase === "error"
          ? { icon: <CloudOff className="size-4" />, text: `Couldn't sync${sync.message ? `: ${sync.message}` : ""}. Haven will keep trying.`, tone: "text-neg" }
          : { icon: <CloudCheck className="size-4" />, text: sync.lastSync ? `Everything is synced · ${formatDistanceToNowStrict(sync.lastSync, { addSuffix: true })}` : "Everything is synced", tone: "text-pos" };

  return (
    <Section title="Account">
      <div className="flex items-center gap-4 border-b border-line px-6 py-5">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c6cff] to-[#1f9e85] font-serif text-2xl text-white">
          {(account.name || account.email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{account.name || "Signed in"}</div>
          <div className="truncate text-[13px] text-muted">{account.email}</div>
        </div>
      </div>
      <Row title="Sync" hint="Your data follows you to every device you sign in on">
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-[13px] ${status.tone}`}>
            {status.icon} {status.text}
          </span>
          <Button size="sm" onClick={() => void syncNow()} disabled={sync.phase === "syncing"}>
            Sync now
          </Button>
        </div>
      </Row>
      <Row title="Password">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await changePassword(pw);
              setPw("");
              setPwState({ ok: true, text: "Password changed" });
            } catch (err) {
              setPwState({ ok: false, text: err instanceof AuthProblem ? err.message : String(err) });
            }
          }}
        >
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" className="sm:w-60" />
          <Button type="submit" disabled={pw.length < 8}>
            Change
          </Button>
        </form>
        {pwState && <div className={`mt-2 text-[13px] ${pwState.ok ? "text-pos" : "text-neg"}`}>{pwState.text}</div>}
      </Row>
      <Row title="Sign out" hint="Your data stays in your account; it's removed from this device until you sign in again">
        <Button
          onClick={async () => {
            if (!(await ask({ title: "Sign out?", body: "Haven saves any pending changes to your account, then removes your data from this device. Sign in again to get it back.", confirmLabel: "Sign out" })))
              return;
            await signOutAndClear(endSession);
          }}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </Row>
    </Section>
  );
}

const LEADS: { value: string; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "0", label: "When they start" },
  { value: "5", label: "5 minutes before" },
  { value: "10", label: "10 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
];

function RemindersSection() {
  const prefs = useSettings((s) => s.reminders);
  const set = useSettings((s) => s.set);
  const [permission, setPermission] = useState<Permission | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    void notificationPermission().then(setPermission);
  }, []);
  const patch = (p: Partial<typeof prefs>) => set({ reminders: { ...prefs, ...p } });

  const where = inApp
    ? onAndroid
      ? "Scheduled on your phone, so they arrive even when Haven is closed."
      : "They arrive while Haven is open (it can stay minimized)."
    : "They arrive while Haven is open in this browser.";

  return (
    <Section title="Reminders">
      <Row
        title="Notifications"
        hint={
          permission === "denied"
            ? "Blocked. Allow notifications for Haven in your system or browser settings."
            : permission === "unsupported"
              ? "This browser can't show notifications."
              : where
        }
      >
        {permission === "granted" ? (
          <Button
            size="sm"
            onClick={async () => {
              await notify("Haven reminders are on", "This is what a reminder looks like.");
              setSent(true);
              setTimeout(() => setSent(false), 2500);
            }}
          >
            {sent ? <Check className="size-4" /> : <BellRing className="size-4" />} {sent ? "Sent" : "Send a test"}
          </Button>
        ) : permission === "default" ? (
          <Button size="sm" variant="primary" onClick={async () => setPermission(await askNotificationPermission())}>
            <BellRing className="size-4" /> Allow notifications
          </Button>
        ) : null}
      </Row>
      <Row title="Events" hint="Calendar events with a start time">
        <Select value={prefs.events === null ? "off" : String(prefs.events)} onChange={(e) => patch({ events: e.target.value === "off" ? null : Number(e.target.value) })} className="sm:w-52">
          {LEADS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row title="Planned tasks" hint="When the planner has scheduled a task to start">
        <Switch checked={prefs.tasks} onChange={(tasks) => patch({ tasks })} label={prefs.tasks ? "On" : "Off"} />
      </Row>
      <Row title="Bills" hint="At 9:00 on the day a bill is due">
        <Switch checked={prefs.bills} onChange={(bills) => patch({ bills })} label={prefs.bills ? "On" : "Off"} />
      </Row>
      <Row title="Subscriptions" hint="At 9:00 the day before a renewal or the end of a free trial">
        <Switch checked={prefs.subscriptions} onChange={(subscriptions) => patch({ subscriptions })} label={prefs.subscriptions ? "On" : "Off"} />
      </Row>
    </Section>
  );
}

function AboutSection() {
  const { phase, available, progress, message } = useUpdates();
  const status =
    phase === "checking"
      ? "Checking…"
      : phase === "current"
        ? "You have the latest version"
        : phase === "available" && available
          ? `Haven ${available.version} is available`
          : phase === "downloading"
            ? `Downloading… ${Math.round(progress * 100)}%`
            : phase === "error"
              ? `Couldn't check: ${message}`
              : inApp
                ? onAndroid
                  ? "Haven checks for new versions and lets you know"
                  : "Haven checks for new versions and installs them when you say so"
                : "Running in the browser — always the latest version";

  return (
    <Section title="About">
      <Row title={`Haven ${APP_VERSION === "dev" ? "(local build)" : APP_VERSION}`} hint={status}>
        {canUpdate ? (
          phase === "available" ? (
            <Button size="sm" variant="primary" onClick={() => void installUpdate()}>
              <Download className="size-4" /> {onAndroid ? "Download" : "Update now"}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void checkForUpdate()} disabled={phase === "checking" || phase === "downloading"}>
              <RefreshCw className={`size-4 ${phase === "checking" ? "animate-spin" : ""}`} /> Check for updates
            </Button>
          )
        ) : (
          <a href={RELEASES} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-cal hover:underline">
            Download the apps
          </a>
        )}
      </Row>
    </Section>
  );
}
