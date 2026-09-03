from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import datetime
import ipaddress
import json
import os
import time
import base64
import hashlib
import secrets
import smtplib
import sqlite3
import sys
import threading
from collections import defaultdict
from email.message import EmailMessage
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

DB_PATH = os.environ.get('STORAGE_DB_PATH', os.path.join(os.path.dirname(__file__), 'storage.db'))
PORT = int(os.environ.get('PORT', '8000') or 8000)
# Production frontend origin for CORS. Defaults to '*' for local dev only.
FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN', '*')
# The backend almost always runs behind Render / Netlify / a load balancer, so
# proxy headers are trusted by default — otherwise every visitor looks like one
# IP, shares a single rate-limit bucket, and trips 429s together. Set
# TRUST_PROXY=0 only when the backend is directly exposed to the internet and
# you want to ignore a possibly spoofed X-Forwarded-For header.
_TRUST_PROXY_RAW = os.environ.get('TRUST_PROXY', '').strip().lower()
TRUST_PROXY = _TRUST_PROXY_RAW not in ('0', 'false', 'no', 'off')
# Set REQUIRE_CHAT_AUTH=1 to require a logged-in session for /api/chat
# (recommended in production so anonymous visitors can't burn model quota).
REQUIRE_CHAT_AUTH = os.environ.get('REQUIRE_CHAT_AUTH', '').lower() in ('1', 'true', 'yes')
HF_MODEL = os.environ.get('HF_MODEL', 'meta-llama/Llama-2-7b-chat-hf')
HF_API_KEY = os.environ.get('HF_API_KEY', '')
DEEPSEEK_MODEL = os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat')
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
SMTP_HOST = os.environ.get('SMTP_HOST', '')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587') or 587)
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
SMTP_FROM = os.environ.get('SMTP_FROM', '')
LOCAL_LLAMA_MODEL_PATH = os.environ.get(
    'LOCAL_LLAMA_MODEL_PATH',
    os.path.join(os.path.dirname(__file__), 'models', 'Llama-2-7b-chat.gguf')
)
HAS_LOCAL_LLAMA_MODEL = os.path.isfile(LOCAL_LLAMA_MODEL_PATH)

LOCAL_LLAMA = None
LOCAL_LLAMA_ERROR = None
try:
    from llama_cpp import Llama
    if os.path.isfile(LOCAL_LLAMA_MODEL_PATH):
        LOCAL_LLAMA = Llama(model_path=LOCAL_LLAMA_MODEL_PATH)
    else:
        LOCAL_LLAMA_ERROR = (
            f'Local Llama model not found at {LOCAL_LLAMA_MODEL_PATH}. '
            'Download a compatible GGUF model and set LOCAL_LLAMA_MODEL_PATH.'
        )
except ImportError:
    LOCAL_LLAMA_ERROR = (
        'Install llama-cpp-python with `pip install llama-cpp-python` to use a local Llama runtime.'
    )
except Exception as exc:
    LOCAL_LLAMA_ERROR = f'Local Llama initialization failed: {exc}'

_db_lock = threading.RLock()

_raw_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
# Concurrency for a hall of ~15-20 simultaneous users: WAL lets readers run
# alongside the single writer, busy_timeout turns momentary contention into a
# short wait instead of 'database is locked', and NORMAL sync keeps WAL fast
# (backups use the SQLite backup API, which is WAL-safe).
_raw_conn.execute('PRAGMA journal_mode = WAL')
_raw_conn.execute('PRAGMA busy_timeout = 5000')
_raw_conn.execute('PRAGMA synchronous = NORMAL')
_raw_conn.execute('PRAGMA foreign_keys = ON')


class _Rows(list):
    """Eagerly-fetched result rows (supports the fetchone/fetchall calls used
    throughout the handlers). Materializing rows inside the lock means no
    cursor is ever touched by two threads at once."""

    def fetchone(self):
        return self[0] if self else None

    def fetchall(self):
        return list(self)


class _LockedConnection:
    """Serialize all SQLite access across handler threads.

    ThreadingHTTPServer runs each request on its own thread, but a pysqlite
    connection (and its cursors) must not be used concurrently: one thread
    reading a cursor while another executes is an InterfaceError and drops
    the response. So SELECTs are executed *and fully fetched* under one lock
    and callers only ever touch the detached _Rows. Every operation here is a
    few milliseconds, so one lock easily serves 15-20 simultaneous users.
    Transaction blocks (`with conn:`) keep sqlite3 semantics: commit on
    success, rollback on error — just held under the lock for their duration.
    """

    def __init__(self, inner):
        self._inner = inner
        self._lock = _db_lock

    def execute(self, *args, **kwargs):
        with self._lock:
            cur = self._inner.execute(*args, **kwargs)
            if cur.description is None:
                return _Rows()
            return _Rows(cur.fetchall())

    def executemany(self, *args, **kwargs):
        with self._lock:
            return self._inner.executemany(*args, **kwargs)

    def commit(self):
        with self._lock:
            return self._inner.commit()

    def rollback(self):
        with self._lock:
            return self._inner.rollback()

    def __enter__(self):
        self._lock.acquire()
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self._inner.commit()
            else:
                self._inner.rollback()
        finally:
            self._lock.release()
        return False

    def __getattr__(self, name):
        return getattr(self._inner, name)


conn = _LockedConnection(_raw_conn)

with conn:
    conn.execute('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

# --------------------------------------------------------------------------- #
#  Security helpers                                                           #
# --------------------------------------------------------------------------- #
SESSION_TTL = 12 * 60 * 60          # session lifetime
MAX_VALUE_BYTES = 256 * 1024        # max stored value size
PBKDF2_ITERATIONS = 100000          # must match the frontend hashing settings

def _env_int(name, default):
    try:
        val = int(os.environ.get(name, '') or default)
        return val if val > 0 else default
    except (ValueError, TypeError):
        return default

# Per-scope rate limits: scope -> (limit, window_seconds). Each is
# env-overridable (e.g. RATE_LIMIT_TRACK / RATE_LIMIT_TRACK_WINDOW).
# Defaults are sized for a small public site where many visitors may share one
# egress IP (barangay hall, schools): anonymous filing + feedback +
# registration share 'set', and the ticket tracker polls in the background so
# 'track' is roomy. Legit users should never see a 429.
RATE_LIMITS = {
    'set': (_env_int('RATE_LIMIT_SET', 120), _env_int('RATE_LIMIT_SET_WINDOW', 60)),
    'chat': (_env_int('RATE_LIMIT_CHAT', 120), _env_int('RATE_LIMIT_CHAT_WINDOW', 60)),
    'login': (_env_int('RATE_LIMIT_LOGIN', 120), _env_int('RATE_LIMIT_LOGIN_WINDOW', 300)),
    'reset': (_env_int('RATE_LIMIT_RESET', 10), _env_int('RATE_LIMIT_RESET_WINDOW', 900)),
    'track': (_env_int('RATE_LIMIT_TRACK', 300), _env_int('RATE_LIMIT_TRACK_WINDOW', 60)),
    'rating': (_env_int('RATE_LIMIT_RATING', 300), _env_int('RATE_LIMIT_RATING_WINDOW', 60)),
}

# Login throttle (env-overridable). Two layers so legit users never notice:
#  - per-IP: generous, counts every attempt (bot protection for shared office IPs).
#  - per-account failures: only WRONG passwords consume quota; correct logins
#    clear both buckets. Typos never lock you out — only sustained guessing does.
LOGIN_IP_LIMIT = _env_int('LOGIN_IP_LIMIT', RATE_LIMITS['login'][0])
LOGIN_IP_WINDOW = _env_int('LOGIN_IP_WINDOW', RATE_LIMITS['login'][1])
LOGIN_FAIL_LIMIT = _env_int('LOGIN_FAIL_LIMIT', 20)
LOGIN_FAIL_WINDOW = _env_int('LOGIN_FAIL_WINDOW', 900)

_rate_buckets = defaultdict(list)
_rate_calls = 0


def _maybe_sweep_rate_buckets():
    """Bound memory: drop long-expired buckets every so often so the in-memory
    throttle map can't grow without bound on a long-lived server."""
    global _rate_calls
    _rate_calls += 1
    if len(_rate_buckets) <= 5000 or _rate_calls % 500 != 0:
        return
    now = time.time()
    for key in list(_rate_buckets):
        bucket = _rate_buckets[key]
        bucket[:] = [t for t in bucket if t > now - 3600]
        if not bucket:
            _rate_buckets.pop(key, None)


def _clear_rate_limit(scope, key):
    _rate_buckets.pop(f'{scope}:{key}', None)


def _bucket_hits(scope, key, window):
    _maybe_sweep_rate_buckets()
    now = time.time()
    bucket = _rate_buckets.setdefault(f'{scope}:{key}', [])
    bucket[:] = [t for t in bucket if t > now - window]
    return bucket


def _rate_retry_after(scope, key, window):
    bucket = _bucket_hits(scope, key, window)
    if not bucket:
        return 0
    oldest = min(bucket)
    return max(1, int(oldest + window - time.time()) + 1)


def _rate_limit(scope, key, limit, window):
    _maybe_sweep_rate_buckets()
    now = time.time()
    bucket = _rate_buckets.setdefault(f'{scope}:{key}', [])
    bucket[:] = [t for t in bucket if t > now - window]
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


def _hash_password(password):
    salt = base64.b64encode(os.urandom(16)).decode()
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), base64.b64decode(salt), PBKDF2_ITERATIONS, 32)
    return salt, base64.b64encode(dk).decode()


def _verify_password(stored, password):
    ph = stored.get('passwordHash')
    salt = stored.get('salt')
    if ph and salt:
        try:
            dk = hashlib.pbkdf2_hmac('sha256', password.encode(), base64.b64decode(salt), PBKDF2_ITERATIONS, 32)
            return base64.b64encode(dk).decode() == ph
        except Exception:
            return False
    return stored.get('password') == password


def _send_email(to_addr, subject, body):
    """Send an email over SMTP. Returns True on success, False if unavailable/failed."""
    if not (SMTP_HOST and SMTP_FROM and to_addr):
        return False
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = SMTP_FROM
    msg['To'] = to_addr
    msg.set_content(body)
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            if SMTP_USER and SMTP_PASSWORD:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except Exception:
        return False


def _ensure_demo_admin():
    # Production bootstrap: ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL seed
    # (or repair) the initial admin account so the demo credentials are never
    # needed in production and the admin always has a recovery email.
    # Set DISABLE_DEMO_ADMIN=1 once a real admin exists and the demo account
    # has been deleted: restarts will never resurrect the demo login, but an
    # explicit ADMIN_PASSWORD bootstrap still works.
    admin_user = os.environ.get('ADMIN_USERNAME', 'admin').strip().lower() or 'admin'
    admin_pw = os.environ.get('ADMIN_PASSWORD', '')
    admin_email = os.environ.get('ADMIN_EMAIL', '').strip().lower()
    admin_fullname = os.environ.get('ADMIN_FULLNAME', '').strip()
    admin_hidden = os.environ.get('ADMIN_HIDDEN', '').lower() in ('1', 'true', 'yes')
    demo_disabled = os.environ.get('DISABLE_DEMO_ADMIN', '').lower() in ('1', 'true', 'yes')
    key = f'officials:{admin_user}'
    row = conn.execute('SELECT value FROM kv_store WHERE key = ?', (key,)).fetchone()
    if row and (admin_pw or admin_email or admin_fullname or admin_hidden):
        try:
            rec = json.loads(row[0])
        except Exception:
            rec = {}
        changed = False
        if admin_pw:
            salt, ph = _hash_password(admin_pw)
            rec['salt'] = salt
            rec['passwordHash'] = ph
            rec.pop('password', None)
            changed = True
        if admin_email and rec.get('email') != admin_email:
            rec['email'] = admin_email
            changed = True
        if admin_fullname and rec.get('fullName') != admin_fullname:
            rec['fullName'] = admin_fullname
            changed = True
        if admin_hidden and not rec.get('hidden'):
            rec['hidden'] = True
            changed = True
        if rec.get('status') != 'approved' or not rec.get('isAdmin'):
            rec['status'] = 'approved'
            rec['isAdmin'] = True
            changed = True
        if changed:
            rec['username'] = admin_user
            with conn:
                conn.execute(
                    'INSERT INTO kv_store (key, value) VALUES (?, ?) '
                    'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                    (key, json.dumps(rec)),
                )
        return
    if row:
        return
    if demo_disabled and not admin_pw:
        return  # demo account deleted on purpose; do not re-seed it
    salt, ph = _hash_password(admin_pw or 'admin123')
    demo = {
        'username': admin_user,
        'fullName': admin_fullname or 'Maria Santos',
        'position': 'Punong Barangay',
        'isAdmin': True,
        'status': 'approved',
        'dateJoined': int(time.time() * 1000) - 86400000,
        'salt': salt,
        'passwordHash': ph,
        'mustChangePassword': not bool(admin_pw),
    }
    if admin_email:
        demo['email'] = admin_email
    if admin_hidden:
        demo['hidden'] = True
    with conn:
        conn.execute('INSERT INTO kv_store (key, value) VALUES (?, ?)', (key, json.dumps(demo)))


_ensure_demo_admin()


class StorageHandler(BaseHTTPRequestHandler):
    SECRET_FIELDS = ('password', 'passwordHash', 'salt')
    OFFICIAL_EDITABLE = ('fullName', 'email', 'position', 'photo', 'status', 'isAdmin', 'mustChangePassword', 'dateJoined')
    PUBLIC_READ_PREFIXES = ('announcements:', 'officials:')

    # Per-connection socket timeout so one slow client can't hold a thread forever.
    timeout = 15

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (datetime.datetime.now().isoformat(timespec='seconds'), fmt % args))

    def _set_headers(self, status=200, content_type='application/json', extra_headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', FRONTEND_ORIGIN)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        for k, v in (extra_headers or {}).items():
            self.send_header(k, str(v))
        self.end_headers()

    def _read_json(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length)
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return None

    def _send_json(self, status, payload, extra_headers=None):
        self._set_headers(status, extra_headers=extra_headers)
        self.wfile.write(json.dumps(payload).encode('utf-8'))

    def _client_ip(self):
        if TRUST_PROXY:
            forwarded = self.headers.get('X-Forwarded-For', '')
            # Left-most entry is the original client. Only accept values that
            # parse as a real IP so garbage falls back to the direct peer.
            for part in forwarded.split(','):
                candidate = part.strip().strip('[]')
                if not candidate:
                    continue
                try:
                    ipaddress.ip_address(candidate)
                    return candidate
                except ValueError:
                    pass
                # Tolerate trailing ':port' on IPv4 (IPv6 contains many colons
                # so it is never stripped this way).
                if candidate.count(':') == 1:
                    host = candidate.rsplit(':', 1)[0].strip().strip('[]')
                    try:
                        ipaddress.ip_address(host)
                        return host
                    except ValueError:
                        continue
        return self.client_address[0]

    def _rate_limited(self, scope, limit, window, message=None, key=None):
        who = key if key is not None else self._client_ip()
        if not _rate_limit(scope, who, limit, window):
            retry_after = _rate_retry_after(scope, who, window)
            self._send_json(429, {'error': message or 'Too many requests. Please slow down.',
                                  'retryAfter': retry_after},
                            extra_headers={'Retry-After': retry_after} if retry_after else None)
            return True
        return False

    def _get_token(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth[7:].strip()
        return None

    def _get_official(self, username):
        row = conn.execute('SELECT value FROM kv_store WHERE key = ?', (f'officials:{username}',)).fetchone()
        if not row:
            return None
        try:
            return json.loads(row[0])
        except Exception:
            return None

    def _find_official(self, identifier):
        cursor = conn.execute("SELECT value FROM kv_store WHERE key LIKE 'officials:%'")
        for (value,) in cursor.fetchall():
            try:
                rec = json.loads(value)
            except Exception:
                continue
            if rec.get('username', '').lower() == identifier or rec.get('email', '').lower() == identifier:
                return rec
        return None

    def _session_key(self, token):
        """Session lookup key. Only the SHA-256 of the token is stored, so a
        database leak does not hand out live sessions."""
        digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        return f'sessions:{digest}'

    def _get_session(self):
        token = self._get_token()
        if not token:
            return None
        key = self._session_key(token)
        row = conn.execute('SELECT value FROM kv_store WHERE key = ?', (key,)).fetchone()
        if not row:
            return None
        try:
            session = json.loads(row[0])
        except Exception:
            return None
        if session.get('expires', 0) < time.time():
            with conn:
                conn.execute('DELETE FROM kv_store WHERE key = ?', (key,))
            return None
        official = self._get_official(session.get('username', ''))
        if not official or official.get('status') != 'approved':
            return None
        # Sliding expiry: activity extends the session, but the new expiry is
        # only persisted once under half the TTL remains — otherwise every
        # dashboard poll by every user would be a DB write.
        if session.get('expires', 0) - time.time() < SESSION_TTL / 2:
            session['expires'] = time.time() + SESSION_TTL
            self._store(key, session)
        return official

    def _strip_secrets(self, official):
        clean = dict(official)
        for field in self.SECRET_FIELDS:
            clean.pop(field, None)
        return clean

    def _store(self, key, payload):
        with conn:
            conn.execute(
                'INSERT INTO kv_store (key, value) VALUES (?, ?) '
                'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                (key, json.dumps(payload))
            )

    def _write_key(self, key, payload):
        """Write a key, merging safely for officials records so secrets survive."""
        if key.startswith('officials:'):
            existing = conn.execute('SELECT value FROM kv_store WHERE key = ?', (key,)).fetchone()
            if existing:
                try:
                    rec = json.loads(existing[0])
                except Exception:
                    rec = {}
                merged = dict(rec)
                for field in self.OFFICIAL_EDITABLE:
                    if field in payload:
                        merged[field] = payload[field]
                payload = merged
        self._store(key, payload)

    # ------------------------- validation helpers ------------------------- #
    def _validate_request(self, payload):
        required = ('id', 'refNumber', 'type', 'fullName', 'contact', 'address', 'status', 'dateSubmitted')
        if not all(payload.get(f) for f in required):
            return False
        if payload.get('status') != 'Pending':
            return False
        if not isinstance(payload.get('id'), str) or not payload.get('id').startswith('req'):
            return False
        for f in ('refNumber', 'type', 'fullName', 'contact', 'address'):
            if not isinstance(payload.get(f), str):
                return False
        if not isinstance(payload.get('dateSubmitted'), (int, float)):
            return False
        return True

    def _validate_feedback(self, payload):
        if not isinstance(payload.get('message'), str) or not payload.get('message').strip():
            return False
        rating = payload.get('rating')
        if not isinstance(rating, int) or not (0 <= rating <= 5):
            return False
        if not isinstance(payload.get('id'), str) or not payload.get('id').startswith('fbk'):
            return False
        if not isinstance(payload.get('dateSubmitted'), (int, float)):
            return False
        return True

    def _ref_number_taken(self, ref_number, exclude_key=None):
        """Check whether a request reference number already exists (case-insensitive)."""
        if not isinstance(ref_number, str):
            return False
        want = ref_number.strip().upper()
        cursor = conn.execute("SELECT key, value FROM kv_store WHERE key LIKE 'requests:%'")
        for (key, value) in cursor.fetchall():
            if exclude_key and key == exclude_key:
                continue
            try:
                req = json.loads(value)
            except Exception:
                continue
            if str(req.get('refNumber', '')).upper() == want:
                return True
        return False

    def _validate_registration(self, key, payload):
        if payload.get('status') != 'pending':
            return False
        for f in ('username', 'fullName', 'position', 'email'):
            if not isinstance(payload.get(f), str) or not payload.get(f).strip():
                return False
        # Basic email shape check (frontend additionally restricts to Gmail).
        if '@' not in payload.get('email', '') or '.' not in payload.get('email', ''):
            return False
        has_hash = isinstance(payload.get('passwordHash'), str) and isinstance(payload.get('salt'), str)
        has_legacy = isinstance(payload.get('password'), str)
        if not (has_hash or has_legacy):
            return False
        if has_hash:
            # Structural check: 16-byte salt and 32-byte hash, both base64.
            # The server never sees the plaintext at registration, so this plus
            # the client-side minimum-length check is the enforceable policy.
            try:
                salt_bytes = base64.b64decode(payload['salt'])
                hash_bytes = base64.b64decode(payload['passwordHash'])
            except Exception:
                return False
            if len(salt_bytes) != 16 or len(hash_bytes) != 32:
                return False
        if conn.execute('SELECT 1 FROM kv_store WHERE key = ?', (key,)).fetchone():
            return False  # anonymous cannot overwrite an existing official
        email = payload.get('email', '').lower()
        username = payload.get('username', '').lower()
        cursor = conn.execute("SELECT value FROM kv_store WHERE key LIKE 'officials:%'")
        for (value,) in cursor.fetchall():
            try:
                rec = json.loads(value)
            except Exception:
                continue
            if rec.get('email', '').lower() == email or rec.get('username', '').lower() == username:
                return False
        return True

    # ------------------------------ endpoints ----------------------------- #
    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/healthz':
            self._send_json(200, {'ok': True})
            return

        if parsed.path == '/api/session':
            official = self._get_session()
            if not official:
                self._send_json(401, {'error': 'Not logged in'})
            else:
                self._send_json(200, {'official': self._strip_secrets(official)})
            return

        if parsed.path == '/api/track':
            params = parse_qs(parsed.query)
            ref = params.get('ref', [''])[0].strip().upper()
            if not ref:
                self._send_json(400, {'error': 'Missing reference number'})
                return
            if self._rate_limited('track', *RATE_LIMITS['track']):
                return
            cursor = conn.execute("SELECT value FROM kv_store WHERE key LIKE 'requests:%'")
            for (value,) in cursor.fetchall():
                try:
                    req = json.loads(value)
                except Exception:
                    continue
                if req.get('refNumber', '').upper() == ref:
                    self._send_json(200, {'request': req})
                    return
            self._send_json(404, {'error': 'Not found'})
            return

        if parsed.path == '/api/rating':
            if self._rate_limited('rating', *RATE_LIMITS['rating']):
                return
            cursor = conn.execute("SELECT value FROM kv_store WHERE key LIKE 'feedback:%'")
            count = 0
            total = 0.0
            for (value,) in cursor.fetchall():
                try:
                    item = json.loads(value)
                except Exception:
                    continue
                rating = item.get('rating')
                if isinstance(rating, (int, float)):
                    total += rating
                    count += 1
            self._send_json(200, {'count': count, 'average': round(total / count, 1) if count else 0})
            return

        if parsed.path == '/storage/list':
            params = parse_qs(parsed.query)
            prefix = params.get('prefix', [''])[0]
            official = self._get_session()
            if not official and prefix not in self.PUBLIC_READ_PREFIXES:
                self._send_json(403, {'error': 'Access denied.'})
                return
            cursor = conn.execute('SELECT key FROM kv_store WHERE key LIKE ? ORDER BY key', (f'{prefix}%',))
            all_keys = [row[0] for row in cursor.fetchall()]
            # Hidden officials (e.g. a back-office admin login) are invisible
            # to everyone except admins — even though the officials: prefix is
            # publicly listable.
            if prefix.startswith('officials:'):
                if not (official and official.get('isAdmin')):
                    visible = []
                    for key in all_keys:
                        row = conn.execute('SELECT value FROM kv_store WHERE key = ?', (key,)).fetchone()
                        try:
                            hidden = bool(json.loads(row[0]).get('hidden')) if row else False
                        except Exception:
                            hidden = False
                        if not hidden:
                            visible.append(key)
                    all_keys = visible
            total = len(all_keys)
            try:
                limit = int(params.get('limit', ['0'])[0])
            except (ValueError, TypeError):
                limit = 0
            try:
                offset = int(params.get('offset', ['0'])[0])
            except (ValueError, TypeError):
                offset = 0
            keys = all_keys[max(offset, 0):]
            if limit > 0:
                keys = keys[:min(limit, 1000)]
            self._send_json(200, {'keys': keys, 'total': total})
            return

        if parsed.path == '/storage/get':
            params = parse_qs(parsed.query)
            key = params.get('key', [''])[0]
            official = self._get_session()
            allowed = bool(official) or key.startswith('announcements:') or key.startswith('officials:')
            if not allowed:
                self._send_json(403, {'error': 'Access denied.'})
                return
            row = conn.execute('SELECT value FROM kv_store WHERE key = ?', (key,)).fetchone()
            if row is None:
                self._send_json(404, {'error': 'Not found'})
                return
            value = row[0]
            if key.startswith('officials:'):
                try:
                    rec = json.loads(value)
                    if rec.get('hidden') and not (official and official.get('isAdmin')):
                        self._send_json(404, {'error': 'Not found'})
                        return
                    value = json.dumps(self._strip_secrets(rec))
                except Exception:
                    pass
            self._send_json(200, {'value': value})
            return

        self._send_json(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/storage/set':
            self._handle_storage_set()
            return
        if self.path == '/api/chat':
            self._handle_chat()
            return
        if self.path == '/api/login':
            self._handle_login()
            return
        if self.path == '/api/logout':
            self._handle_logout()
            return
        if self.path == '/api/change-password':
            self._handle_change_password()
            return
        if self.path == '/api/reset-request':
            self._handle_reset_request()
            return
        if self.path == '/api/reset-complete':
            self._handle_reset_complete()
            return
        if self.path == '/api/update-official':
            self._handle_update_official()
            return
        self._send_json(404, {'error': 'Not found'})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == '/storage/delete':
            params = parse_qs(parsed.query)
            key = params.get('key', [''])[0]
            official = self._get_session()
            if key.startswith('sessions:') or key.startswith('resets:'):
                self._send_json(403, {'error': 'Access denied.'})
                return
            if not official:
                self._send_json(403, {'error': 'Access denied.'})
                return
            if not bool(official.get('isAdmin')):
                self._send_json(403, {'error': 'Admin access required.'})
                return
            if key.startswith('officials:'):
                target_name = key.split(':', 1)[1].lower() if ':' in key else ''
                self_name = str(official.get('username', '')).lower()
                if not target_name:
                    self._send_json(400, {'error': 'Invalid official account.'})
                    return
                if target_name == self_name:
                    self._send_json(400, {'error': 'You cannot delete your own admin account.'})
                    return
                target = self._get_official(target_name)
                if target is None:
                    self._send_json(404, {'error': 'Official account not found.'})
                    return
                if target.get('isAdmin') and str(target.get('status', 'approved')) == 'approved':
                    # Never leave the barangay with zero approved admins.
                    remaining = 0
                    cursor = conn.execute("SELECT value FROM kv_store WHERE key LIKE 'officials:%'")
                    for (value,) in cursor.fetchall():
                        try:
                            rec = json.loads(value)
                        except Exception:
                            continue
                        if (rec.get('username', '').lower() == target_name or
                                str(rec.get('status', 'approved')) != 'approved' or
                                not rec.get('isAdmin')):
                            continue
                        remaining += 1
                    if remaining < 1:
                        self._send_json(400, {'error': 'You cannot delete the last remaining admin account.'})
                        return
                with conn:
                    conn.execute('DELETE FROM kv_store WHERE key = ?', (key,))
                    conn.execute('DELETE FROM kv_store WHERE key = ?', (f'resets:{target_name}',))
                    # Drop any live sessions for the deleted account.
                    rows = conn.execute("SELECT key, value FROM kv_store WHERE key LIKE 'sessions:%'").fetchall()
                    for (skey, svalue) in rows:
                        try:
                            sess = json.loads(svalue)
                        except Exception:
                            continue
                        if str(sess.get('username', '')).lower() == target_name:
                            conn.execute('DELETE FROM kv_store WHERE key = ?', (skey,))
                self._send_json(200, {'success': True})
                return
            with conn:
                conn.execute('DELETE FROM kv_store WHERE key = ?', (key,))
            self._send_json(200, {'success': True})
            return
        self._send_json(404, {'error': 'Not found'})

    # --------------------------- storage write ---------------------------- #
    def _authorize_official_write(self, official, key, payload):
        """Enforce admin-only writes. Returns True if allowed (else responds 403/400)."""
        is_admin = bool(official.get('isAdmin'))
        if not isinstance(payload, dict):
            self._send_json(400, {'error': 'Invalid payload.'})
            return False
        if key.startswith('sessions:') or key.startswith('resets:'):
            self._send_json(403, {'error': 'Access denied.'})
            return False
        if key.startswith('announcements:'):
            if not is_admin:
                self._send_json(403, {'error': 'Admin access required.'})
                return False
            return True
        if key.startswith('officials:'):
            target = key.split(':', 1)[1].lower() if ':' in key else ''
            self_name = str(official.get('username', '')).lower()
            exists = conn.execute('SELECT 1 FROM kv_store WHERE key = ?', (key,)).fetchone()
            if not exists and not is_admin:
                self._send_json(403, {'error': 'Admin access required.'})
                return False
            if target != self_name and not is_admin:
                self._send_json(403, {'error': 'Admin access required.'})
                return False
            if not is_admin:
                # Non-admins may only touch their own profile photo/fullName/email.
                for field in ('status', 'isAdmin', 'mustChangePassword', 'dateJoined', 'position', 'username'):
                    if field in payload:
                        existing = self._get_official(target)
                        if not existing or payload.get(field) != existing.get(field):
                            self._send_json(403, {'error': 'Admin access required.'})
                            return False
            return True
        if key.startswith('requests:'):
            exists = conn.execute('SELECT 1 FROM kv_store WHERE key = ?', (key,)).fetchone()
            if exists:
                # Only admins may change request status/details after filing.
                if not is_admin:
                    self._send_json(403, {'error': 'Admin access required.'})
                    return False
                return True
            if not self._validate_request(payload):
                self._send_json(400, {'error': 'Invalid request data.'})
                return False
            if self._ref_number_taken(payload.get('refNumber', '')):
                self._send_json(409, {'error': 'That reference number is already in use. Please file again.'})
                return False
            return True
        if key.startswith('feedback:'):
            exists = conn.execute('SELECT 1 FROM kv_store WHERE key = ?', (key,)).fetchone()
            if exists and not is_admin:
                self._send_json(403, {'error': 'Admin access required.'})
                return False
            if not exists and not self._validate_feedback(payload):
                self._send_json(400, {'error': 'Invalid feedback data.'})
                return False
            return True
        # Unknown prefixes: only admins may write arbitrary keys.
        if not is_admin:
            self._send_json(403, {'error': 'Admin access required.'})
            return False
        return True

    def _handle_storage_set(self):
        data = self._read_json()
        if not isinstance(data, dict):
            self._send_json(400, {'error': 'Invalid JSON body.'})
            return
        key = data.get('key')
        value = data.get('value')
        if not key or value is None:
            self._send_json(400, {'error': 'Key and value required'})
            return
        if not isinstance(value, str):
            self._send_json(400, {'error': 'Value must be a JSON string.'})
            return
        if len(value.encode('utf-8')) > MAX_VALUE_BYTES:
            self._send_json(413, {'error': 'Value too large.'})
            return
        if key.startswith('sessions:'):
            self._send_json(403, {'error': 'Access denied.'})
            return
        try:
            payload = json.loads(value)
        except Exception:
            self._send_json(400, {'error': 'Value must be valid JSON.'})
            return

        official = self._get_session()
        if official:
            if not self._authorize_official_write(official, key, payload):
                return
            self._write_key(key, payload)
            self._send_json(200, {'success': True})
            return

        # Anonymous writes are restricted by prefix and validated.
        if self._rate_limited('set', *RATE_LIMITS['set']):
            return
        if key.startswith('requests:'):
            if not self._validate_request(payload):
                self._send_json(400, {'error': 'Invalid request data.'})
                return
            if self._ref_number_taken(payload.get('refNumber', '')):
                self._send_json(409, {'error': 'That reference number is already in use. Please file again.'})
                return
        elif key.startswith('feedback:'):
            if not self._validate_feedback(payload):
                self._send_json(400, {'error': 'Invalid feedback data.'})
                return
        elif key.startswith('resets:'):
            if not isinstance(payload.get('code'), str) or not isinstance(payload.get('expires'), (int, float)):
                self._send_json(400, {'error': 'Invalid reset data.'})
                return
        elif key.startswith('officials:'):
            if not self._validate_registration(key, payload):
                self._send_json(400, {'error': 'Invalid registration data.'})
                return
        else:
            self._send_json(403, {'error': 'Access denied.'})
            return

        self._write_key(key, payload)
        self._send_json(200, {'success': True})

    # ------------------------------ API handlers -------------------------- #
    def _handle_login(self):
        data = self._read_json()
        if not isinstance(data, dict):
            self._send_json(400, {'error': 'Invalid JSON body.'})
            return
        identifier = str(data.get('identifier', '')).strip().lower()
        password = data.get('password')
        if not identifier or not password:
            self._send_json(400, {'error': 'Enter your username or Gmail and password.'})
            return
        ip = self._client_ip()
        # Layer 1 (generous per-IP bot guard): 60 attempts / 5 min by default.
        # Normal humans do 1-3 clicks; this only trips on automation or a
        # proxy sharing one IP across many machines (set TRUST_PROXY=1 then).
        if self._rate_limited('login', LOGIN_IP_LIMIT, LOGIN_IP_WINDOW,
                              message='Too many login attempts from this network. Please wait a few minutes and try again.'):
            return
        # Layer 2 (per-account guessing guard): only FAILED passwords consume
        # quota. Peek without consuming — failures are recorded below.
        fails = _bucket_hits('loginfail', identifier, LOGIN_FAIL_WINDOW)
        if len(fails) >= LOGIN_FAIL_LIMIT:
            retry_after = _rate_retry_after('loginfail', identifier, LOGIN_FAIL_WINDOW)
            mins = max(1, round(retry_after / 60))
            self._send_json(429, {'error': f'Too many wrong passwords for this account. Try again in about {mins} minute(s).',
                                  'retryAfter': retry_after},
                            extra_headers={'Retry-After': retry_after})
            return

        official = self._find_official(identifier)
        if not official:
            _bucket_hits('loginfail', identifier, LOGIN_FAIL_WINDOW).append(time.time())
            self._send_json(401, {'error': 'No account found with that username or Gmail.'})
            return
        if official.get('status') == 'pending':
            self._send_json(403, {'error': 'Your account is still waiting for admin approval.'})
            return
        if official.get('status') == 'rejected':
            self._send_json(403, {'error': 'Your account was rejected. Please contact the barangay office.'})
            return
        if not _verify_password(official, password):
            left = max(0, LOGIN_FAIL_LIMIT - len(_bucket_hits('loginfail', identifier, LOGIN_FAIL_WINDOW)) - 1)
            _bucket_hits('loginfail', identifier, LOGIN_FAIL_WINDOW).append(time.time())
            hint = f' ({left} attempt(s) left before a short cooldown)' if left <= 5 else ''
            self._send_json(401, {'error': f'Incorrect password.{hint}'})
            return

        # Migrate legacy plaintext accounts to a salted hash.
        if official.get('password') and not official.get('passwordHash'):
            salt, ph = _hash_password(password)
            official['salt'] = salt
            official['passwordHash'] = ph
            official.pop('password', None)
            self._store(f'officials:{official["username"]}', official)

        token = secrets.token_urlsafe(32)
        self._store(self._session_key(token), {'username': official.get('username'), 'expires': time.time() + SESSION_TTL})
        # A successful login proves humanity — free both buckets so earlier
        # typos never lock out a legitimate user (or a shared office IP).
        _clear_rate_limit('login', self._client_ip())
        _clear_rate_limit('loginfail', identifier)
        self._send_json(200, {'token': token, 'official': self._strip_secrets(official)})

    def _handle_logout(self):
        token = self._get_token()
        if token:
            with conn:
                conn.execute('DELETE FROM kv_store WHERE key = ?', (self._session_key(token),))
        self._send_json(200, {'success': True})

    def _handle_change_password(self):
        official = self._get_session()
        if not official:
            self._send_json(401, {'error': 'Authentication required. Please log in.'})
            return
        data = self._read_json()
        if not isinstance(data, dict):
            self._send_json(400, {'error': 'Invalid JSON body.'})
            return
        current_pw = data.get('currentPw')
        new_pw = data.get('newPw')
        if not current_pw or not new_pw:
            self._send_json(400, {'error': 'Please fill in every field.'})
            return
        if not _verify_password(official, current_pw):
            self._send_json(400, {'error': 'Current password is incorrect.'})
            return
        if len(new_pw) < 6:
            self._send_json(400, {'error': 'New password must be at least 6 characters.'})
            return
        salt, ph = _hash_password(new_pw)
        updated = dict(official)
        updated['salt'] = salt
        updated['passwordHash'] = ph
        updated.pop('password', None)
        updated['mustChangePassword'] = False
        self._store(f'officials:{official["username"]}', updated)
        self._send_json(200, {'ok': True, 'official': self._strip_secrets(updated)})

    def _handle_reset_request(self):
        data = self._read_json()
        if not isinstance(data, dict):
            self._send_json(400, {'error': 'Invalid JSON body.'})
            return
        identifier = str(data.get('identifier', '')).strip().lower()
        if not identifier:
            self._send_json(400, {'error': 'Enter your username or Gmail address.'})
            return
        if self._rate_limited('reset', *RATE_LIMITS['reset']):
            return
        official = self._find_official(identifier)
        if not official or official.get('status') != 'approved':
            self._send_json(404, {'error': 'No approved account found with that username or Gmail.'})
            return
        # Per-account backstop so rotating IPs can't spam one victim's inbox
        # (or burn SMTP quota) even if the IP bucket is dodged.
        acct_key = str(official.get('username', '')).lower()
        if not _rate_limit('resetacct', acct_key, 3, 900):
            retry_after = _rate_retry_after('resetacct', acct_key, 900)
            mins = max(1, round(retry_after / 60))
            self._send_json(429, {'error': f'Too many reset codes sent to this account. Try again in about {mins} minute(s).',
                                  'retryAfter': retry_after},
                            extra_headers={'Retry-After': retry_after})
            return
        code = str(secrets.randbelow(1000000)).zfill(6)
        self._store(f'resets:{official["username"]}', {
            'username': official['username'],
            'code': code,
            'expires': time.time() + 1800,
        })
        sent = _send_email(
            official.get('email', ''),
            'Your password reset code',
            f'Your password reset code is {code}. It expires in 30 minutes. '
            'If you did not request this, you can ignore this email.',
        )
        if sent:
            self._send_json(200, {'ok': True})
            return
        with conn:
            conn.execute('DELETE FROM kv_store WHERE key = ?', (f'resets:{official["username"]}',))
        self._send_json(500, {'error': 'Could not send the reset code by email. Please try again or contact your administrator.'})

    def _handle_reset_complete(self):
        data = self._read_json()
        if not isinstance(data, dict):
            self._send_json(400, {'error': 'Invalid JSON body.'})
            return
        identifier = str(data.get('identifier', '')).strip().lower()
        code = str(data.get('code', '')).strip()
        new_pw = data.get('newPw')
        if not code or not new_pw:
            self._send_json(400, {'error': 'Enter the reset code and a new password.'})
            return
        if len(new_pw) < 6:
            self._send_json(400, {'error': 'New password must be at least 6 characters.'})
            return
        official = self._find_official(identifier)
        if not official:
            self._send_json(404, {'error': 'No account found with that username or Gmail.'})
            return
        row = conn.execute('SELECT value FROM kv_store WHERE key = ?', (f'resets:{official["username"]}',)).fetchone()
        if not row:
            self._send_json(400, {'error': 'No reset was requested for this account.'})
            return
        try:
            rec = json.loads(row[0])
        except Exception:
            rec = {}
        if rec.get('code') != code:
            self._send_json(400, {'error': 'That reset code is incorrect.'})
            return
        if rec.get('expires', 0) < time.time():
            with conn:
                conn.execute('DELETE FROM kv_store WHERE key = ?', (f'resets:{official["username"]}',))
            self._send_json(400, {'error': 'That reset code has expired. Request a new one.'})
            return
        salt, ph = _hash_password(new_pw)
        updated = dict(official)
        updated['salt'] = salt
        updated['passwordHash'] = ph
        updated.pop('password', None)
        updated['mustChangePassword'] = False
        self._store(f'officials:{official["username"]}', updated)
        with conn:
            conn.execute('DELETE FROM kv_store WHERE key = ?', (f'resets:{official["username"]}',))
        self._send_json(200, {'ok': True})

    def _handle_update_official(self):
        official = self._get_session()
        if not official:
            self._send_json(401, {'error': 'Authentication required. Please log in.'})
            return
        data = self._read_json()
        if not isinstance(data, dict):
            self._send_json(400, {'error': 'Invalid JSON body.'})
            return
        username = str(data.get('username', '')).strip().lower()
        updates = data.get('updates') or {}
        if username != official.get('username'):
            self._send_json(403, {'error': 'Access denied.'})
            return
        allowed = {}
        for field in ('photo', 'email', 'fullName'):
            if field in updates:
                allowed[field] = updates[field]
        updated = dict(official)
        updated.update(allowed)
        self._store(f'officials:{username}', updated)
        self._send_json(200, {'ok': True, 'official': self._strip_secrets(updated)})

    def _handle_chat(self):
        session = None
        if REQUIRE_CHAT_AUTH or self._get_token():
            session = self._get_session()
        if REQUIRE_CHAT_AUTH and not session:
            self._send_json(401, {'error': 'Please log in to use the chat.'})
            return
        # Logged-in users are throttled per account (not per IP) so one busy
        # network can't get everyone else's chat blocked — and IP spoofing
        # can't burn someone else's quota.
        if session and session.get('username'):
            chat_key = f"user:{str(session.get('username')).lower()}"
        else:
            chat_key = f"ip:{self._client_ip()}"
        if self._rate_limited('chat', *RATE_LIMITS['chat'], key=chat_key):
            return
        data = self._read_json()
        if not isinstance(data, dict):
            self._send_json(400, {'error': 'Invalid JSON body.'})
            return
        user_input = str(data.get('input', '')).strip()[:4000]
        history = data.get('history', [])
        if not user_input:
            self._send_json(400, {'error': 'Input text is required'})
            return

        prompt = self._build_prompt(user_input, history)
        reply, error = self._call_model(prompt)
        if error:
            self._send_json(500, {'error': error})
            return
        self._send_json(200, {'reply': reply})

    # --------------------------- model helpers ---------------------------- #
    def _call_hf_model(self, prompt):
        if not HF_API_KEY:
            return None, 'Hugging Face API key not configured. Set HF_API_KEY to use the chat feature.'

        payload = json.dumps({
            'inputs': prompt,
            'parameters': {
                'max_new_tokens': 220,
                'temperature': 0.7,
                'return_full_text': False
            }
        }).encode('utf-8')

        req = Request(f'https://api-inference.huggingface.co/models/{HF_MODEL}', data=payload, method='POST')
        req.add_header('Authorization', f'Bearer {HF_API_KEY}')
        req.add_header('Content-Type', 'application/json')

        try:
            with urlopen(req, timeout=30) as response:
                raw = response.read().decode('utf-8')
                result = json.loads(raw)
                if isinstance(result, dict) and result.get('error'):
                    return None, result.get('error')
                if isinstance(result, list):
                    return result[0].get('generated_text', str(result)) or str(result[0]), None
                if isinstance(result, dict):
                    return result.get('generated_text', str(result)), None
                return str(result), None
        except HTTPError as exc:
            try:
                error_body = exc.read().decode('utf-8')
                error_data = json.loads(error_body)
                return None, error_data.get('error', error_body)
            except Exception:
                return None, str(exc)
        except URLError as exc:
            error_msg = str(exc)
            if 'No address associated with hostname' in error_msg or 'Name or service not known' in error_msg:
                return None, 'Network connection issue: Cannot reach Hugging Face API. Please check your internet connection or use a local Llama model instead.'
            return None, f'Network error: {error_msg}'

    def _call_deepseek_model(self, prompt):
        if not DEEPSEEK_API_KEY:
            return None, 'DeepSeek API key not configured. Set DEEPSEEK_API_KEY to use the chat feature.'

        payload = json.dumps({
            'inputs': prompt,
            'parameters': {
                'max_new_tokens': 220,
                'temperature': 0.7,
                'return_full_text': False
            }
        }).encode('utf-8')

        req = Request(f'https://api-inference.huggingface.co/models/{DEEPSEEK_MODEL}', data=payload, method='POST')
        req.add_header('Authorization', f'Bearer {DEEPSEEK_API_KEY}')
        req.add_header('Content-Type', 'application/json')

        try:
            with urlopen(req, timeout=30) as response:
                raw = response.read().decode('utf-8')
                result = json.loads(raw)
                if isinstance(result, dict) and result.get('error'):
                    return None, result.get('error', 'DeepSeek API error')
                if isinstance(result, list):
                    return result[0].get('generated_text', str(result)) or str(result[0]), None
                if isinstance(result, dict):
                    return result.get('generated_text', str(result)), None
                return str(result), None
        except HTTPError as exc:
            try:
                error_body = exc.read().decode('utf-8')
                error_data = json.loads(error_body)
                return None, error_data.get('error', error_body)
            except Exception:
                return None, str(exc)
        except URLError as exc:
            error_msg = str(exc)
            if 'No address associated with hostname' in error_msg or 'Name or service not known' in error_msg:
                return None, 'Network connection issue: Cannot reach the DeepSeek model on Hugging Face. Please check your internet connection.'
            return None, f'Network error: {error_msg}'

    def _call_local_llama_model(self, prompt):
        if LOCAL_LLAMA is None:
            return None, LOCAL_LLAMA_ERROR or 'Local Llama runtime is not available.'

        try:
            result = LOCAL_LLAMA(prompt, max_tokens=220, temperature=0.7, stop=['\nUser:', '\nAssistant:'])
            if isinstance(result, dict):
                return result.get('choices', [])[0].get('text', '').strip(), None
            return str(result), None
        except Exception as exc:
            return None, f'Local Llama generation failed: {exc}'

    def _call_model(self, prompt):
        if DEEPSEEK_API_KEY:
            return self._call_deepseek_model(prompt)
        if LOCAL_LLAMA is not None:
            return self._call_local_llama_model(prompt)
        if HF_API_KEY:
            return self._call_hf_model(prompt)
        return None, (
            'No local Llama runtime available and no API keys are configured. '
            'Install llama-cpp-python and a local Llama model, or set DEEPSEEK_API_KEY / HF_API_KEY.'
        )

    def _build_prompt(self, user_input, history):
        system_instructions = (
            "You are Barangay Kolabtingon's friendly barangay assistant. "
            "Answer clearly and kindly. Use English or Cebuano, and keep responses short. "
            "Help the user choose the right request type, explain how to file a request, and direct them to the tracking popup when needed."
        )

        service_list = [
            "Barangay Clearance - proof of good standing for jobs, permits, or transactions.",
            "Cedula (Community Tax Certificate) - annual community tax certificate.",
            "Certificate of Indigency - for financial or medical assistance applications.",
            "Certificate of Residency - confirms the user lives within the barangay.",
            "Business Permit Endorsement - barangay endorsement before city permit filing.",
            "Barangay ID - official identification issued by the barangay.",
            "Blotter / Complaint Report - file an incident report or dispute for the record.",
            "Other Concern - any other issue the user wants to raise with the barangay."
        ]

        prompt_lines = [f"System: {system_instructions}"]
        prompt_lines.append("System: Available services are:")
        for service in service_list:
            prompt_lines.append(f"System: - {service}")
        prompt_lines.append("System: Use the service list when helping the user. If the user asks to track a request, tell them to use the tracking popup.")
        prompt_lines.append("System: Do not fabricate personal data or policies.")

        if isinstance(history, list):
            for message in history:
                speaker = 'User' if message.get('sender') == 'user' else 'Assistant'
                text = message.get('text', '')
                prompt_lines.append(f"{speaker}: {text}")

        prompt_lines.append(f"User: {user_input}")
        prompt_lines.append("Assistant:")
        return '\n'.join(prompt_lines)


class PortalServer(ThreadingHTTPServer):
    """HTTP server sized for ~15-20 simultaneous users.

    - daemon_threads: handler threads never block process shutdown / redeploy.
    - request_queue_size=128: the listen backlog absorbs login/polling bursts
      instead of refusing connections (the socketserver default is 5).
    - allow_reuse_address: restarts don't trip over TIME_WAIT sockets.
    """
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128


def run(server_class=PortalServer, handler_class=StorageHandler, port=None):
    if port is None:
        port = PORT
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f'Storage backend running on http://localhost:{port}')
    if DEEPSEEK_API_KEY:
        print(f'Using DeepSeek model {DEEPSEEK_MODEL} (via Hugging Face)')
    elif HAS_LOCAL_LLAMA_MODEL:
        print(f'Using local Llama model at {LOCAL_LLAMA_MODEL_PATH}')
    elif HF_API_KEY:
        print(f'No local model found. Falling back to Hugging Face model {HF_MODEL}')
    elif os.environ.get('LOCAL_LLAMA_MODEL_PATH'):
        print(f'Local model path configured but not found: {LOCAL_LLAMA_MODEL_PATH}')
        print('Set LOCAL_LLAMA_MODEL_PATH to a valid GGUF file, or configure DEEPSEEK_API_KEY / HF_API_KEY.')
    else:
        print('No local model configured and no API keys set. Chat will return a warning message.')
    print('Security: sessions, rate limiting, and access control enabled.')
    httpd.serve_forever()


if __name__ == '__main__':
    run()