# BPORTAL — Barangay Kolabtingon Portal

Portal for Barangay Kolabtingon, Dumanjug, Cebu. Residents file and track
barangay requests; officials manage them from an admin dashboard. Includes an
AI chat assistant backed by a local Llama model or a Hugging Face API key.

## Develop locally

1. Install dependencies: `npm install`
2. (Optional, for local chat) `python -m pip install llama-cpp-python` and place a
   GGUF model at `models/` — set `LOCAL_LLAMA_MODEL_PATH` (see `.env.example`).
3. Run the backend: `npm run pyserver` (port 8000, with `/healthz` check)
4. Run the frontend in another terminal: `npm run dev` (port 3000, proxies
   `/api` + `/storage` to the backend)
5. Or both at once: `npm start`

Demo admin: `admin` / `admin123` (seeded into a fresh `storage.db`).

## Your data is safe from code edits

All accounts, requests, and announcements live in `storage.db` — editing
`backend.py` / `java.jsx` in VS Code, restarting, or redeploying never
modifies existing rows. Two things can still *look* like data loss:

1. **Wrong database file.** A relative `STORAGE_DB_PATH` always resolves
   against the backend file's folder, and the backend prints
   `Using database: <path> [...]` on every boot — check the log if accounts
   seem missing.
2. **Host wiped the file.** Render/Railway free tiers have ephemeral disks:
   each redeploy starts from an empty `storage.db` (fresh demo admin only).
   Fix: mount a persistent disk and set `STORAGE_DB_PATH` to it (see the
   commented `disk:` block in `render.yaml`), or restore the automatic boot
   snapshot: every start writes `backups/boot-*.json` (5 newest kept), and data
   changes re-snapshot at most once a minute, so the latest file covers uptime
   work too. `python3 scripts/restore_data.py backups/<snapshot> --db <path>` merges it
   back without deleting newer rows. Nightly full copies: `./scripts/backup_db.sh`.
3. **Resurrected demo admin.** After deleting the demo account, set
   `DISABLE_DEMO_ADMIN=1` (here and on the host) or restarts re-seed it.
   Locked out instead? Restart once with `ADMIN_REPAIR=1` to force the
   `ADMIN_*` env values back onto the admin account, then unset it.

## Test & build

- Tests: `python3 -m pytest tests/ -q` (unit + end-to-end smoke tests)
- Build: `npm run build` (outputs `dist/`)
- DB backup: `./scripts/backup_db.sh` (keeps the 14 newest in `backups/`)

## Going live (Netlify + backend host)

Netlify serves **static files only** — the Python backend must be hosted
separately (Render / Railway / Fly / VPS), then wired together:

1. **Backend host**: deploy `backend.py` with Python 3.12 + `pip install python-dotenv`
   (+ `llama-cpp-python` only if you run the local model there). Set env vars:
   `PORT` (or the host's assigned port — it is respected), `STORAGE_DB_PATH`
   (persistent volume path), `FRONTEND_ORIGIN=https://your-site.netlify.app`,
   `TRUST_PROXY=1`, `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL`,
   `SMTP_*`, and your model key (`DEEPSEEK_API_KEY` or `HF_API_KEY`).
   Optionally set `REQUIRE_CHAT_AUTH=1` so only logged-in users can use chat.
2. **Netlify**: build command `npm run build`, publish directory `dist`, and set
   build env `VITE_API_URL=https://your-backend-host.example.com`.
   `netlify.toml` (SPA fallback) and `public/_headers` (security headers) are
   already in the repo.
3. **After launch**: every login resets to a hashed session token (old sessions
   from before this change are invalid — users simply log in again), and
   production builds never fall back to browser `localStorage` (failed writes
   surface as errors instead).

## Sharing the link on Messenger / Facebook

Tapping a link inside Messenger opens it in Messenger's own mini-browser, not
Chrome/Safari — that is why a shared link seems to "not open directly":

1. Share your **https Netlify URL** (never `localhost`, never the backend URL).
2. In `index.html`, replace every `https://your-site.netlify.app` with your real
   domain, redeploy, then paste the link once into the
   [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
   and press **Scrape Again** so Messenger picks up the title/thumbnail card.
3. Done — visitors who tap the link now see a banner inside Messenger:
   Android gets a one-tap **Open in Chrome** button, iPhone gets the
   tap-⋯ → “Open in Safari” steps.

## Security notes

- Never commit `.env`, `storage.db`, `backups/`, or `models/` — all are git-ignored.
- If secrets or the database were ever committed, **rotate the keys and purge
  git history** (untracking alone is not enough).
- Sessions are SHA-256 hashed server-side with sliding 12h expiry; admin-only
  actions (approvals, announcements, status changes, deletes) are enforced in
  `backend.py`, not just the UI.
