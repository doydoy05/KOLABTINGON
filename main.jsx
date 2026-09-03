import React from "react";
import ReactDOM from "react-dom/client";
import App from "./java.jsx";
import "./styles.css";

/* Catches render crashes anywhere in the tree and shows a recoverable page
   instead of a blank screen. */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch() {
    /* Crash details stay in the console for debugging; nothing sensitive is shown. */
  }
  render() {
    if (this.state.crashed) {
      return (
        <div className="public-page" style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
          <h1>Something went wrong.</h1>
          <p>Please reload the page. If the problem continues, contact the barangay office.</p>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

if (!window.storage) {
  // Production builds talk to the backend host configured at build time:
  //   VITE_API_URL=https://your-backend.example.com npm run build
  // Empty (default) keeps dev behavior: same-origin relative URLs via the Vite proxy.
  const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  // Local-dev convenience only: when the backend is unreachable during `npm run dev`,
  // fall back to browser localStorage. Production builds NEVER do this — a failed
  // write must surface as an error, not silently land in the visitor's own browser.
  const LOCAL_FALLBACK = !import.meta.env.PROD;
  const api = (path) => `${API_BASE}${path}`;

  window.storage = {
    _authHeaders(extra = {}) {
      const headers = { ...extra };
      try {
        const token = localStorage.getItem("bportal_token");
        if (token) headers["Authorization"] = `Bearer ${token}`;
      } catch {}
      return headers;
    },
    _localKeys(prefix) {
      return Object.keys(localStorage).filter((key) => key.startsWith(prefix));
    },
    async list(prefix) {
      try {
        const res = await fetch(api(`/storage/list?prefix=${encodeURIComponent(prefix)}`), { headers: this._authHeaders() });
        if (res.ok) return await res.json();
        if (res.status === 403 || res.status === 404) return { keys: [] };
        throw new Error(`storage list failed: ${res.status}`);
      } catch (err) {
        if (!LOCAL_FALLBACK) throw err;
        return { keys: this._localKeys(prefix) };
      }
    },
    async get(key) {
      try {
        const res = await fetch(api(`/storage/get?key=${encodeURIComponent(key)}`), { headers: this._authHeaders() });
        if (res.ok) return await res.json();
        if (res.status === 404) return null;
        if (res.status === 403) return null;
        throw new Error(`storage get failed: ${res.status}`);
      } catch (err) {
        if (!LOCAL_FALLBACK) throw err;
        const value = localStorage.getItem(key);
        return value === null ? null : { value };
      }
    },
    async set(key, value) {
      try {
        const res = await fetch(api('/storage/set'), {
          method: 'POST',
          headers: this._authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ key, value }),
        });
        // A server rejection (validation / auth / duplicate) is final:
        // never persist it to localStorage, even in dev.
        if (res.ok) return true;
        return false;
      } catch (err) {
        if (!LOCAL_FALLBACK) throw err;
        localStorage.setItem(key, value);
        return true;
      }
    },
    async delete(key) {
      try {
        const res = await fetch(api(`/storage/delete?key=${encodeURIComponent(key)}`), {
          method: 'DELETE',
          headers: this._authHeaders(),
        });
        if (res.ok) return true;
        return false;
      } catch (err) {
        if (!LOCAL_FALLBACK) throw err;
        localStorage.removeItem(key);
        return true;
      }
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
