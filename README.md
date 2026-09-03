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

## Security notes

- Never commit `.env`, `storage.db`, `backups/`, or `models/` — all are git-ignored.
- If secrets or the database were ever committed, **rotate the keys and purge
  git history** (untracking alone is not enough).
- Sessions are SHA-256 hashed server-side with sliding 12h expiry; admin-only
  actions (approvals, announcements, status changes, deletes) are enforced in
  `backend.py`, not just the UI.
