import importlib.util
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_backend(monkeypatch, tmp_path):
    """Import backend.py with an isolated DB path so tests never touch storage.db."""
    monkeypatch.setenv('LOCAL_LLAMA_MODEL_PATH', str(tmp_path / 'missing.gguf'))
    monkeypatch.setenv('HF_API_KEY', '')
    monkeypatch.setenv('DEEPSEEK_API_KEY', '')
    spec = importlib.util.spec_from_file_location('backend_under_test', ROOT / 'backend.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules['backend_under_test'] = module
    spec.loader.exec_module(module)
    return module


def test_password_hash_and_verify(monkeypatch, tmp_path):
    backend = _load_backend(monkeypatch, tmp_path)
    salt, ph = backend._hash_password('secret123')
    assert backend._verify_password({'salt': salt, 'passwordHash': ph}, 'secret123')
    assert not backend._verify_password({'salt': salt, 'passwordHash': ph}, 'wrong')


def test_validate_request(monkeypatch, tmp_path):
    backend = _load_backend(monkeypatch, tmp_path)
    handler = backend.StorageHandler.__new__(backend.StorageHandler)
    good = {
        'id': 'req_abc123', 'refNumber': 'BRGY-2026-1234', 'type': 'clearance',
        'fullName': 'Juan Dela Cruz', 'contact': '09171234567',
        'address': 'Kolabtingon', 'status': 'Pending', 'dateSubmitted': 1234567890,
    }
    assert handler._validate_request(good) is True
    bad = dict(good, status='Approved')
    assert handler._validate_request(bad) is False
    bad2 = dict(good, id='bad-id')
    assert handler._validate_request(bad2) is False


def test_validate_feedback(monkeypatch, tmp_path):
    backend = _load_backend(monkeypatch, tmp_path)
    handler = backend.StorageHandler.__new__(backend.StorageHandler)
    good = {'id': 'fbk_abc', 'message': 'Great service!', 'rating': 5, 'dateSubmitted': 1234567890}
    assert handler._validate_feedback(good) is True
    assert handler._validate_feedback(dict(good, rating=9)) is False
    assert handler._validate_feedback(dict(good, message='  ')) is False


def test_call_model_errors_without_keys(monkeypatch, tmp_path):
    backend = _load_backend(monkeypatch, tmp_path)
    monkeypatch.setattr(backend, 'DEEPSEEK_API_KEY', '')
    monkeypatch.setattr(backend, 'HF_API_KEY', '')
    monkeypatch.setattr(backend, 'LOCAL_LLAMA', None)
    handler = backend.StorageHandler.__new__(backend.StorageHandler)
    reply, error = handler._call_model('hello')
    assert reply is None
    assert 'API keys' in error or 'Local Llama' in error


def test_gitignore_covers_secrets():
    content = (ROOT / '.gitignore').read_text()
    for entry in ('.env', 'storage.db', 'dist/', 'models/'):
        assert entry in content
