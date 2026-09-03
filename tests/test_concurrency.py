"""Concurrency test: 20 simultaneous users doing reads + writes must all succeed
with no 5xx responses and no 'database is locked' failures."""

import concurrent.futures
import importlib.util
import json
import pathlib
import threading
import urllib.error
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
USERS = 20


@pytest.fixture()
def server(monkeypatch, tmp_path):
    monkeypatch.setenv('STORAGE_DB_PATH', str(tmp_path / 'concurrency.db'))
    monkeypatch.setenv('LOCAL_LLAMA_MODEL_PATH', str(tmp_path / 'missing.gguf'))
    monkeypatch.setenv('HF_API_KEY', '')
    monkeypatch.setenv('DEEPSEEK_API_KEY', '')
    monkeypatch.setenv('ADMIN_PASSWORD', 'Concurrent123!')
    monkeypatch.setenv('ADMIN_EMAIL', 'admin@example.com')
    monkeypatch.delenv('TRUST_PROXY', raising=False)

    spec = importlib.util.spec_from_file_location('backend_conc', ROOT / 'backend.py')
    backend = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backend)

    # Exercise the production server class (daemon threads, big backlog).
    httpd = backend.PortalServer(('127.0.0.1', 0), backend.StorageHandler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{port}'
    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=5)


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
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def user_session(base, worker):
    """One simulated user: log in, then mix reads and a write/delete cycle."""
    xff = f'192.0.2.{worker + 1}'
    failures = []

    def check(label, status, ok):
        if status >= 500 or not ok(status):
            failures.append(f'{label}: {status}')

    status, payload = call(base, 'POST', '/api/login',
                           {'identifier': 'admin', 'password': 'Concurrent123!'}, xff=xff)
    check('login', status, lambda s: s == 200)
    if status != 200:
        return failures
    token = payload['token']

    for i in range(10):
        status, _ = call(base, 'GET', '/api/session', token=token, xff=xff)
        check('session', status, lambda s: s == 200)
        status, _ = call(base, 'GET', '/storage/list?prefix=officials:', token=token, xff=xff)
        check('list', status, lambda s: s == 200)
        status, _ = call(base, 'GET', '/storage/get?key=officials:admin', token=token, xff=xff)
        check('get', status, lambda s: s == 200)
        status, _ = call(base, 'GET', '/api/track?ref=NOPE', xff=xff)
        check('track', status, lambda s: s == 404)
        status, _ = call(base, 'GET', '/api/rating', xff=xff)
        check('rating', status, lambda s: s == 200)

    key = f'announcements:conc-{worker}'
    value = json.dumps({'id': f'conc-{worker}', 'title': 't', 'body': 'b', 'datePosted': 1})
    status, _ = call(base, 'POST', '/storage/set', {'key': key, 'value': value}, token=token, xff=xff)
    check('write', status, lambda s: s == 200)
    status, _ = call(base, 'DELETE', f'/storage/delete?key={key}', token=token, xff=xff)
    check('delete', status, lambda s: s == 200)
    return failures


def test_twenty_simultaneous_users(server):
    with concurrent.futures.ThreadPoolExecutor(max_workers=USERS) as pool:
        results = list(pool.map(lambda w: user_session(server, w), range(USERS)))
    failures = [f for worker in results for f in worker]
    assert not failures, f'{len(failures)} failed calls, e.g. {failures[:5]}'
