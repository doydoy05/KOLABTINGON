# BPORTAL
Portal For the baranagy kolabtingon

## Local AI chat backend setup

This project now uses a Python backend at `backend.py` with optional legacy Node support in `server.js`.

### Run the backend

1. Install dependencies if needed: `npm install`
2. Install the Python local runtime dependency: `python -m pip install llama-cpp-python`
3. Download a local Llama 2 GGUF model, for example `meta-llama/Llama-2-7b-chat-hf`.
4. Set `LOCAL_LLAMA_MODEL_PATH` to the downloaded GGUF model file path, or place it at `models/Llama-2-7b-chat.gguf`.
5. Run the Python backend: `npm run pyserver`
6. Start the frontend in another terminal: `npm run dev`

### Local Llama runtime

By default the backend will use a local Llama 2 model if the model file exists at `LOCAL_LLAMA_MODEL_PATH`.

- No API key is required for local model generation.
- If the local model is missing, the backend can still fall back to Hugging Face inference when `HF_API_KEY` is set.
- Use `HF_MODEL` to override the remote model name if you want to keep remote fallback enabled.

### Notes

- Vite proxy forwards `/api` and `/storage` requests to `http://localhost:8000`.
- Local models must be downloaded separately and can be large (several GB).

### Notes

- Vite proxy forwards `/api` and `/storage` requests to `http://localhost:8000`.
- If you want local no-key operation later, you can replace the backend call with a local Llama runtime.
