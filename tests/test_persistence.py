"""Persistence tests: code edits / restarts must never clobber officials.

Covers the reported bug: restarting with ADMIN_* env vars set used to rewrite
the admin account (and a fresh DB only ever seeds 'Maria Santos'). Restarts
now leave every existing row alone unless ADMIN_REPAIR=1.
"""

import glob
import importlib.util
import json
import os
import pathlib
import subprocess
import threading
import urllib.error
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
_counter = 0


def load_backend(monkeypatch, tmp_path, extra_env):
    """Import backend.py fresh (simulates a restart) with the given env."""
    global _counter
    _counter += 1
    base_env = {
        'STORAGE_DB_PATH': str(tmp_path / 'persist.db'),
        'LOCAL_LLAMA_MODEL_PATH': str(tmp_path / 'missing.gguf'),
        'HF_API_KEY': '',
        'DEEPSEEK_API_KEY': '',
        'ADMIN_PASSWORD': 'EnvPass123!',
        'ADMIN_EMAIL': 'admin@example.com',
        'ADMIN_FULLNAME': 'Env Admin',
    }
    base_env.update(extra_env)
    for key, value in base_env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv('TRUST_PROXY', raising=False)
    if 'ADMIN_REPAIR' not in extra_env:
        monkeypatch.delenv('ADMIN_REPAIR', raising=False)

    spec = importlib.util.spec_from_file_location(f'backend_ps{_counter}', ROOT / 'backend.py')
    backend = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backend)
    return backend


def serve(backend):
    httpd = backend.PortalServer(('127.0.0.1', 0), backend.StorageHandler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{port}'

    def stop():
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)

    return base, stop


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


def make_official(backend, base, admin_token, username='ana'):
    salt, ph = backend._hash_password('AnaPass123')
    rec = {
        'username': username, 'fullName': 'Ana Official', 'position': 'Kagawad',
        'email': f'{username}@gmail.com', 'status': 'approved',
        'salt': salt, 'passwordHash': ph, 'dateJoined': 5,
    }
    status, _ = call(base, 'POST', '/storage/set',
                     {'key': f'officials:{username}', 'value': json.dumps(rec)}, token=admin_token)
    assert status == 200


def test_restart_never_rewrites_existing_data(monkeypatch, tmp_path):
    backend1 = load_backend(monkeypatch, tmp_path, {})
    base1, stop1 = serve(backend1)
    try:
        status, payload = call(base1, 'POST', '/api/login',
                               {'identifier': 'admin', 'password': 'EnvPass123!'})
        assert status == 200, payload
        admin_token = payload['token']
        make_official(backend1, base1, admin_token)

        # Admin renames themselves and changes their password in the dashboard.
        status, _ = call(base1, 'POST', '/api/update-official',
                         {'username': 'admin',
                          'updates': {'fullName': 'New Punong', 'email': 'new@gmail.com'}},
                         token=admin_token)
        assert status == 200
        status, _ = call(base1, 'POST', '/api/change-password',
                         {'currentPw': 'EnvPass123!', 'newPw': 'MyOwnPass999!'}, token=admin_token)
        assert status == 200
    finally:
        stop1()

    # "Restart" with the SAME env (ADMIN_* still set): nothing may revert.
    backend2 = load_backend(monkeypatch, tmp_path, {})
    base2, stop2 = serve(backend2)
    try:
        status, payload = call(base2, 'POST', '/api/login',
                               {'identifier': 'admin', 'password': 'MyOwnPass999!'})
        assert status == 200, payload
        assert payload['official']['fullName'] == 'New Punong'
        assert payload['official']['email'] == 'new@gmail.com'
        # Env password must NOT work anymore — the boot did not rewrite it.
        status, _ = call(base2, 'POST', '/api/login',
                         {'identifier': 'admin', 'password': 'EnvPass123!'})
        assert status == 401
        # The created official survived the restart untouched.
        status, payload = call(base2, 'POST', '/api/login',
                               {'identifier': 'ana', 'password': 'AnaPass123'})
        assert status == 200, payload
        # A boot snapshot was written next to the database.
        assert glob.glob(str(tmp_path / 'backups' / 'boot-*.json')), 'expected a boot snapshot'
    finally:
        stop2()


def test_admin_repair_forces_env_values(monkeypatch, tmp_path):
    backend1 = load_backend(monkeypatch, tmp_path, {})
    base1, stop1 = serve(backend1)
    try:
        status, payload = call(base1, 'POST', '/api/login',
                               {'identifier': 'admin', 'password': 'EnvPass123!'})
        admin_token = payload['token']
        status, _ = call(base1, 'POST', '/api/change-password',
                         {'currentPw': 'EnvPass123!', 'newPw': 'MyOwnPass999!'}, token=admin_token)
        assert status == 200
    finally:
        stop1()

    backend2 = load_backend(monkeypatch, tmp_path, {'ADMIN_REPAIR': '1'})
    base2, stop2 = serve(backend2)
    try:
        status, payload = call(base2, 'POST', '/api/login',
                               {'identifier': 'admin', 'password': 'EnvPass123!'})
        assert status == 200, payload
        assert payload['official']['fullName'] == 'Env Admin'
    finally:
        stop2()


def test_relative_db_path_ignores_working_directory(monkeypatch, tmp_path):
    repo_backups = ROOT / 'backups'
    had_backups_dir = repo_backups.is_dir()
    before = set(repo_backups.glob('boot-*.json')) if had_backups_dir else set()
    db_file = ROOT / 'test-rel-persist.db'
    monkeypatch.setenv('STORAGE_DB_PATH', 'test-rel-persist.db')
    monkeypatch.chdir(tmp_path)
    try:
        spec = importlib.util.spec_from_file_location('backend_relpath', ROOT / 'backend.py')
        backend = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backend)
        assert backend.DB_PATH == str(db_file), backend.DB_PATH
        assert db_file.is_file(), 'database must be created next to backend.py, not the cwd'
        assert not (tmp_path / 'test-rel-persist.db').exists()

        # Data written from another cwd lands in the same file.
        monkeypatch.chdir(tmp_path / '..')
        backend.conn.execute("INSERT INTO kv_store (key, value) VALUES ('k1', '\"v1\"')")
        backend.conn.commit()
        import sqlite3
        check = sqlite3.connect(str(db_file))
        assert check.execute("SELECT value FROM kv_store WHERE key='k1'").fetchone()[0] == '"v1"'
        check.close()
    finally:
        monkeypatch.chdir(ROOT)
        for suffix in ('', '-wal', '-shm', '-journal'):
            try:
                os.remove(str(db_file) + suffix)
            except OSError:
                pass
        if True:  # remove snapshots this import wrote next to the repo DB dir
            for extra in set(repo_backups.glob('boot-*.json')) - before:
                try:
                    extra.unlink()
                except OSError:
                    pass
            if not had_backups_dir:
                try:
                    repo_backups.rmdir()
                except OSError:
                    pass


def test_wipe_then_restore_brings_officials_back(monkeypatch, tmp_path):
    backend1 = load_backend(monkeypatch, tmp_path, {})
    base1, stop1 = serve(backend1)
    try:
        status, payload = call(base1, 'POST', '/api/login',
                               {'identifier': 'admin', 'password': 'EnvPass123!'})
        make_official(backend1, base1, payload['token'])
        snaps = sorted((tmp_path / 'backups').glob('boot-*.json'))
        assert snaps, 'expected a boot snapshot to restore from'
        snap = str(snaps[-1])
    finally:
        stop1()

    # Simulate a host wipe: delete the database, restart fresh.
    for suffix in ('', '-wal', '-shm', '-journal'):
        try:
            os.remove(str(tmp_path / 'persist.db') + suffix)
        except OSError:
            pass
    backend2 = load_backend(monkeypatch, tmp_path, {})
    base2, stop2 = serve(backend2)
    try:
        status, _ = call(base2, 'POST', '/api/login',
                         {'identifier': 'ana', 'password': 'AnaPass123'})
        assert status == 401  # wiped: only the fresh demo/env admin exists
    finally:
        stop2()

    proc = subprocess.run(
        ['python3', str(ROOT / 'scripts' / 'restore_data.py'), snap,
         '--db', str(tmp_path / 'persist.db')],
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr

    backend3 = load_backend(monkeypatch, tmp_path, {})
    base3, stop3 = serve(backend3)
    try:
        status, payload = call(base3, 'POST', '/api/login',
                               {'identifier': 'ana', 'password': 'AnaPass123'})
        assert status == 200, payload
    finally:
        stop3()
