"""End-to-end smoke tests: boots the real HTTP server on an isolated DB and
walks the critical flows (health, register -> approve -> login, request
filing incl. duplicate refNumber, admin-only writes, hashed sessions)."""

import importlib.util
import json
import pathlib
import threading
import urllib.error
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture()
def server(monkeypatch, tmp_path):
    tmp = tmp_path
    # Must be set before the module is imported (DB path, model path and the
    # bootstrap admin are all read at import time).
    monkeypatch.setenv('STORAGE_DB_PATH', str(tmp / 'smoke.db'))
    monkeypatch.setenv('LOCAL_LLAMA_MODEL_PATH', str(tmp / 'missing.gguf'))
    monkeypatch.setenv('HF_API_KEY', '')
    monkeypatch.setenv('DEEPSEEK_API_KEY', '')
    monkeypatch.setenv('ADMIN_PASSWORD', 'SmokeAdmin123!')
    monkeypatch.setenv('ADMIN_EMAIL', 'admin@example.com')

    spec = importlib.util.spec_from_file_location('backend_smoke', ROOT / 'backend.py')
    backend = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backend)

    httpd = backend.ThreadingHTTPServer(('127.0.0.1', 0), backend.StorageHandler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{port}'
    yield {'base': base, 'backend': backend}
    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=5)


def call(base, method, path, body=None, token=None):
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def test_healthz(server):
    status, payload = call(server['base'], 'GET', '/healthz')
    assert status == 200
    assert payload == {'ok': True}


def test_admin_login_and_session(server):
    base = server['base']
    status, payload = call(base, 'POST', '/api/login',
                           {'identifier': 'admin', 'password': 'SmokeAdmin123!'})
    assert status == 200, payload
    assert payload['official']['isAdmin'] is True
    token = payload['token']

    status, payload = call(base, 'GET', '/api/session', token=token)
    assert status == 200
    assert payload['official']['username'] == 'admin'

    # Raw tokens must never appear as storage keys (only their SHA-256).
    backend = server['backend']
    import sqlite3
    conn = sqlite3.connect(backend.DB_PATH)
    keys = [row[0] for row in conn.execute("SELECT key FROM kv_store WHERE key LIKE 'sessions:%'")]
    conn.close()
    assert keys, 'expected a session row to exist'
    assert f'sessions:{token}' not in keys


def test_request_filing_and_duplicate_ref(server):
    base = server['base']
    payload = {
        'id': 'req_smoke1', 'refNumber': 'BRGY-2026-0001', 'type': 'clearance',
        'fullName': 'Juan Dela Cruz', 'contact': '09171234567',
        'address': 'Purok 1', 'status': 'Pending', 'dateSubmitted': 1234567890,
    }
    status, _ = call(base, 'POST', '/storage/set',
                     {'key': 'requests:req_smoke1', 'value': json.dumps(payload)})
    assert status == 200

    dup = dict(payload, id='req_smoke2')
    status, body = call(base, 'POST', '/storage/set',
                        {'key': 'requests:req_smoke2', 'value': json.dumps(dup)})
    assert status == 409, body

    status, body = call(base, 'GET', '/api/track?ref=brgy-2026-0001')
    assert status == 200
    assert body['request']['fullName'] == 'Juan Dela Cruz'


def test_registration_approval_and_admin_only_writes(server):
    base = server['base']
    backend = server['backend']
    salt, ph = backend._hash_password('Resident123')
    reg = {
        'username': 'resident1', 'fullName': 'Resident One', 'position': 'Barangay Staff',
        'email': 'resident1@gmail.com', 'status': 'pending',
        'salt': salt, 'passwordHash': ph, 'dateJoined': 123,
    }
    status, _ = call(base, 'POST', '/storage/set',
                     {'key': 'officials:resident1', 'value': json.dumps(reg)})
    assert status == 200

    # Pending accounts cannot log in.
    status, body = call(base, 'POST', '/api/login',
                        {'identifier': 'resident1', 'password': 'Resident123'})
    assert status == 403, body

    # Weak credential material is rejected at registration.
    bad = dict(reg, username='resident2', email='resident2@gmail.com',
               salt='short', passwordHash='alsoshort')
    status, _ = call(base, 'POST', '/storage/set',
                     {'key': 'officials:resident2', 'value': json.dumps(bad)})
    assert status == 400

    # Admin approves, then the resident can log in.
    status, payload = call(base, 'POST', '/api/login',
                           {'identifier': 'admin', 'password': 'SmokeAdmin123!'})
    admin_token = payload['token']
    approved = dict(reg, status='approved')
    status, _ = call(base, 'POST', '/storage/set',
                     {'key': 'officials:resident1', 'value': json.dumps(approved)},
                     token=admin_token)
    assert status == 200
    status, payload = call(base, 'POST', '/api/login',
                           {'identifier': 'resident1', 'password': 'Resident123'})
    assert status == 200, payload
    resident_token = payload['token']

    # Non-admin cannot post announcements or touch other officials.
    status, _ = call(base, 'POST', '/storage/set',
                     {'key': 'announcements:hack', 'value': json.dumps({'id': 'x'})},
                     token=resident_token)
    assert status == 403
    # ...but can update their own photo.
    status, _ = call(base, 'POST', '/storage/set',
                     {'key': 'officials:resident1', 'value': json.dumps({'photo': 'data:image/png;base64,xx'})},
                     token=resident_token)
    assert status == 200


def test_list_pagination(server):
    base = server['base']
    status, payload = call(base, 'GET', '/storage/list?prefix=announcements:&limit=1&offset=0')
    assert status == 200
    assert payload['total'] >= 0
    assert len(payload['keys']) <= 1
