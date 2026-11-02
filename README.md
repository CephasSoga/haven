# Haven

A calm, personal home for your days and your money. Local-first: all data lives in your browser's storage — use **Settings → Back up** now and then.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

## Installable apps (Windows .exe, Android .apk)

The installers are built on GitHub's machines by `.github/workflows/build-apps.yml` (Tauri 2) — nothing needs to be installed locally. Run **Actions → Build apps → Run workflow** (or push a tag like `v0.2.0`); when it finishes, the `.exe` and `.apk` are attached to a new Release.

- **Windows:** self-contained installer (bundles the WebView2 runtime), installs per user. It isn't code-signed, so SmartScreen asks once: *More info → Run anyway*.
- **Android:** 64-bit ARM phones. Signed with the key stored in the repository secrets `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD`, so new builds update the installed app without losing its data.
- In the apps, the Morning feed fetches news natively (no local server), and Meetings transcribes on the device. Listening to meeting audio (Headphones mode) is desktop-only.
- Each device keeps its own data; move it with Settings → Export / Import.

## Modules

| Module    | What it does today |
|-----------|--------------------|
| Today     | Greeting, today's plan (events + auto-scheduled tasks), what's coming up, money snapshot, current book, pinned notes |
| Calendar  | Motion-style planner: tasks with duration, priority, type, deadline (hard/soft), start date, chunking and repeats are auto-scheduled into your work or personal hours around events, re-planned whenever anything changes; at-risk warnings; "Up next"; day/week/month views; drag to move or pin, drag edges to resize; repeating events; meeting buffers |
| Finances  | Accounts, income/expense transactions, categories with monthly budgets, 6-month cashflow, spending breakdown. Statement import (CSV with automatic column detection, OFX/QFX, QIF, CAMT.053): skips lines already imported, flags ones you typed by hand, tidies bank descriptions, auto-categorizes (learned rules → built-in merchant list → optional Claude) and remembers each bank's CSV layout |
| Subscriptions | The paid online services you're subscribed to: price and billing cycle, next renewal, free trials (with end dates), payment method, category; monthly and yearly totals with a breakdown; one-tap add for well-known services; spots recurring charges in your imported bank transactions; Today warns about renewals and trials ending within a week |
| Notes     | Two-pane notes with search, pinning, colors and inline #tags (filterable); empty notes clean themselves up. Morning articles and meeting write-ups are saved here (#reading, #meeting) |
| Library   | Add PDFs and EPUBs (drag & drop); covers, titles and authors extracted; built-in reader (paper / sepia / night) that saves your place, tracks progress, time spent and completion |
| Vault     | Encrypted store for logins, cards, bank accounts, IDs, crypto wallets, Wi-Fi, licenses and secure notes; password generator, security check (weak / reused / expiring), auto-lock, clipboard auto-clear |
| Morning   | A morning newspaper with no account or key: reads Google News and Bing News (and any RSS/Atom feeds you add) for your region and language, merges reports of the same story, ranks by how many outlets cover it, prominence and recency, and lays out a lead story, Top stories, topic sections and your interests, with pictures, summaries and "covered by N outlets". Prepared automatically each morning; save articles to Notes. Optional: Claude writes an "In brief" overview |
| Meetings  | Two ways to listen: Microphone (browser speech recognition) or Headphones (your mic + the meeting's own audio from a shared tab or the system, transcribed on-device by Whisper, with "You"/"Them" labels). Or import .vtt/.srt/.txt transcripts from Zoom, Meet, Teams. Claude writes the summary, decisions, open questions, action items (mapped to planner tasks) and scheduled events; one click adds them to your planner, calendar and a #meeting note. Recording needs Chrome or Edge (not an embedded preview browser) |
| Settings  | Name, light/dark/auto theme, currency, week start, export/import backup, sample data, erase |

## Security model (Vault)

- Your master password is stretched with PBKDF2-SHA256 (600,000 rounds) into an AES-256-GCM key using the browser's WebCrypto. The key exists only in memory while unlocked.
- Only the salt and ciphertext are written to storage (`haven:vault`). Backups contain the vault still encrypted.
- There is no recovery: a forgotten master password means the vault cannot be opened.
- The vault auto-locks after a period of inactivity (default 5 minutes) and on reload. Copied secrets are wiped from the clipboard after 30 seconds.

## AI (Claude)

The Meeting assistant (and, optionally, the Morning overview) call the Claude API directly from the browser with your own Anthropic API key (Settings → AI), using the official `@anthropic-ai/sdk`. Default model: Claude Opus 5.5 (Sonnet 5.5 selectable). Requests opt into Anthropic's server-side fallback (`fallbacks: "default"`), so if a safety classifier declines a request it is retried on a fallback model instead of failing. The key is stored in this browser only and is not included in backups.

## Local news fetcher

Browsers can't read most news feeds directly, so Haven's own dev/preview server includes a small fetcher (`server/feedProxy.ts`, endpoint `/api/feed`). It only fetches public http(s) addresses, only returns RSS/Atom/XML, and requires a header other websites can't send. Run Haven with `npm run dev` (or `npm run build && npm run preview`) for the Morning feed to work.

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
    finances/      store, overview/transactions/budgets/accounts tabs, charts, statement importers, categorization
    subscriptions/ store (cycles, renewals, totals), service catalog, recurring-charge detection, page
    notes/         store, list + editor page
    library/       metadata store, IndexedDB files, PDF/EPUB extraction, reader
    vault/         crypto, encrypted store, item kinds, item editor
    feed/          interests store, news gathering (Claude + web search, Hacker News fallback), scheduler
    meetings/      meeting store, speech recognition, transcript import, Claude analysis → tasks/events/pages
  pages/           Today, Settings
src-tauri/         desktop & Android app shell (Tauri 2)
server/            local news fetcher used by the dev/preview server
  store/           app-wide settings
```

**Adding a module:** create `src/modules/<name>/` with a page component and (if it stores data) a zustand store persisted under `haven:<name>`, then add one entry to `MODULES` in `registry.tsx`. Remember to include its data in Settings export/import.

## Design tokens

Colors are CSS variables in `src/index.css` (`--canvas`, `--surface`, `--ink`, `--cal`, `--fin`, …), redefined under `.dark`. Tailwind exposes them as `bg-surface`, `text-muted`, `border-line`, etc. Display type is Instrument Serif; UI type is Inter.
