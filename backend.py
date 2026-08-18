from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os
import sqlite3
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

DB_PATH = os.path.join(os.path.dirname(__file__), 'storage.db')
HF_MODEL = os.environ.get('HF_MODEL', 'meta-llama/Llama-2-7b-chat-hf')
HF_API_KEY = os.environ.get('HF_API_KEY', '')
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

class StorageHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status=200, content_type='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _read_json(self):
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    def _send_json(self, status, payload):
        self._set_headers(status)
        self.wfile.write(json.dumps(payload).encode('utf-8'))

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
        if LOCAL_LLAMA is not None:
            return self._call_local_llama_model(prompt)
        if HF_API_KEY:
            return self._call_hf_model(prompt)
        return None, (
            'No local Llama runtime available and HF_API_KEY is not configured. '
            'Install llama-cpp-python and a local Llama model, or set HF_API_KEY.'
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

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/storage/list':
            params = parse_qs(parsed.query)
            prefix = params.get('prefix', [''])[0]
            cursor = conn.execute('SELECT key FROM kv_store WHERE key LIKE ? ORDER BY key', (f'{prefix}%',))
            keys = [row[0] for row in cursor.fetchall()]
            self._send_json(200, {'keys': keys})
            return

        if parsed.path == '/storage/get':
            params = parse_qs(parsed.query)
            key = params.get('key', [''])[0]
            row = conn.execute('SELECT value FROM kv_store WHERE key = ?', (key,)).fetchone()
            if row is None:
                self._send_json(404, {'error': 'Not found'})
                return
            self._send_json(200, {'value': row[0]})
            return

        self._send_json(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/storage/set':
            data = self._read_json()
            key = data.get('key')
            value = data.get('value')
            if not key or value is None:
                self._send_json(400, {'error': 'Key and value required'})
                return
            with conn:
                conn.execute('INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', (key, value))
            self._send_json(200, {'success': True})
            return

        if self.path == '/api/chat':
            data = self._read_json()
            user_input = data.get('input', '').strip()
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
            return

        self._send_json(404, {'error': 'Not found'})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == '/storage/delete':
            params = parse_qs(parsed.query)
            key = params.get('key', [''])[0]
            with conn:
                conn.execute('DELETE FROM kv_store WHERE key = ?', (key,))
            self._send_json(200, {'success': True})
            return

        self._send_json(404, {'error': 'Not found'})


def run(server_class=HTTPServer, handler_class=StorageHandler, port=8000):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f'Storage backend running on http://localhost:{port}')
    if HAS_LOCAL_LLAMA_MODEL:
        print(f'Using local Llama model at {LOCAL_LLAMA_MODEL_PATH}')
    elif HF_API_KEY:
        print(f'No local model found. Falling back to Hugging Face model {HF_MODEL}')
    elif os.environ.get('LOCAL_LLAMA_MODEL_PATH'):
        print(f'Local model path configured but not found: {LOCAL_LLAMA_MODEL_PATH}')
        print('Set LOCAL_LLAMA_MODEL_PATH to a valid GGUF file, or configure HF_API_KEY.')
    else:
        print('No local model configured and no HF_API_KEY set. Chat will return a warning message.')
    httpd.serve_forever()


if __name__ == '__main__':
    run()
