# HANDOFF — where I left off

Last updated: 2026-08-19

## Current state (working)

- Backend `backend.py` (Python, port 8000) rewritten with auth/sessions:
  - `/api/login`, `/api/logout`, `/api/session`, `/api/change-password`
  - `/api/reset-request`, `/api/reset-complete`, `/api/update-official`
  - `/api/track`, `/api/rating`, `/api/chat`
  - `/storage/list|get|set|delete` with auth + prefix access control + rate limits
- Login works. Verified account:
  - `sydrick16` / `Sydrick16` (SK Treasurer, approved)
  - `admin` — password is NOT `admin123`; stored hash doesn't match. Reset via forgot-password (code is returned in the response) or ask to reset.
- `dist/` build is current (built 08:10).

## Pending fixes (open list)

1. **CRITICAL — app loads stale `window.storage` (no auth headers).**
   - `index.html` -> `/src/main.jsx` (old wrapper, no `Authorization` header).
   - The fixed wrapper is at root `main.jsx` (currently dead code).
   - Fix: point `index.html` to `/main.jsx` and delete `src/main.jsx`, `src/App.jsx`, or copy the auth wrapper into `src/main.jsx`.
   - Without this, dashboard storage calls 403 and silently fall back to `localStorage`.

2. **Test is stale.** `tests/test_model_download.py` calls `backend.ensure_local_model()` which no longer exists. Fix or delete the test.

3. **Secrets committed.** `.env` (real HF/DeepSeek keys) is in git. `.gitignore` only has `node_modules`.
   - Add: `.env`, `storage.db`, `dist/`, `__pycache__/`, `models/`.

4. **No server-side admin enforcement.** Any logged-in official can approve/reject others, edit any request status, post/delete announcements (`backend.py` `/storage/set`). Gate admin actions on `isAdmin`.

5. **Reset code returned in API response** (`/api/reset-request`). OK for demo; email/SMS the code for production.

6. **`fmtDate` bug** — `java.jsx:59` returns a stray `”` when `ts` is falsy.

7. **`server.js` is dead weight.** Old Node chat server (port 4000, no dotenv). Redundant now that `backend.py` does chat; not wired into `dev:all`.

## Commands

- Backend: `python backend.py` (port 8000)
- Frontend dev: `npm run dev` (vite, port 3000, proxies `/api` + `/storage` to 8000)
- Everything at once: `npm start` (`dev:all`)
- Build: `npm run build`
- Tests: `python3 -m pytest tests/` (currently failing — see #2)