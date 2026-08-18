import React from "react";
import ReactDOM from "react-dom/client";
import App from "./java.jsx";
import "./styles.css";

if (!window.storage) {
  window.storage = {
    async list(prefix) {
      try {
        const res = await fetch(`/storage/list?prefix=${encodeURIComponent(prefix)}`);
        if (res.ok) return await res.json();
      } catch {
        // fallback to localStorage if backend is unavailable
      }
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
      return { keys };
    },
    async get(key) {
      try {
        const res = await fetch(`/storage/get?key=${encodeURIComponent(key)}`);
        if (res.ok) return await res.json();
        if (res.status === 404) return null;
      } catch {
        // fallback to localStorage if backend is unavailable
      }
      const value = localStorage.getItem(key);
      return value === null ? null : { value };
    },
    async set(key, value) {
      try {
        const res = await fetch('/storage/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        });
        if (res.ok) return true;
      } catch {
        // fallback to localStorage if backend is unavailable
      }
      localStorage.setItem(key, value);
      return true;
    },
    async delete(key) {
      try {
        const res = await fetch(`/storage/delete?key=${encodeURIComponent(key)}`, {
          method: 'DELETE',
        });
        if (res.ok) return true;
      } catch {
        // fallback to localStorage if backend is unavailable
      }
      localStorage.removeItem(key);
      return true;
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
