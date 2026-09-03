"""Rate-limit regression tests: per-client buckets behind a proxy, plus the
per-account reset backstop that survives IP rotation."""

import importlib.util
import json
import pathlib
import threading
import urllib.error
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

_counter = 0


def boot(monkeypatch, tmp_path, extra_env):
    global _counter
    _counter += 1
    env = {
        'STORAGE_DB_PATH': str(tmp_path / f'ratelimit{_counter}.db'),
        'LOCAL_LLAMA_MODEL_PATH': str(tmp_path / 'missing.gguf'),
        'HF_API_KEY': '',
        'DEEPSEEK_API_KEY': '',
        'ADMIN_PASSWORD': 'RateAdmin123!',
        'ADMIN_EMAIL': 'admin@example.com',
    }
    env.update(extra_env)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    # TRUST_PROXY default is "trust"; tests opt out explicitly when needed.
    if 'TRUST_PROXY' not in extra_env:
        monkeypatch.delenv('TRUST_PROXY', raising=False)

    spec = importlib.util.spec_from_file_location(f'backend_rl{_counter}', ROOT / 'backend.py')
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


@pytest.fixture()
def tight_track_server(monkeypatch, tmp_path):
    yield from boot(monkeypatch, tmp_path, {'RATE_LIMIT_TRACK': '2', 'RATE_LIMIT_TRACK_WINDOW': '60'})


@pytest.fixture()
def untrusted_proxy_server(monkeypatch, tmp_path):
    yield from boot(monkeypatch, tmp_path,
                    {'TRUST_PROXY': '0', 'RATE_LIMIT_TRACK': '2', 'RATE_LIMIT_TRACK_WINDOW': '60'})


@pytest.fixture()
def reset_server(monkeypatch, tmp_path):
    yield from boot(monkeypatch, tmp_path, {})


def call(base, method, path, body=None, token=None, xff=None):
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if xff:
        headers['X-Forwarded-For'] = xff
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


def test_track_throttle_is_per_client_ip(tight_track_server):
    base = tight_track_server['base']
    # Same client exhausts its own small bucket: 404 (lookup miss still counts),
    # 404, then 429 with a retry hint.
    assert call(base, 'GET', '/api/track?ref=NOPE', xff='1.1.1.1')[0] == 404
    assert call(base, 'GET', '/api/track?ref=NOPE', xff='1.1.1.1')[0] == 404
    status, payload = call(base, 'GET', '/api/track?ref=NOPE', xff='1.1.1.1')
    assert status == 429
    assert payload.get('retryAfter', 0) > 0
    # A different visitor behind the same proxy is unaffected.
    assert call(base, 'GET', '/api/track?ref=NOPE', xff='2.2.2.2')[0] == 404


def test_untrusted_proxy_shares_one_bucket(untrusted_proxy_server):
    base = untrusted_proxy_server['base']
    assert call(base, 'GET', '/api/track?ref=NOPE', xff='1.1.1.1')[0] == 404
    assert call(base, 'GET', '/api/track?ref=NOPE', xff='1.1.1.1')[0] == 404
    # X-Forwarded-For is ignored, so every visitor shares the direct peer's bucket.
    assert call(base, 'GET', '/api/track?ref=NOPE', xff='2.2.2.2')[0] == 429


def test_reset_throttle_survives_ip_rotation(reset_server):
    base = reset_server['base']
    # No SMTP configured, so each attempt fails at the send step (500) — but
    # still consumes the per-account quota. Rotating IPs must not dodge it.
    statuses = [
        call(base, 'POST', '/api/reset-request', {'identifier': 'admin'},
             xff=f'10.0.0.{i}')[0]
        for i in range(1, 5)
    ]
    assert statuses[:3] == [500, 500, 500]
    assert statuses[3] == 429
