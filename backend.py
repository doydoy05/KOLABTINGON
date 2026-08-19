from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os
import time
import base64
import hashlib
import secrets
import sqlite3
from collections import defaultdict
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

DB_PATH = os.path.join(os.path.dirname(__file__), 'storage.db')
HF_MODEL = os.environ.get('HF_MODEL', 'meta-llama/Llama-2-7b-chat-hf')
HF_API_KEY = os.environ.get('HF_API_KEY', '')
DEEPSEEK_MODEL = os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat')
DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
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

conn = sqlite3.connect(DB_PATH, check_same_thread=False)
conn.execute('PRAGMA foreign_keys = ON')

with conn:
    conn.execute('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

# --------------------------------------------------------------------------- #
#  Security helpers                                                           #
# --------------------------------------------------------------------------- #
SESSION_TTL = 12 * 60 * 60          # session lifetime
MAX_VALUE_BYTES = 256 * 1024        # max stored value size
PBKDF2_ITERATIONS = 100000          # must match the frontend hashing settings

# per-IP rate limits: scope -> (limit, window_seconds)
RATE_LIMITS = {
    'set': (20, 60),
    'chat': (30, 60),
    'login': (10, 900),
    'reset': (5, 900),
    'track': (120, 60),
    'rating': (120, 60),
}

_rate_buckets = defaultdict(list)


def _rate_limit(scope, key, limit, window):
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


def _ensure_demo_admin():
    if conn.execute("SELECT 1 FROM kv_store WHERE key = 'officials:admin'").fetchone():
        return
    salt, ph = _hash_password('admin123')
    demo = {
        'username': 'admin',
        'fullName': 'Maria Santos',
        'position': 'Punong Barangay',
        'isAdmin': True,
        'status': 'approved',
        'dateJoined': int(time.time() * 1000) - 86400000,
        'salt': salt,
        'passwordHash': ph,
        'mustChangePassword': False,
    }
    with conn:
        conn.execute('INSERT INTO kv_store (key, value) VALUES (?, ?)', ('officials:admin', json.dumps(demo)))


_ensure_demo_admin()


class StorageHandler(BaseHTTPRequestHandler):
    SECRET_FIELDS = ('password', 'passwordHash', 'salt')
    OFFICIAL_EDITABLE = ('fullName', 'email', 'position', 'photo', 'status', 'isAdmin', 'mustChangePassword', 'dateJoined')
    PUBLIC_READ_PREFIXES = ('announcements:', 'officials:')

    def _set_headers(self, status=200, content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def _read_json(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length)
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return None

    def _send_json(self, status, payload):
        self._set_headers(status)
        self.wfile.write(json.dumps(payload).encode('utf-8'))

    def _client_ip(self):
        return self.client_address[0]

    def _rate_limited(self, scope, limit, window):
        if not _rate_limit(scope, self._client_ip(), limit, window):
            self._send_json(429, {'error': 'Too many requests. Please slow down.'})
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

    def _get_session(self):
        token = self._get_token()
        if not token:
            return None
        row = conn.execute('SELECT value FROM kv_store WHERE key = ?', (f'sessions:{token}',)).fetchone()
        if not row:
            return None
        try:
            session = json.loads(row[0])
        except Exception:
            return None
        if session.get('expires', 0) < time.time():
            with conn:
                conn.execute('DELETE FROM kv_store WHERE key = ?', (f'sessions:{token}',))
            return None
        official = self._get_official(session.get('username', ''))
        if not official or official.get('status') != 'approved':
            return None
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

    def _validate_registration(self, key, payload):
        if payload.get('status') != 'pending':
            return False
        for f in ('username', 'fullName', 'position', 'email'):
            if not isinstance(payload.get(f), str) or not payload.get(f).strip():
                return False
        has_hash = isinstance(payload.get('passwordHash'), str) and isinstance(payload.get('salt'), str)
        has_legacy = isinstance(payload.get('password'), str)
        if not (has_hash or has_legacy):
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
            keys = [row[0] for row in cursor.fetchall()]
            self._send_json(200, {'keys': keys})
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
            if key.startswith('sessions:'):
                self._send_json(403, {'error': 'Access denied.'})
                return
            if not official and not key.startswith('resets:'):
                self._send_json(403, {'error': 'Access denied.'})
                return
            with conn:
                conn.execute('DELETE FROM kv_store WHERE key = ?', (key,))
            self._send_json(200, {'success': True})
            return
        self._send_json(404, {'error': 'Not found'})

    # --------------------------- storage write ---------------------------- #
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
        if self._rate_limited('login', *RATE_LIMITS['login']):
            return

        official = self._find_official(identifier)
        if not official:
            self._send_json(401, {'error': 'No account found with that username or Gmail.'})
            return
        if official.get('status') == 'pending':
            self._send_json(403, {'error': 'Your account is still waiting for admin approval.'})
            return
        if official.get('status') == 'rejected':
            self._send_json(403, {'error': 'Your account was rejected. Please contact the barangay office.'})
            return
        if not _verify_password(official, password):
            self._send_json(401, {'error': 'Incorrect password.'})
            return

        # Migrate legacy plaintext accounts to a salted hash.
        if official.get('password') and not official.get('passwordHash'):
            salt, ph = _hash_password(password)
            official['salt'] = salt
            official['passwordHash'] = ph
            official.pop('password', None)
            self._store(f'officials:{official["username"]}', official)

        token = secrets.token_urlsafe(32)
        self._store(f'sessions:{token}', {'username': official.get('username'), 'expires': time.time() + SESSION_TTL})
        self._send_json(200, {'token': token, 'official': self._strip_secrets(official)})

    def _handle_logout(self):
        token = self._get_token()
        if token:
            with conn:
                conn.execute('DELETE FROM kv_store WHERE key = ?', (f'sessions:{token}',))
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
        code = str(secrets.randbelow(1000000)).zfill(6)
        self._store(f'resets:{official["username"]}', {
            'username': official['username'],
            'code': code,
            'expires': time.time() + 1800,
        })
        self._send_json(200, {'ok': True, 'code': code})

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
        for field in ('photo', 'email', 'fullName', 'position'):
            if field in updates:
                allowed[field] = updates[field]
        updated = dict(official)
        updated.update(allowed)
        self._store(f'officials:{username}', updated)
        self._send_json(200, {'ok': True, 'official': self._strip_secrets(updated)})

    def _handle_chat(self):
        if self._rate_limited('chat', *RATE_LIMITS['chat']):
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


def run(server_class=HTTPServer, handler_class=StorageHandler, port=8000):
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