## Status (all items below are DONE)

1. **Stale `window.storage` (no auth headers)** — fixed via `main.jsx` wrapper.
2. **Stale test** — `tests/test_model_download.py` rewritten for the current
   backend; new `tests/test_smoke.py` boots the real server and covers
   health, register → approve → login, request filing, duplicate refNumber
   (409), admin-only writes (403s), hashed sessions, and list pagination.
3. **Secrets committed** — `.gitignore` now covers `.env`, `storage.db`,
   `backups/`, `dist/`, `__pycache__/`, `*.pyc`, `models/`; all untracked via
   `git rm --cached` (working files kept). **Still open for the owner:**
   rotate the exposed keys and purge git history — untracking alone is not enough.
4. **No server-side admin enforcement** — `_authorize_official_write()` gates
   announcements, request edits, deletes, and other-official edits on
   `isAdmin`; `/api/update-official` is self-only (`photo/email/fullName`).
5. **Reset code in API response** — emailed via SMTP, never returned
   (`requestReset` no longer reads `res.code`).
6. **`fmtDate` bug** — returns `—` for falsy timestamps.
7. **`server.js` dead weight** — deleted; `npm run server` script removed.

## Go-live hardening (DONE, Sep 2026)

- Backend: `PORT`/`STORAGE_DB_PATH` env support, `ThreadingHTTPServer`,
  `/healthz`, timestamped logging, `FRONTEND_ORIGIN` CORS, `TRUST_PROXY`
  `X-Forwarded-For` IP, optional `REQUIRE_CHAT_AUTH`, SHA-256 session tokens
  with sliding expiry (pre-change sessions invalidated — users re-log in),
  registration salt/hash structure + email checks, `ADMIN_*` bootstrap
  (password + recovery email), unique `refNumber` (409), `/storage/list`
  `limit`/`offset` pagination.
- Frontend: `VITE_API_URL` base for all API calls; production builds never
  fall back to `localStorage` (fail loudly); 6-char minimum on registration;
  SEO meta/OG/favicon; image filenames normalized (`Images/*.jpg`);
  lazily-loaded charts; `ErrorBoundary`; modal dialog semantics + Escape;
  burger `aria-label`; privacy-consent checkbox on request filing.
- Ops: `netlify.toml`, `public/_headers` (CSP/HSTS/frame/caching),
  `scripts/backup_db.sh` (14 newest), `.github/workflows/ci.yml`
  (pytest + build), `.env.example` documents all vars, README rewritten.

## Still needs the site owner (external accounts)

- Backend host + Netlify site + `VITE_API_URL` build var, custom domain/DNS, SMTP SPF/DKIM, CAPTCHA keys, Postgres when SQLite
  outgrows a single host, key rotation + history purge (see #3).

## Commands

- Backend: `python backend.py` (port from `PORT`, default 8000; `/healthz`)
- Frontend dev: `npm run dev` (port 3000, proxies `/api` + `/storage` to 8000)
- Everything at once: `npm start`
- Build: `npm run build` (prod: set `VITE_API_URL` first)
- Tests: `python3 -m pytest tests/ -q`
- Backup: `./scripts/backup_db.sh`
