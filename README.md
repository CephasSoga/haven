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
| Today     | Greeting, today's agenda, what's coming up, money snapshot, pinned notes |
| Calendar  | Month & week views, day agenda, create/edit/delete events (timed or all-day, color, location, notes) |
| Finances  | Accounts, income/expense transactions, categories with monthly budgets, 6-month cashflow, spending breakdown |
| Notes     | Two-pane notes with search, pinning, colors and inline #tags (filterable); empty notes clean themselves up |
| Settings  | Name, light/dark/auto theme, currency, week start, export/import backup, sample data, erase |

## Structure

```
src/
  components/      Shell (navigation) and ui.tsx (design-system primitives)
  lib/             dates, money (integer cents), sample data, utils
  modules/
    registry.tsx   ← every module is registered here; nav + routes follow
    calendar/      store, month/week views, event dialog
    finances/      store, overview/transactions/budgets/accounts tabs, charts
    notes/         store, list + editor page
  pages/           Today, Settings
  store/           app-wide settings
```

**Adding a module:** create `src/modules/<name>/` with a page component and (if it stores data) a zustand store persisted under `haven:<name>`, then add one entry to `MODULES` in `registry.tsx`. Remember to include its data in Settings export/import.

## Design tokens

Colors are CSS variables in `src/index.css` (`--canvas`, `--surface`, `--ink`, `--cal`, `--fin`, …), redefined under `.dark`. Tailwind exposes them as `bg-surface`, `text-muted`, `border-line`, etc. Display type is Instrument Serif; UI type is Inter.
