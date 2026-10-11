# OLV — restaurant accounting / POS (static web app on Supabase)

The owner writes Levantine Arabic. All UI text, comments and README content are in Arabic (Levantine, RTL). Keep new UI strings and code comments in the same style.

## Layout
- `accounting/` — the main app: one plain HTML page per screen (`pos.html`, `sales.html`, `inventory.html`, …) with an inline `<script>`, plus shared browser scripts in `accounting/assets/` loaded with `<script defer>`. No bundler, no framework, no build step. Globals like `window.supabaseClient` come from `assets/supabase-client.js`.
- `accounting/config.js` — Supabase URL + **anon** key only (public by design; security is enforced by RLS and server functions).
- `accounting/schema-*.sql`, `seed-*.sql` — SQL applied by hand in the Supabase SQL Editor (no migration runner). New schema changes go in a new `schema-<topic>.sql` file and must be idempotent (`create … if not exists`, `create or replace`).
- `supabase/functions/*` — Deno edge functions (Gemini AI features, employee management, menu proxy). Secrets come from `Deno.env` only.
- `print-bridge/`, `attendance-bridge/`, `drive-backup/` — small Node programs that run on the restaurant's own PC / in Actions; each has its own README and `.env.example`.
- `index.html` / `olv-menu.html` — the public customer menu (identical copies); `olv-admin.html` edits it.

## Deploy
Every push to `main` deploys the **whole repo** to GitHub Pages (`.github/workflows/static.yml`). So: never commit secrets, service-role keys or `.env` files — anything in the repo is public.

## Checks
- `node scripts/check.mjs` — syntax check of every `.js` file and every inline `<script>` in `.html` (no dependencies). Runs in CI on every PR and automatically after each file edit (hook in `.claude/settings.json`). Pass file paths to check only those.
- There are no unit tests. To verify UI changes, open the page in a browser (Playwright/Chromium is available in cloud sessions); real data needs the live Supabase project.

## Conventions
- Money/stock logic that must not be bypassed (voiding sales, PIN checks, stock deduction) lives in SQL functions with row locks, not in page JavaScript. Don't move it client-side.
- `accounting/sw.js` intentionally caches nothing; keep it that way.
- Mobile-first, RTL; don't add letter-spacing to Arabic text.
- Claude merges its own PRs once CI is green (owner's standing instruction).
- Design system: read `design-system/olv/MASTER.md` (and `design-system/olv/pages/<page>.md` if it exists, which overrides it) before any UI work, and update it when you change a token in `theme.css`. `accounting/style-guide.html` (Settings → دليل التصميم) renders it live. Glass is for navigation/controls only; content stays on opaque cards.
- `ui-ux-pro-max` skill: its SKILL.md calls `python "${CLAUDE_PLUGIN_ROOT}/.claude/skills/..."`; in this repo run `python3 .claude/skills/ui-ux-pro-max/scripts/search.py ...` from the repo root instead. The owner wants it used for every design task. Its palettes/styles are suggestions; the app's look in `theme.css` wins (since 2026-10: warm cream + the OLV logo's gold and olive, light by default, warm dark via the moon button, Tajawal everywhere, no serif font).
- Brand: the owner's permanent logo is `accounting/assets/brand/olv-logo-original.png` (gold OLV + olive branch on black). Use `olv-mark.png` (header) / `olv-logo.png` (login) on a dark tile, never recolor it.
