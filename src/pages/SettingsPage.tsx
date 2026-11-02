import { useRef, useState, type ReactNode } from "react";
import { Download, Monitor, Moon, Sun, Upload } from "lucide-react";
import { Button, Card, Input, PageHeader, Segmented, Select } from "@/components/ui";
import { sampleEvents, sampleFinances, samplePages, sampleTasks } from "@/lib/sample";
import { useSettings, type Theme } from "@/store/settings";
import { useCalendar } from "@/modules/calendar/store";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, useFinance } from "@/modules/finances/store";
import { fromLegacy, useNotes } from "@/modules/notes/store";
import { readVaultFile, useVault } from "@/modules/vault/store";
import { useLibrary } from "@/modules/library/store";
import { clearFiles } from "@/modules/library/files";

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
      finances: { accounts: finance.accounts, categories: finance.categories, transactions: finance.transactions },
      notes: { pages: notes.pages },
      // Already encrypted — the backup never contains vault contents in the clear.
      vault: readVaultFile(),
      // Shelf and reading progress; the book files themselves stay in this browser.
      library: { books: library.books },
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
      if (!confirm("Replace everything in Haven with this backup?")) return;
      if (data.settings) settings.set(data.settings);
      calendar.replaceAll({ events: data.calendar?.events ?? [], tasks: data.calendar?.tasks ?? [], prefs: data.calendar?.prefs });
      finance.replaceAll({
        accounts: data.finances?.accounts ?? DEFAULT_ACCOUNTS,
        categories: data.finances?.categories ?? DEFAULT_CATEGORIES,
        transactions: data.finances?.transactions ?? [],
      });
      // Backups from before pages existed hold plain notes; upgrade them on the way in.
      notes.replaceAll(data.notes?.pages ?? (data.notes?.notes ?? []).map(fromLegacy));
      if (data.vault?.app === "haven-vault") vault.restore(data.vault);
      if (data.library?.books) library.replaceAll(data.library.books);
      flash("Backup restored.");
    } catch (e) {
      flash(`Couldn't read that file: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader eyebrow="Haven" title="Settings" />

      <Section title="You">
        <Row title="Your name" hint="Used to greet you on the Today page">
          <Input value={settings.name} onChange={(e) => settings.set({ name: e.target.value })} placeholder="Your name" className="sm:w-60" />
        </Row>
      </Section>

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
            onClick={() => {
              if (!confirm("Replace your calendar, finances and notes with sample data?")) return;
              finance.replaceAll(sampleFinances());
              calendar.replaceAll({ events: sampleEvents(new Date(), settings.weekStartsOn), tasks: sampleTasks() });
              notes.replaceAll(samplePages());
              flash("Sample data loaded.");
            }}
          >
            Load samples
          </Button>
        </Row>
        <Row title="Erase everything" hint="Deletes everything: calendar, finances, notes, your vault and your library">
          <Button
            variant="danger"
            onClick={() => {
              if (!confirm("Erase all of your Haven data? Export a backup first if you might want it back.")) return;
              calendar.replaceAll({ events: [], tasks: [] });
              notes.replaceAll([]);
              vault.restore(null);
              library.replaceAll([]);
              clearFiles();
              finance.replaceAll({ accounts: DEFAULT_ACCOUNTS, categories: DEFAULT_CATEGORIES, transactions: [] });
              flash("All data erased.");
            }}
          >
            Erase
          </Button>
        </Row>
      </Section>

      {message && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-on-primary shadow-float md:bottom-8">
          {message}
        </div>
      )}
    </div>
  );
}
