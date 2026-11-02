# Haven

A calm, personal home for your days and your money. Local-first: all data lives in your browser's storage — use **Settings → Back up** now and then.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

## Modules

| Module    | What it does today |
|-----------|--------------------|
| Today     | Greeting, today's plan (events + auto-scheduled tasks), what's coming up, money snapshot, current book, pinned notes |
| Calendar  | Motion-style planner: tasks with duration, priority, type, deadline (hard/soft), start date, chunking and repeats are auto-scheduled into your work or personal hours around events, re-planned whenever anything changes; at-risk warnings; "Up next"; day/week/month views; drag to move or pin, drag edges to resize; repeating events; meeting buffers |
| Finances  | Accounts, income/expense transactions, categories with monthly budgets, 6-month cashflow, spending breakdown |
| Notes     | Two-pane notes with search, pinning, colors and inline #tags (filterable); empty notes clean themselves up. Morning articles and meeting write-ups are saved here (#reading, #meeting) |
| Library   | Add PDFs and EPUBs (drag & drop); covers, titles and authors extracted; built-in reader (paper / sepia / night) that saves your place, tracks progress, time spent and completion |
| Vault     | Encrypted store for logins, cards, bank accounts, IDs, crypto wallets, Wi-Fi, licenses and secure notes; password generator, security check (weak / reused / expiring), auto-lock, clipboard auto-clear |
| Morning   | Pick your interests; each morning (first time Haven is open after your chosen time) Claude searches the live web and writes a briefing: a lead story plus the top stories per interest, with "why it matters", sources and links. Save articles to Notes. Without an API key, falls back to Hacker News |
| Meetings  | Live transcription (Chrome/Edge speech recognition) or imported transcripts (.vtt/.srt/.txt from Zoom, Meet, Teams); Claude writes the summary, decisions, open questions, action items (mapped to planner tasks with priority, duration, deadline) and scheduled events; one click adds them to your planner, calendar and a Notes page |
| Settings  | Name, light/dark/auto theme, currency, week start, export/import backup, sample data, erase |

## Security model (Vault)

- Your master password is stretched with PBKDF2-SHA256 (600,000 rounds) into an AES-256-GCM key using the browser's WebCrypto. The key exists only in memory while unlocked.
- Only the salt and ciphertext are written to storage (`haven:vault`). Backups contain the vault still encrypted.
- There is no recovery: a forgotten master password means the vault cannot be opened.
- The vault auto-locks after a period of inactivity (default 5 minutes) and on reload. Copied secrets are wiped from the clipboard after 30 seconds.

## AI (Claude)

Morning and Meetings call the Claude API directly from the browser with your own Anthropic API key (Settings → AI), using the official `@anthropic-ai/sdk`. Default model: Claude Opus 5.5 (Sonnet 5.5 selectable). Requests opt into Anthropic's server-side fallback (`fallbacks: "default"`), so if a safety classifier declines a request it is retried on a fallback model instead of failing. The key is stored in this browser only and is not included in backups.

## Storage

Everything is local to this browser. Small data lives in `localStorage` (`haven:*` keys); book files live in IndexedDB (`haven-library`), and the app asks the browser to keep them persistent. Backups include reading progress but not the book files themselves.

## Structure

```
src/
  components/      Shell (navigation) and ui.tsx (design-system primitives)
  lib/             AI client, dates, money (integer cents), sample data, utils
  modules/
    registry.tsx   ← every module is registered here (lazy-loaded); nav + routes follow
    calendar/      store, scheduler (auto-planner), plan hook, time grid, month view, task panel, dialogs
    finances/      store, overview/transactions/budgets/accounts tabs, charts
    notes/         store, list + editor page
    library/       metadata store, IndexedDB files, PDF/EPUB extraction, reader
    vault/         crypto, encrypted store, item kinds, item editor
    feed/          interests store, news gathering (Claude + web search, Hacker News fallback), scheduler
    meetings/      meeting store, speech recognition, transcript import, Claude analysis → tasks/events/pages
  pages/           Today, Settings
  store/           app-wide settings
```

**Adding a module:** create `src/modules/<name>/` with a page component and (if it stores data) a zustand store persisted under `haven:<name>`, then add one entry to `MODULES` in `registry.tsx`. Remember to include its data in Settings export/import.

## Design tokens

Colors are CSS variables in `src/index.css` (`--canvas`, `--surface`, `--ink`, `--cal`, `--fin`, …), redefined under `.dark`. Tailwind exposes them as `bg-surface`, `text-muted`, `border-line`, etc. Display type is Instrument Serif; UI type is Inter.
