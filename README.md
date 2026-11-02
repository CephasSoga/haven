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
| Today     | Greeting, today's plan (events + auto-scheduled tasks), what's coming up, money snapshot, current book, favorite pages |
| Calendar  | Motion-style planner: tasks with duration, priority, type, deadline (hard/soft), start date, chunking and repeats are auto-scheduled into your work or personal hours around events, re-planned whenever anything changes; at-risk warnings; "Up next"; day/week/month views; drag to move or pin, drag edges to resize; repeating events; meeting buffers |
| Finances  | Accounts, income/expense transactions, categories with monthly budgets, 6-month cashflow, spending breakdown |
| Notes     | Notion-style pages: nested page tree, icons and covers, favorites, trash with restore, search, breadcrumbs; block editor with `/` commands, drag handles, markdown shortcuts, to-dos, toggles, quotes, code, tables |
| Library   | Add PDFs and EPUBs (drag & drop); covers, titles and authors extracted; built-in reader (paper / sepia / night) that saves your place, tracks progress, time spent and completion |
| Vault     | Encrypted store for logins, cards, bank accounts, IDs, crypto wallets, Wi-Fi, licenses and secure notes; password generator, security check (weak / reused / expiring), auto-lock, clipboard auto-clear |
| Settings  | Name, light/dark/auto theme, currency, week start, export/import backup, sample data, erase |

## Security model (Vault)

- Your master password is stretched with PBKDF2-SHA256 (600,000 rounds) into an AES-256-GCM key using the browser's WebCrypto. The key exists only in memory while unlocked.
- Only the salt and ciphertext are written to storage (`haven:vault`). Backups contain the vault still encrypted.
- There is no recovery: a forgotten master password means the vault cannot be opened.
- The vault auto-locks after a period of inactivity (default 5 minutes) and on reload. Copied secrets are wiped from the clipboard after 30 seconds.

## Storage

Everything is local to this browser. Small data lives in `localStorage` (`haven:*` keys); book files live in IndexedDB (`haven-library`), and the app asks the browser to keep them persistent. Backups include reading progress but not the book files themselves.

## Structure

```
src/
  components/      Shell (navigation) and ui.tsx (design-system primitives)
  lib/             dates, money (integer cents), sample data, utils
  modules/
    registry.tsx   ← every module is registered here (lazy-loaded); nav + routes follow
    calendar/      store, scheduler (auto-planner), plan hook, time grid, month view, task panel, dialogs
    finances/      store, overview/transactions/budgets/accounts tabs, charts
    notes/         page store, page tree, block editor (BlockNote), icon/cover pickers
    library/       metadata store, IndexedDB files, PDF/EPUB extraction, reader
    vault/         crypto, encrypted store, item kinds, item editor
  pages/           Today, Settings
  store/           app-wide settings
```

**Adding a module:** create `src/modules/<name>/` with a page component and (if it stores data) a zustand store persisted under `haven:<name>`, then add one entry to `MODULES` in `registry.tsx`. Remember to include its data in Settings export/import.

## Design tokens

Colors are CSS variables in `src/index.css` (`--canvas`, `--surface`, `--ink`, `--cal`, `--fin`, …), redefined under `.dark`. Tailwind exposes them as `bg-surface`, `text-muted`, `border-line`, etc. Display type is Instrument Serif; UI type is Inter.
