import importlib.util
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def test_ensure_local_model_downloads_when_missing(monkeypatch, tmp_path):
    module_name = 'backend'
    module = importlib.util.module_from_spec(importlib.util.spec_from_file_location(module_name, ROOT / 'backend.py'))
    monkeypatch.setenv('LOCAL_LLAMA_MODEL_PATH', str(tmp_path / 'downloaded.gguf'))
    monkeypatch.setenv('LLAMA_MODEL_DOWNLOAD_URL', 'https://example.com/model.gguf')

    downloaded = {}

    def fake_urlretrieve(url, filename):
        downloaded['url'] = url
        downloaded['filename'] = filename
        pathlib.Path(filename).write_bytes(b'gguf-data')

    monkeypatch.setattr('urllib.request.urlretrieve', fake_urlretrieve)

    module.ensure_local_model()

    assert downloaded['url'] == 'https://example.com/model.gguf'
    assert pathlib.Path(downloaded['filename']).exists()
