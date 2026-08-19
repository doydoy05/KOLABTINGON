import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Menu, X, FileCheck2, Receipt, HeartHandshake, Home, Briefcase, BadgeCheck,
  AlertCircle, MessageSquare, Search, ShieldCheck, LogIn, UserPlus, LogOut,
  ClipboardList, Megaphone, Users, LayoutDashboard, ChevronRight, ChevronDown,
  CheckCircle2, Clock, PackageCheck, XCircle, Plus, Trash2, Building2, Star,
  MapPin, Phone, Mail, Loader2, Pin as PinIcon, Settings, KeyRound, Mail as MailIcon,
  MessageSquareHeart, Send, EyeOff, Camera,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import logoUrl from "./Images/KOLABTINGON LOGO.jpg";
import chatIconUrl from "./Images/CHATBOT.jpg";
import cebuBgUrl from "./Images/CEBU.jpg.jpg";

/* ---------------------------------------------------------------------- */
/*  Content constants — edit these to rename/rebrand for a real barangay  */
/* ---------------------------------------------------------------------- */
const BARANGAY_NAME = "Barangay Kolabtingon";
const CITY_LINE = "Dumanjug, Cebu";
const TAGLINE = "Alang sa Katawhan, Andam Kanunay";
const TAGLINE_SUB = "For the people, always ready";

const SERVICE_TYPES = [
  { id: "clearance", label: "Barangay Clearance", desc: "Proof of good standing for jobs, permits, or transactions.", Icon: FileCheck2 },
  { id: "cedula", label: "Cedula (Community Tax Certificate)", desc: "Your annual community tax certificate.", Icon: Receipt },
  { id: "indigency", label: "Certificate of Indigency", desc: "For financial or medical assistance applications.", Icon: HeartHandshake },
  { id: "residency", label: "Certificate of Residency", desc: "Confirms you live within the barangay.", Icon: Home },
  { id: "business", label: "Business Permit Endorsement", desc: "Barangay endorsement before city permit filing.", Icon: Briefcase },
  { id: "id", label: "Barangay ID", desc: "Official identification issued by the barangay.", Icon: BadgeCheck },
  { id: "blotter", label: "Blotter / Complaint Report", desc: "File an incident report or dispute for the record.", Icon: AlertCircle },
  { id: "other", label: "Other Concern", desc: "Anything else you'd like to raise with the barangay.", Icon: MessageSquare },
];

const POSITIONS = [
  "Punong Barangay", "Barangay Kagawad", "SK Chairperson",
  "Barangay Secretary", "Barangay Treasurer", "Barangay Tanod", "Barangay Staff","SK Treasurer","SK Secretary","SK Councilor"
];

const STATUSES = ["Pending", "Processing", "Ready for Release", "Released", "Rejected"];
const STATUS_META = {
  "Pending": { Icon: Clock, cls: "status-pending" },
  "Processing": { Icon: ClipboardList, cls: "status-processing" },
  "Ready for Release": { Icon: PackageCheck, cls: "status-ready" },
  "Released": { Icon: CheckCircle2, cls: "status-released" },
  "Rejected": { Icon: XCircle, cls: "status-rejected" },
};

function genRefNumber() {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `BRGY-${year}-${rand}`;
}
function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function fmtDate(ts) {
  if (!ts) return "”";
  return new Date(ts).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

/* --------------------------- security helpers --------------------------- */
const pwEncoder = new TextEncoder();

function bufToBase64(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function generateSalt() {
  return bufToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

async function hashPassword(password, saltB64) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", pwEncoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64ToBytes(saltB64), iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return bufToBase64(bits);
}

function apiHeaders(extra = {}) {
  const headers = { ...extra };
  try {
    const token = localStorage.getItem("bportal_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch {}
  return headers;
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: apiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...payload };
}

async function apiGet(path) {
  const res = await fetch(path, { headers: apiHeaders() });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...payload };
}

/* --------------------------- photo helpers ------------------------------ */
function resizeImage(file, maxSize = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function OfficialAvatar({ official, sm }) {
  if (official && official.photo) {
    return <img src={official.photo} alt="" className={`official-avatar photo${sm ? " sm" : ""}`} />;
  }
  return (
    <div className={`official-avatar${sm ? " sm" : ""}`}>
      {(official && official.fullName ? official.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("") : "?")}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Small shared UI pieces                                                */
/* ---------------------------------------------------------------------- */
function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META["Pending"];
  const { Icon } = meta;
  return (
    <span className={`status-badge ${meta.cls}`}>
      <Icon size={13} strokeWidth={2.5} />
      {status}
    </span>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="field-label">
      <span>{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Modal({ onClose, children, width = 480, dark = false }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-card${dark ? " modal-card-dark" : ""}`} style={{ maxWidth: width }}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Main component                                                        */
/* ---------------------------------------------------------------------- */
export default function BarangayPortal() {
  const [booting, setBooting] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const [view, setView] = useState("public");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [requests, setRequests] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [officials, setOfficials] = useState([]);
  const [pendingOfficials, setPendingOfficials] = useState([]);

  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState("login");
  const [authError, setAuthError] = useState("");
  const [regMessage, setRegMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [currentOfficial, setCurrentOfficial] = useState(null);

  const [trackOpen, setTrackOpen] = useState(false);
  const [trackInput, setTrackInput] = useState("");
  const [trackResult, setTrackResult] = useState(undefined); // undefined = not searched, null = not found

  const [reqForm, setReqForm] = useState({ type: "", fullName: "", contact: "", address: "", details: "", comment: "" });
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState("");
  const [tickets, setTickets] = useState([]);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackList, setFeedbackList] = useState([]);
  const [publicRating, setPublicRating] = useState({ count: 0, average: 0 });

  const [dashTab, setDashTab] = useState("overview");
  const [forcePassword, setForcePassword] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");
  const [annForm, setAnnForm] = useState({ title: "", body: "" });
  const [annBusy, setAnnBusy] = useState(false);

  /* ------------------------------- loading ------------------------------ */
  const loadRequests = useCallback(async () => {
    try {
      const list = await window.storage.list("requests:", true);
      const keys = list && list.keys ? list.keys : [];
      const items = await Promise.all(keys.map(async (k) => {
        try {
          const r = await window.storage.get(k, true);
          return r ? JSON.parse(r.value) : null;
        } catch { return null; }
      }));
      setRequests(items.filter(Boolean).sort((a, b) => b.dateSubmitted - a.dateSubmitted));
    } catch { setRequests([]); }
  }, []);

  const loadAnnouncements = useCallback(async () => {
    try {
      const list = await window.storage.list("announcements:", true);
      const keys = list && list.keys ? list.keys : [];
      const items = await Promise.all(keys.map(async (k) => {
        try {
          const r = await window.storage.get(k, true);
          return r ? JSON.parse(r.value) : null;
        } catch { return null; }
      }));
      setAnnouncements(items.filter(Boolean).sort((a, b) => b.datePosted - a.datePosted));
    } catch { setAnnouncements([]); }
  }, []);

  const loadOfficials = useCallback(async () => {
    try {
      const list = await window.storage.list("officials:", true);
      const keys = list && list.keys ? list.keys : [];
      const items = await Promise.all(keys.map(async (k) => {
        try {
          const r = await window.storage.get(k, true);
          return r ? JSON.parse(r.value) : null;
        } catch { return null; }
      }));
      const valid = items.filter(Boolean).map(o => ({ ...o, status: o.status || "approved" }));
      setOfficials(valid.filter(o => o.status === "approved").sort((a, b) => a.dateJoined - b.dateJoined));
      setPendingOfficials(valid.filter(o => o.status === "pending").sort((a, b) => a.dateJoined - b.dateJoined));
    } catch { setOfficials([]); setPendingOfficials([]); }
  }, []);

  const loadFeedback = useCallback(async () => {
    try {
      const list = await window.storage.list("feedback:", true);
      const keys = list && list.keys ? list.keys : [];
      const items = await Promise.all(keys.map(async (k) => {
        try {
          const r = await window.storage.get(k, true);
          return r ? JSON.parse(r.value) : null;
        } catch { return null; }
      }));
      setFeedbackList(items.filter(Boolean).sort((a, b) => b.dateSubmitted - a.dateSubmitted));
    } catch { setFeedbackList([]); }
  }, []);

  const loadPublicRating = useCallback(async () => {
    try {
      const res = await apiGet("/api/rating");
      if (res.ok) setPublicRating({ count: res.count || 0, average: res.average || 0 });
    } catch { /* keep last known value */ }
  }, []);

  useEffect(() => {
    (async () => {
      setBooting(true);
      try {
        let loggedIn = false;
        const token = localStorage.getItem("bportal_token");
        if (token) {
          try {
            const res = await apiGet("/api/session");
            if (res.ok) {
              setCurrentOfficial(res.official);
              loggedIn = true;
            } else {
              localStorage.removeItem("bportal_token");
            }
          } catch { /* keep session attempt non-fatal */ }
        }
        await Promise.all([
          loadAnnouncements(),
          loadOfficials(),
          loadPublicRating(),
          loggedIn ? loadRequests() : Promise.resolve(),
          loggedIn ? loadFeedback() : Promise.resolve(),
        ]);
      } catch { setStorageError(true); }
      setBooting(false);
    })();
  }, [loadRequests, loadAnnouncements, loadOfficials, loadFeedback, loadPublicRating]);

  /* Poll the backend while a ticket is showing so status updates from staff appear live */
  useEffect(() => {
    if (tickets.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      const latest = await Promise.all(tickets.map(async (t) => {
        try {
          const res = await apiGet(`/api/track?ref=${encodeURIComponent(t.refNumber)}`);
          return res.ok && res.request ? res.request : t;
        } catch { return t; }
      }));
      if (cancelled) return;
      setTickets(latest);
      setRequests((prev) => prev.map((x) => latest.find((l) => l.id === x.id) || x));
    };
    const timer = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [tickets.map((t) => t.id).join(",")]);

  /* ------------------------------- actions ------------------------------ */
  async function handleSubmitRequest() {
    setReqError("");
    if (!reqForm.type || !reqForm.fullName.trim() || !reqForm.contact.trim() || !reqForm.address.trim()) {
      setReqError("Please fill in your name, contact number, address, and the type of request.");
      return false;
    }
    setReqBusy(true);
    const id = genId("req");
    const payload = {
      id,
      refNumber: genRefNumber(),
      type: reqForm.type,
      fullName: reqForm.fullName.trim(),
      contact: reqForm.contact.trim(),
      address: reqForm.address.trim(),
      details: reqForm.details.trim(),
      comment: reqForm.comment.trim(),
      status: "Pending",
      dateSubmitted: Date.now(),
      lastUpdated: Date.now(),
    };
    try {
      const result = await window.storage.set(`requests:${id}`, JSON.stringify(payload), true);
      if (!result) throw new Error("Storage returned no result");
      setRequests((prev) => [payload, ...prev]);
      setTickets((prev) => [payload, ...prev]);
      setReqForm({ type: "", fullName: "", contact: "", address: "", details: "", comment: "" });
      setReqBusy(false);
      return true;
    } catch {
      setReqError("Something went wrong saving your request. Please try again.");
      setReqBusy(false);
      return false;
    }
  }

  async function handleSubmitFeedback(message, rating) {
    const id = genId("fbk");
    const payload = {
      id,
      rating: rating || 0,
      message: message.trim(),
      dateSubmitted: Date.now(),
    };
    try {
      const result = await window.storage.set(`feedback:${id}`, JSON.stringify(payload), true);
      if (!result) throw new Error("Storage returned no result");
      setFeedbackList((prev) => [payload, ...prev]);
      loadPublicRating();
      return true;
    } catch {
      return false;
    }
  }

  async function handleTrack() {
    const ref = trackInput.trim().toUpperCase();
    if (!ref) return;
    try {
      const res = await apiGet(`/api/track?ref=${encodeURIComponent(ref)}`);
      if (res.ok && res.request) {
        setTrackResult(res.request);
        setRequests((prev) => (prev.some((x) => x.id === res.request.id) ? prev : [res.request, ...prev]));
        return;
      }
    } catch { /* fall through to not-found */ }
    setTrackResult(null);
  }

  async function handleRegister(form) {
    setAuthError("");
    setRegMessage("");
    if (!form.username.trim() || !form.password || !form.fullName.trim() || !form.position || !form.email.trim()) {
      setAuthError("Please complete every field.");
      return;
    }
    if (form.password !== form.confirm) {
      setAuthError("Passwords do not match.");
      return;
    }
    const email = form.email.trim().toLowerCase();
    if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email)) {
      setAuthError("Please enter a valid Gmail address (name@gmail.com).");
      return;
    }
    setAuthBusy(true);
    const username = form.username.trim().toLowerCase();

    // Check if username or Gmail already exists (approved or pending)
    const sameUsername = officials.find(o => o.username === username) || pendingOfficials.find(o => o.username === username);
    if (sameUsername) {
      setAuthError("That username is already taken. Please choose another.");
      setAuthBusy(false);
      return;
    }
    const sameEmail = officials.find(o => o.email && o.email.toLowerCase() === email) || pendingOfficials.find(o => o.email && o.email.toLowerCase() === email);
    if (sameEmail) {
      setAuthError("That Gmail address is already registered. Please use another.");
      setAuthBusy(false);
      return;
    }
    const salt = await generateSalt();
    const passwordHash = await hashPassword(form.password, salt);
    const official = {
      username,
      email,
      fullName: form.fullName.trim(),
      position: form.position,
      status: "pending",
      salt,
      passwordHash,
      mustChangePassword: true,
      dateJoined: Date.now(),
    };
    try {
      const result = await window.storage.set(`officials:${username}`, JSON.stringify(official), true);
      if (!result) throw new Error("no result");
      setPendingOfficials((prev) => [...prev, official]);
      setRegMessage("Your registration has been submitted. An admin must approve your account before you can log in.");
    } catch {
      setAuthError("Could not submit your registration. Please try again.");
    }
    setAuthBusy(false);
  }

  async function handleLogin(form) {
    setAuthError("");
    if (!form.username.trim() || !form.password) {
      setAuthError("Enter your username or Gmail and password.");
      return;
    }
    setAuthBusy(true);
    try {
      const res = await apiPost("/api/login", {
        identifier: form.username.trim().toLowerCase(),
        password: form.password,
      });
      if (!res.ok) {
        setAuthError(res.error || "Login failed.");
        setAuthBusy(false);
        return;
      }
      localStorage.setItem("bportal_token", res.token);
      setCurrentOfficial(res.official);
      setAuthOpen(false);
      setView("dashboard");
      setDashTab(res.official.mustChangePassword ? "settings" : "overview");
      setForcePassword(!!res.official.mustChangePassword);
      await Promise.all([loadRequests(), loadFeedback()]);
      setAuthBusy(false);
    } catch {
      setAuthError("Could not reach the server. Please try again.");
      setAuthBusy(false);
    }
  }

  function handleLogout() {
    const token = localStorage.getItem("bportal_token");
    if (token) {
      fetch("/api/logout", { method: "POST", headers: apiHeaders() }).catch(() => {});
    }
    localStorage.removeItem("bportal_token");
    setCurrentOfficial(null);
    setRequests([]);
    setFeedbackList([]);
    setView("public");
    setDashTab("overview");
  }

  async function changePassword(currentPw, newPw) {
    if (!currentOfficial) return { ok: false, error: "You are not logged in." };
    if (!currentPw || !newPw) return { ok: false, error: "Please fill in every field." };
    if (newPw.length < 6) return { ok: false, error: "New password must be at least 6 characters." };
    try {
      const res = await apiPost("/api/change-password", { currentPw, newPw });
      if (!res.ok) return { ok: false, error: res.error || "Could not update your password." };
      setCurrentOfficial(res.official);
      setOfficials((prev) => prev.map((o) => (o.username === res.official.username ? res.official : o)));
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not update your password. Please try again." };
    }
  }

  async function updateProfilePhoto(photo) {
    if (!currentOfficial) return false;
    try {
      const res = await apiPost("/api/update-official", {
        username: currentOfficial.username,
        updates: { photo },
      });
      if (!res.ok) return false;
      setCurrentOfficial(res.official);
      setOfficials((prev) => prev.map((o) => (o.username === res.official.username ? res.official : o)));
      return true;
    } catch {
      return false;
    }
  }

  async function requestReset(identifier) {
    if (!identifier.trim()) return { ok: false, error: "Enter your username or Gmail address." };
    try {
      const res = await apiPost("/api/reset-request", { identifier: identifier.trim().toLowerCase() });
      if (!res.ok) return { ok: false, error: res.error || "Could not start a password reset. Please try again." };
      return { ok: true, code: res.code };
    } catch {
      return { ok: false, error: "Could not start a password reset. Please try again." };
    }
  }

  async function completeReset(identifier, code, newPw) {
    if (!code || !newPw) return { ok: false, error: "Enter the reset code and a new password." };
    if (newPw.length < 6) return { ok: false, error: "New password must be at least 6 characters." };
    try {
      const res = await apiPost("/api/reset-complete", {
        identifier: identifier.trim().toLowerCase(),
        code: code.trim(),
        newPw,
      });
      if (!res.ok) return { ok: false, error: res.error || "Could not reset your password. Please try again." };
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reset your password. Please try again." };
    }
  }

  async function approveOfficial(username) {
    const target = pendingOfficials.find((o) => o.username === username);
    if (!target) return;
    const updated = { ...target, status: "approved" };
    setPendingOfficials((prev) => prev.filter((o) => o.username !== username));
    setOfficials((prev) => [...prev, updated].sort((a, b) => a.dateJoined - b.dateJoined));
    try {
      await window.storage.set(`officials:${username}`, JSON.stringify(updated), true);
    } catch { loadOfficials(); }
  }

  async function rejectOfficial(username) {
    const target = pendingOfficials.find((o) => o.username === username);
    if (!target) return;
    const updated = { ...target, status: "rejected" };
    setPendingOfficials((prev) => prev.filter((o) => o.username !== username));
    try {
      await window.storage.set(`officials:${username}`, JSON.stringify(updated), true);
    } catch { loadOfficials(); }
  }

  async function updateStatus(id, status) {
    const target = requests.find((r) => r.id === id);
    if (!target) return;
    const updated = { ...target, status, lastUpdated: Date.now() };
    setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
    try {
      await window.storage.set(`requests:${id}`, JSON.stringify(updated), true);
    } catch {
      loadRequests();
    }
  }

  async function postAnnouncement() {
    if (!annForm.title.trim() || !annForm.body.trim()) return;
    setAnnBusy(true);
    const id = genId("ann");
    const payload = {
      id,
      title: annForm.title.trim(),
      body: annForm.body.trim(),
      author: currentOfficial ? currentOfficial.fullName : "Barangay Office",
      datePosted: Date.now(),
    };
    try {
      await window.storage.set(`announcements:${id}`, JSON.stringify(payload), true);
      setAnnouncements((prev) => [payload, ...prev]);
      setAnnForm({ title: "", body: "" });
    } catch { /* keep form as-is so they can retry */ }
    setAnnBusy(false);
  }

  async function deleteAnnouncement(id) {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    try {
      await window.storage.delete(`announcements:${id}`, true);
    } catch { loadAnnouncements(); }
  }

  const scrollTo = (id) => {
    setMobileMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ------------------------------ derived -------------------------------- */
  const counts = STATUSES.reduce((acc, s) => { acc[s] = requests.filter((r) => r.status === s).length; return acc; }, {});
  const chartData = SERVICE_TYPES.map((s) => ({
    name: s.label,
    count: requests.filter((r) => r.type === s.id).length,
  })).filter((d) => d.count > 0);
  const filteredRequests = statusFilter === "All" ? requests : requests.filter((r) => r.status === statusFilter);

  /* -------------------------------------------------------------------- */
  return (
    <div className="portal-root">
      <FontsAndStyles />

      {view === "public" ? (
        <PublicSite
          booting={booting}
          storageError={storageError}
          mobileMenuOpen={mobileMenuOpen}
          setMobileMenuOpen={setMobileMenuOpen}
          scrollTo={scrollTo}
          setAuthOpen={setAuthOpen}
          setAuthTab={setAuthTab}
          setTrackOpen={setTrackOpen}
          setFeedbackOpen={setFeedbackOpen}
          publicRating={publicRating}
          officials={officials}
          announcements={announcements}
          reqForm={reqForm}
          setReqForm={setReqForm}
          reqBusy={reqBusy}
          reqError={reqError}
          handleSubmitRequest={handleSubmitRequest}
          setReqError={setReqError}
          tickets={tickets}
          setTickets={setTickets}
        />
      ) : (
        <Dashboard
          currentOfficial={currentOfficial}
          handleLogout={handleLogout}
          dashTab={dashTab}
          setDashTab={setDashTab}
          setView={setView}
          requests={requests}
          counts={counts}
          chartData={chartData}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          filteredRequests={filteredRequests}
          updateStatus={updateStatus}
          announcements={announcements}
          annForm={annForm}
          setAnnForm={setAnnForm}
          annBusy={annBusy}
          postAnnouncement={postAnnouncement}
          deleteAnnouncement={deleteAnnouncement}
          officials={officials}
          pendingOfficials={pendingOfficials}
          approveOfficial={approveOfficial}
          rejectOfficial={rejectOfficial}
          changePassword={changePassword}
          updateProfilePhoto={updateProfilePhoto}
          forcePassword={forcePassword}
          setForcePassword={setForcePassword}
          feedback={feedbackList}
        />
      )}

      {authOpen && (
        <AuthModal
          authTab={authTab}
          setAuthTab={setAuthTab}
          authError={authError}
          setAuthError={setAuthError}
          regMessage={regMessage}
          setRegMessage={setRegMessage}
          authBusy={authBusy}
          onClose={() => { setAuthOpen(false); setAuthError(""); setRegMessage(""); }}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onRequestReset={requestReset}
          onCompleteReset={completeReset}
        />
      )}

      {feedbackOpen && (
        <FeedbackModal
          onClose={() => setFeedbackOpen(false)}
          onSubmit={handleSubmitFeedback}
        />
      )}

      {trackOpen && (
        <Modal dark onClose={() => { setTrackOpen(false); setTrackResult(undefined); setTrackInput(""); }}>
          <h3 className="modal-title">Track a request</h3>
          <p className="modal-sub">Enter the reference number from your ticket stub.</p>
          <div className="track-row">
            <input
              className="text-input mono-input"
              placeholder="BRGY-2026-0000"
              value={trackInput}
              onChange={(e) => setTrackInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTrack()}
            />
            <button className="btn-primary" onClick={handleTrack}><Search size={16} /> Find</button>
          </div>
          {trackResult === null && (
            <p className="track-empty">No request matches that reference number. Double-check it and try again.</p>
          )}
          {trackResult && (
            <div className="track-result">
              <div className="track-result-row"><span>Request</span><strong>{SERVICE_TYPES.find(s => s.id === trackResult.type)?.label || "Other Concern"}</strong></div>
              <div className="track-result-row"><span>Filed by</span><strong>{trackResult.fullName}</strong></div>
              <div className="track-result-row"><span>Submitted</span><strong>{fmtDate(trackResult.dateSubmitted)}</strong></div>
              <div className="track-result-row"><span>Status</span><StatusBadge status={trackResult.status} /></div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Public-facing site                                                    */
/* ---------------------------------------------------------------------- */
function PublicSite({
  booting, storageError, mobileMenuOpen, setMobileMenuOpen, scrollTo,
  setAuthOpen, setAuthTab, setTrackOpen, setFeedbackOpen, publicRating, officials, announcements,
  reqForm, setReqForm, reqBusy, reqError, setReqError, handleSubmitRequest, tickets, setTickets,
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const avgRating = publicRating.average || 0;
  const [chatMessages, setChatMessages] = useState([
    {
      sender: "bot",
      text: "Hi! I can help you choose a request type, guide you through filing, or open tracking for you.",
    },
  ]);

  const appendChatMessage = (sender, text) => {
    setChatMessages((prev) => [...prev, { sender, text }]);
  };

  const handleChatSend = async () => {
    const query = chatInput.trim();
    if (!query) return;

    const outgoingHistory = [...chatMessages, { sender: "user", text: query }];
    setChatMessages(outgoingHistory);
    setChatInput("");
    setChatLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: query, history: outgoingHistory }),
      });
      const payload = await response.json();
      if (payload.reply) {
        appendChatMessage("bot", payload.reply);
      } else if (payload.error) {
        appendChatMessage("bot", payload.error);
      } else {
        appendChatMessage("bot", "Sorry, I couldn't get a reply from the backend.");
      }
    } catch (error) {
      appendChatMessage("bot", "Sorry, chat failed. Please try again.");
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="public-page">
      <header className="site-header">
        <div className="header-inner">
          <div className="left-header">
            <button
              className="nav-burger"
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div className="brand" onClick={() => scrollTo("top")}>
              <Seal size={40} />
              <div className="brand-text">
                <span className="brand-name">{BARANGAY_NAME}</span>
                <span className="brand-city">{CITY_LINE}</span>
              </div>
            </div>
          </div>
          <div className="header-actions">
            <div className="header-feedback-row">
              <button
                className="header-feedback-btn"
                onClick={() => setFeedbackOpen(true)}
              >
                <MessageSquareHeart size={15} />
                <span>Feedback</span>
              </button>
              {publicRating.count > 0 && (
                <span className="header-rating">
                  Rating:
                  <span className="header-rating-stars">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={13} fill={n <= Math.round(avgRating) ? "currentColor" : "none"} />
                    ))}
                  </span>
                  <strong>{avgRating.toFixed(1)}</strong>
                </span>
              )}
            </div>
            <button
              className="btn-primary sm"
              onClick={() => {
                setAuthTab("login");
                setAuthOpen(true);
              }}
            >
              <ShieldCheck size={15} />
              Official Login
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="nav-mobile">
            <button onClick={() => scrollTo("services")}>Services</button>
            <button onClick={() => scrollTo("announcements")}>Announcements</button>
            <button onClick={() => scrollTo("officials")}>Officials</button>
            <button onClick={() => { setMobileMenuOpen(false); setTrackOpen(true); }}>Track a request</button>
            <button onClick={() => { setMobileMenuOpen(false); setFeedbackOpen(true); }}>Send feedback</button>
            <button onClick={() => { setMobileMenuOpen(false); setAuthTab("login"); setAuthOpen(true); }}>Officials Login</button>
          </div>
        )}
      </header>

      <main id="top">
        {/* Hero */}
        <section className="hero">
          <div className="hero-text">
            <span className="eyebrow">Barangay e-Services</span>
            <h1>{TAGLINE}</h1>
            <p className="hero-sub-fil">{TAGLINE_SUB}</p>
            <p className="hero-body">
              Request documents, raise a concern, or check on something you already filed
              no need to line up at the barangay hall to get started.
            </p>
            <div className="hero-ctas">
              <button className="btn-primary lg" onClick={() => scrollTo("request-form")}>
                File a request <ChevronRight size={16} />
              </button>
              <button className="btn-ghost lg" onClick={() => setTrackOpen(true)}>
                <Search size={16} /> Track a request
              </button>
            </div>
          </div>
          <div className="hero-seal">
            <Seal size={190} />
          </div>
        </section>

        {storageError && (
          <div className="banner-warning">
            Data couldn't be reached right now. You can still browse, but requests and
            announcements may not load or save until this is available again.
          </div>
        )}

        {/* Services */}
        <section id="services" className="section">
          <SectionHeading eyebrow="What we offer" title="Documents &amp; services" />
          <div className="services-grid">
            {SERVICE_TYPES.map((s) => (
              <div key={s.id} className="service-card">
                <div className="service-icon"><s.Icon size={20} /></div>
                <h3>{s.label}</h3>
                <p>{s.desc}</p>
                <button
                  className="service-link"
                  onClick={() => { setReqForm((f) => ({ ...f, type: s.id })); setReqError(""); setQuickOpen(true); }}
                >
                  Request this <ChevronRight size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Announcements */}
        <section id="announcements" className="section section-alt">
          <SectionHeading eyebrow="Community board" title="Announcements" />
          {booting ? (
            <LoadingRow label="Loading announcementsâ€¦" />
          ) : announcements.length === 0 ? (
            <p className="empty-note">Nothing posted yet. Check back soon this is where the barangay office will pin community notices.</p>
          ) : (
            <div className="corkboard">
              {announcements.slice(0, 6).map((a, i) => (
                <div key={a.id} className="pin-note" style={{ transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (1.5 + (i % 3))}deg)` }}>
                  <PinIcon size={16} className="pin-icon" />
                  <h4>{a.title}</h4>
                  <p>{a.body}</p>
                  <div className="pin-meta">{a.author}, {fmtDate(a.datePosted)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Request form */}
        <section id="request-form" className="section">
          <SectionHeading eyebrow="Get started" title="File a request or concern" />
          <div className="request-layout">
            <div className="request-form-card">
              <RequestFields reqForm={reqForm} setReqForm={setReqForm} reqError={reqError} reqBusy={reqBusy} onSubmit={handleSubmitRequest} />
            </div>

            <div className="ticket-slot">
              {tickets.length > 0 ? (
                <div className="ticket-list">
                  {tickets.map((t) => (
                    <TicketStub key={t.id} ticket={t} onDismiss={() => setTickets((prev) => prev.filter((x) => x.id !== t.id))} />
                  ))}
                </div>
              ) : (
                <div className="ticket-placeholder">
                  <FileCheck2 size={28} />
                  <p>Your reference ticket will appear here once you submit a request. Keep the number it's how you'll track your request.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Officials directory (public, read-only) */}
        <section id="officials" className="section section-alt">
          <SectionHeading eyebrow="Transparency" title="Meet your officials" />
          {booting ? (
            <LoadingRow label="Loading officialsâ€¦" />
          ) : officials.length === 0 ? (
            <p className="empty-note">No officials have registered a dashboard account yet.</p>
          ) : (
            <div className="officials-grid">
              {officials.map((o) => (
                <div key={o.username} className="official-card">
                  <OfficialAvatar official={o} />
                  <div>
                    <div className="official-name">{o.fullName}</div>
                    <div className="official-position">{o.position}</div>
                    {o.email && <div className="table-sub">{o.email}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div>
            <div className="brand" style={{ marginBottom: 10 }}>
              <Seal size={32} />
              <div className="brand-text">
                <span className="brand-name" style={{ color: "#FAF6ED" }}>{BARANGAY_NAME}</span>
              </div>
            </div>
          </div>
          <div className="footer-contact">
            <div><MapPin size={14} /> Barangay Kolabtingon, {CITY_LINE}</div>
            <div><Phone size={14} /> (032) 000-0000</div>
            <div><Mail size={14} /> office@{BARANGAY_NAME.toLowerCase().replace(/\s+/g, "")}.gov.ph</div>
          </div>
        </div>
      </footer>

      {quickOpen && (
        <Modal onClose={() => { setQuickOpen(false); setReqError(""); }}>
          <h3 className="modal-title">File a request</h3>
          <p className="modal-sub">
            {SERVICE_TYPES.find((s) => s.id === reqForm.type)
              ? `Filing for ${SERVICE_TYPES.find((s) => s.id === reqForm.type).label}.`
              : "Fill in your details to submit a request."}
          </p>
          <RequestFields
            reqForm={reqForm}
            setReqForm={setReqForm}
            reqError={reqError}
            reqBusy={reqBusy}
            onSubmit={async () => {
              const ok = await handleSubmitRequest();
              if (ok) setQuickOpen(false);
            }}
          />
        </Modal>
      )}

      <div className="chat-widget">
        <button className="chat-toggle" onClick={() => setChatOpen((v) => !v)}>
          <img src={chatIconUrl} alt="Chat" className="chat-toggle-icon" />
        </button>
        {chatOpen && (
          <div className="chat-panel">
            <div className="chat-header">
              <MessageSquare size={16} />
              <span>Tambay nga AI</span>
            </div>
            <div className="chat-messages">
              {chatMessages.map((message, index) => (
                <div key={index} className={`chat-message ${message.sender}`}>
                  <span>{message.text}</span>
                </div>
              ))}
            </div>
            <div className="chat-input-row">
              <input
                className="text-input"
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
                placeholder="Ask about request types, tracking, or filing..."
              />
              <button className="btn-primary sm" onClick={handleChatSend} disabled={chatLoading}>
                {chatLoading ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title }) {
  return (
    <div className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

function LoadingRow({ label }) {
  return <div className="loading-row"><Loader2 size={16} className="spin" /> {label}</div>;
}

function Seal({ size }) {
  return (
    <div className="seal" style={{ width: size, height: size }}>
      <img src={logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
}

function TypeOfRequestSelect({ reqForm, setReqForm }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selected = SERVICE_TYPES.find((s) => s.id === reqForm.type);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="type-select" ref={wrapRef}>
      <button
        type="button"
        className="type-select-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? "" : "type-select-placeholder"}>
          {selected ? selected.label : "Select a request type"}
        </span>
        <ChevronDown size={16} className={`type-select-chev${open ? " open" : ""}`} />
      </button>
      {open && (
        <div className="type-select-menu">
          {SERVICE_TYPES.map((s) => (
            <div key={s.id} className="type-option-wrap">
              <button
                type="button"
                className={`type-option${s.id === reqForm.type ? " active" : ""}`}
                onClick={() => {
                  setReqForm((f) => ({ ...f, type: s.id }));
                  if (s.id !== "other") setOpen(false);
                }}
              >
                {s.label}
              </button>
              {s.id === "other" && reqForm.type === "other" && (
                <div className="type-comment-row">
                  <span>Comment:</span>
                  <input
                    className="text-input type-comment-input"
                    value={reqForm.comment || ""}
                    onChange={(e) => setReqForm((f) => ({ ...f, comment: e.target.value }))}
                    placeholder="Describe your concern..."
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestFields({ reqForm, setReqForm, reqError, reqBusy, onSubmit }) {
  return (
    <>
      <Field label="Type of request">
        <TypeOfRequestSelect reqForm={reqForm} setReqForm={setReqForm} />
      </Field>
      <Field label="Full name">
        <input className="text-input" value={reqForm.fullName}
          onChange={(e) => setReqForm((f) => ({ ...f, fullName: e.target.value }))} placeholder="Juan Dela Cruz" />
      </Field>
      <div className="field-row">
        <Field label="Contact number">
          <input className="text-input" value={reqForm.contact}
            onChange={(e) => setReqForm((f) => ({ ...f, contact: e.target.value }))} placeholder="09XX XXX XXXX" />
        </Field>
        <Field label="Address / Purok">
          <input className="text-input" value={reqForm.address}
            onChange={(e) => setReqForm((f) => ({ ...f, address: e.target.value }))} placeholder="Purok 3, Sitio Sampaguita" />
        </Field>
      </div>
      {reqForm.type !== "other" && (
        <Field label="Details" hint="Purpose of the document, or describe your concern">
          <textarea className="text-input" rows={4} value={reqForm.details}
            onChange={(e) => setReqForm((f) => ({ ...f, details: e.target.value }))}
            placeholder="e.g. For job application at..." />
        </Field>
      )}
      {reqError && <p className="form-error">{reqError}</p>}
      <button className="btn-primary lg" disabled={reqBusy} onClick={onSubmit}>
        {reqBusy ? <><Loader2 size={16} className="spin" /> Submitting&hellip;</> : <>Submit request <ChevronRight size={16} /></>}
      </button>
    </>
  );
}

function TicketStub({ ticket, onDismiss }) {
  const service = SERVICE_TYPES.find((s) => s.id === ticket.type);
  return (
    <div className="ticket-stub">
      <button className="ticket-dismiss" onClick={onDismiss} aria-label="Dismiss"><X size={14} /></button>
      <div className="ticket-stamp">Filed</div>
      <div className="ticket-eyebrow">Reference number</div>
      <div className="ticket-ref">{ticket.refNumber}</div>
      <div className="ticket-perf" />
      <div className="ticket-body">
        <div><span>Request</span><strong>{service ? service.label : "Other Concern"}</strong></div>
        <div><span>Name</span><strong>{ticket.fullName}</strong></div>
        <div><span>Filed</span><strong>{fmtDate(ticket.dateSubmitted)}</strong></div>
        <div><span>Status</span><StatusBadge status={ticket.status} /></div>
      </div>
      <p className="ticket-hint">Save this number to track your request, or show it at the barangay hall.</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Auth modal (login / register)                                         */
/* ---------------------------------------------------------------------- */
function AuthModal({ authTab, setAuthTab, authError, setAuthError, regMessage, setRegMessage, authBusy, onClose, onLogin, onRegister, onRequestReset, onCompleteReset }) {
  const [login, setLogin] = useState({ username: "", password: "" });
  const [reg, setReg] = useState({ username: "", password: "", confirm: "", fullName: "", position: "", email: "" });
  const [resetId, setResetId] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPw, setResetPw] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetStep, setResetStep] = useState(1); // 1 = request code, 2 = enter code + new pw, 3 = done
  const [resetMsg, setResetMsg] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const goReset = () => {
    setAuthTab("reset");
    setAuthError("");
    setRegMessage("");
    setResetId("");
    setResetCode("");
    setResetPw("");
    setResetConfirm("");
    setResetStep(1);
    setResetMsg("");
    setResetError("");
  };

  const handleSendCode = async () => {
    setResetError("");
    setResetBusy(true);
    const res = await onRequestReset(resetId);
    setResetBusy(false);
    if (!res.ok) { setResetError(res.error); return; }
    setResetStep(2);
    setResetMsg("A 6-digit reset code has been emailed to you. Enter it below within 30 minutes.");
  };

  const handleDoReset = async () => {
    setResetError("");
    if (resetPw !== resetConfirm) { setResetError("New passwords do not match."); return; }
    setResetBusy(true);
    const res = await onCompleteReset(resetId, resetCode.trim(), resetPw);
    setResetBusy(false);
    if (!res.ok) { setResetError(res.error); return; }
    setResetStep(3);
    setResetMsg("Your password has been reset. Log in with your new password.");
  };

  return (
    <Modal onClose={onClose} width={420}>
      <div className="auth-tabs">
        <button className={authTab === "login" ? "auth-tab active" : "auth-tab"} onClick={() => { setAuthTab("login"); setAuthError(""); setRegMessage(""); }}>
          <LogIn size={15} /> Log in
        </button>
        <button className={authTab === "register" ? "auth-tab active" : "auth-tab"} onClick={() => { setAuthTab("register"); setAuthError(""); setRegMessage(""); }}>
          <UserPlus size={15} /> Register
        </button>
        <button className={authTab === "reset" ? "auth-tab active" : "auth-tab"} onClick={() => goReset()}>
          <KeyRound size={15} /> Reset
        </button>
      </div>

      {authTab === "login" ? (
        <div className="auth-form">
          <Field label="Username or Gmail">
            <input className="text-input" value={login.username} onChange={(e) => setLogin((f) => ({ ...f, username: e.target.value }))} />
          </Field>
          <Field label="Password">
            <input type="password" className="text-input" value={login.password} onChange={(e) => setLogin((f) => ({ ...f, password: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && onLogin(login)} />
          </Field>
          {authError && <p className="form-error">{authError}</p>}
          {regMessage && <p className="form-success">{regMessage}</p>}
          <button className="btn-primary lg" disabled={authBusy} onClick={() => onLogin(login)}>
            {authBusy ? <><Loader2 size={16} className="spin" /> Logging in&hellip;</> : "Log in"}
          </button>
          <button className="auth-link" onClick={goReset}>Forgot your password?</button>
        </div>
      ) : authTab === "reset" ? (
        resetStep === 1 ? (
          <div className="auth-form">
            <h3 className="modal-title">Reset password</h3>
            <p className="modal-sub">Enter your username or Gmail. We'll issue a reset code.</p>
            <Field label="Username or Gmail">
              <input className="text-input" value={resetId} onChange={(e) => setResetId(e.target.value)} />
            </Field>
            {resetError && <p className="form-error">{resetError}</p>}
            <button className="btn-primary lg" disabled={resetBusy} onClick={handleSendCode}>
              {resetBusy ? <><Loader2 size={16} className="spin" /> Sending&hellip;</> : <><Send size={16} /> Send reset code</>}
            </button>
            <button className="auth-link" onClick={() => { setAuthTab("login"); setAuthError(""); setRegMessage(""); }}>Back to log in</button>
          </div>
        ) : resetStep === 2 ? (
          <div className="auth-form">
            <h3 className="modal-title">Enter reset code</h3>
            {resetMsg && <p className="form-success">{resetMsg}</p>}
            <Field label="Reset code">
              <input className="text-input mono-input" value={resetCode} onChange={(e) => setResetCode(e.target.value)} placeholder="6-digit code" />
            </Field>
            <Field label="New password">
              <input type="password" className="text-input" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" className="text-input" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDoReset()} />
            </Field>
            {resetError && <p className="form-error">{resetError}</p>}
            <button className="btn-primary lg" disabled={resetBusy} onClick={handleDoReset}>
              {resetBusy ? <><Loader2 size={16} className="spin" /> Resetting&hellip;</> : <><KeyRound size={16} /> Reset password</>}
            </button>
            <button className="auth-link" onClick={() => { setResetStep(1); setResetError(""); setResetMsg(""); }}>Request a new code</button>
          </div>
        ) : (
          <div className="auth-form">
            <h3 className="modal-title">Password reset</h3>
            {resetMsg && <p className="form-success">{resetMsg}</p>}
            <button className="btn-primary lg" onClick={() => { setAuthTab("login"); setAuthError(""); setRegMessage(""); }}>Go to log in</button>
          </div>
        )
      ) : (
          <div className="auth-form">
            <Field label="Full name">
              <input className="text-input" value={reg.fullName} onChange={(e) => setReg((f) => ({ ...f, fullName: e.target.value }))} />
            </Field>
            <Field label="Position">
              <select className="text-input" value={reg.position} onChange={(e) => setReg((f) => ({ ...f, position: e.target.value }))}>
                <option value="">Select position</option>
                {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Username">
              <input className="text-input" value={reg.username} onChange={(e) => setReg((f) => ({ ...f, username: e.target.value }))} />
            </Field>
            <Field label="Gmail address" hint="Your @gmail.com email">
              <input type="email" className="text-input" placeholder="name@gmail.com" value={reg.email} onChange={(e) => setReg((f) => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="Password" hint="At least 6 characters">
              <input type="password" className="text-input" value={reg.password} onChange={(e) => setReg((f) => ({ ...f, password: e.target.value }))} />
            </Field>
            <Field label="Confirm password">
              <input type="password" className="text-input" value={reg.confirm} onChange={(e) => setReg((f) => ({ ...f, confirm: e.target.value }))} />
            </Field>
            {authError && <p className="form-error">{authError}</p>}
            {regMessage && <p className="form-success">{regMessage}</p>}
            <button className="btn-primary lg" disabled={authBusy} onClick={() => onRegister(reg)}>
              {authBusy ? <><Loader2 size={16} className="spin" /> Submitting&hellip;</> : "Create account"}
            </button>
          </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  Feedback modal (anonymous)                                            */
/* ---------------------------------------------------------------------- */
function FeedbackModal({ onClose, onSubmit }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setError("");
    if (!message.trim()) {
      setError("Please write your feedback before sending.");
      return;
    }
    setBusy(true);
    const ok = await onSubmit(message, rating);
    setBusy(false);
    if (!ok) {
      setError("Could not send your feedback. Please try again.");
      return;
    }
    setSent(true);
  };

  return (
    <Modal onClose={onClose} width={460}>
      {sent ? (
        <>
          <h3 className="modal-title">Thank you!</h3>
          <p className="modal-sub">Your feedback has been sent to the barangay staff anonymously.</p>
          <div className="feedback-thanks"><CheckCircle2 size={44} color="var(--palm)" /></div>
          <button className="btn-primary lg" style={{ width: "100%" }} onClick={onClose}>Close</button>
        </>
      ) : (
        <>
          <h3 className="modal-title">Feedback to staff</h3>
          <p className="modal-sub">
            Your feedback is <strong>anonymous</strong> &mdash; no name is recorded. Staff will see it on their dashboard.
          </p>
          <div className="feedback-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`feedback-star${n <= (hover || rating) ? " active" : ""}`}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
              >
                <Star size={26} fill={n <= (hover || rating) ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
          <Field label="Your message">
            <textarea
              className="text-input"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Share your experience or suggestions..."
            />
          </Field>
          {error && <p className="form-error">{error}</p>}
          <button className="btn-primary lg" disabled={busy} onClick={handleSend}>
            {busy ? <><Loader2 size={16} className="spin" /> Sending&hellip;</> : <><Send size={16} /> Send feedback</>}
          </button>
        </>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  Officials dashboard                                                   */
/* ---------------------------------------------------------------------- */
function Dashboard({
  currentOfficial, handleLogout, dashTab, setDashTab, setView,
  requests, counts, chartData, statusFilter, setStatusFilter, filteredRequests, updateStatus,
  announcements, annForm, setAnnForm, annBusy, postAnnouncement, deleteAnnouncement, officials,
  pendingOfficials, approveOfficial, rejectOfficial, changePassword, updateProfilePhoto,
  forcePassword, setForcePassword,
  feedback,
}) {
  const total = requests.length;
  const inProgress = counts["Processing"] + counts["Ready for Release"];
  const avgRating = feedback.length
    ? feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / feedback.length
    : 0;
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const photoInputRef = useRef(null);
  const [photoMsg, setPhotoMsg] = useState("");
  const [photoError, setPhotoError] = useState("");

  const handleChangePassword = async () => {
    setPwError("");
    setPwMsg("");
    if (pwForm.next !== pwForm.confirm) { setPwError("New passwords do not match."); return; }
    setPwBusy(true);
    const result = await changePassword(pwForm.current, pwForm.next);
    setPwBusy(false);
    if (result.ok) {
      setPwMsg("Password updated successfully.");
      setPwForm({ current: "", next: "", confirm: "" });
      if (forcePassword) setForcePassword(false);
    } else {
      setPwError(result.error);
    }
  };

  const handlePhotoChange = async (e) => {
    setPhotoError("");
    setPhotoMsg("");
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setPhotoError("Please choose an image file."); return; }
    try {
      const dataUrl = await resizeImage(file, 160);
      const ok = await updateProfilePhoto(dataUrl);
      if (ok) setPhotoMsg("Profile picture updated.");
      else setPhotoError("Could not save your photo. Please try again.");
    } catch {
      setPhotoError("Could not read that image. Please try another.");
    }
  };

  const handleRemovePhoto = async () => {
    setPhotoError("");
    setPhotoMsg("");
    const ok = await updateProfilePhoto("");
    if (ok) setPhotoMsg("Profile picture removed.");
    else setPhotoError("Could not remove your photo. Please try again.");
  };

  return (
    <div className="dash-root">
      <aside className="dash-sidebar">
        <div className="brand" style={{ marginBottom: 28 }}>
          <Seal size={34} />
          <div className="brand-text">
            <span className="brand-name" style={{ fontSize: 15 }}>{BARANGAY_NAME}</span>
            <span className="brand-city" style={{ fontSize: 11 }}>Staff Dashboard</span>
          </div>
        </div>
        <nav className="dash-nav">
          <button className={dashTab === "overview" ? "dash-nav-item active" : "dash-nav-item"} onClick={() => setDashTab("overview")}>
            <LayoutDashboard size={16} /> Overview
          </button>
          <button className={dashTab === "requests" ? "dash-nav-item active" : "dash-nav-item"} onClick={() => setDashTab("requests")}>
            <ClipboardList size={16} /> Requests queue
          </button>
          <button className={dashTab === "announcements" ? "dash-nav-item active" : "dash-nav-item"} onClick={() => setDashTab("announcements")}>
            <Megaphone size={16} /> Announcements
          </button>
          <button className={dashTab === "feedback" ? "dash-nav-item active" : "dash-nav-item"} onClick={() => setDashTab("feedback")}>
            <MessageSquareHeart size={16} /> Feedback
            {feedback.length > 0 && <span className="dash-nav-badge">{feedback.length}</span>}
          </button>
          <button className={dashTab === "officials" ? "dash-nav-item active" : "dash-nav-item"} onClick={() => setDashTab("officials")}>
            <Users size={16} /> Officials
          </button>
          <button className={dashTab === "settings" ? "dash-nav-item active" : "dash-nav-item"} onClick={() => setDashTab("settings")}>
            <Settings size={16} /> Settings
          </button>
        </nav>
        <div className="dash-sidebar-footer">
          <button className="btn-ghost sm" onClick={() => setView("public")}>View public site</button>
          <div className="dash-user">
            <OfficialAvatar official={currentOfficial} sm />
            <div>
              <div className="dash-user-name">{currentOfficial.fullName}</div>
              <div className="dash-user-role">{currentOfficial.position}</div>
            </div>
          </div>
          <button className="btn-ghost sm" onClick={handleLogout}><LogOut size={14} /> Log out</button>
        </div>
      </aside>

      <main className="dash-main">
        <div className="dash-topbar">
          <button className="btn-primary sm" onClick={handleLogout}><LogOut size={15} /> Exit dashboard</button>
        </div>
        {dashTab === "overview" && (
        
          <>
            <h2 className="dash-title">Overview</h2>
            <div className="stat-grid">
              <StatCard label="Total requests" value={total} Icon={ClipboardList} />
              <StatCard label="Pending" value={counts["Pending"]} Icon={Clock} tone="pending" />
              <StatCard label="In progress" value={inProgress} Icon={PackageCheck} tone="processing" />
              <StatCard label="Released" value={counts["Released"]} Icon={CheckCircle2} tone="released" />
              <StatCard label="Feedback" value={feedback.length} Icon={MessageSquareHeart} tone="processing" />
              <StatCard label="Avg rating" value={feedback.length ? avgRating.toFixed(1) : "—"} Icon={Star} tone="released" />
            </div>
            <div className="dash-panel">
              <h3>Requests by type</h3>
              {chartData.length === 0 ? (
                <p className="empty-note">No requests yet this chart will fill in as residents submit requests.</p>
              ) : (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5DCC4" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#55504A" }} interval={0} angle={-20} textAnchor="end" height={95} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#55504A" }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #D9B872" }} />
                      <Bar dataKey="count" fill="#163B44" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="dash-panel">
              <h3>Recent activity</h3>
              {requests.slice(0, 5).length === 0 ? (
                <p className="empty-note">Nothing filed yet.</p>
              ) : (
                <div className="activity-list">
                  {requests.slice(0, 5).map((r) => (
                    <div key={r.id} className="activity-row">
                      <span className="mono-tag">{r.refNumber}</span>
                      <span>{r.fullName}</span>
                      <span className="activity-type">{SERVICE_TYPES.find(s => s.id === r.type)?.label || "Other"}</span>
                      <StatusBadge status={r.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {dashTab === "requests" && (
          <>
            <h2 className="dash-title">Requests queue</h2>
            <div className="filter-row">
              {["All", ...STATUSES].map((s) => (
                <button key={s} className={statusFilter === s ? "filter-chip active" : "filter-chip"} onClick={() => setStatusFilter(s)}>
                  {s} {s !== "All" && <span className="filter-count">{counts[s] || 0}</span>}
                </button>
              ))}
            </div>
            {filteredRequests.length === 0 ? (
              <p className="empty-note">No requests match this filter.</p>
            ) : (
              <div className="table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr><th>Ref #</th><th>Requester</th><th>Type</th><th>Filed</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((r) => (
                      <tr key={r.id}>
                        <td className="mono-tag">{r.refNumber}</td>
                        <td>
                          <div>{r.fullName}</div>
                          <div className="table-sub">{r.contact} Â· {r.address}</div>
                          {r.details && <div className="table-sub">"{r.details}"</div>}
                          {r.comment && <div className="table-sub">Comment: "{r.comment}"</div>}
                        </td>
                        <td>{SERVICE_TYPES.find(s => s.id === r.type)?.label || "Other"}</td>
                        <td className="table-sub">{fmtDate(r.dateSubmitted)}</td>
                        <td>
                          <select className="status-select" value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)}>
                            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {dashTab === "announcements" && (
          <>
            <h2 className="dash-title">Announcements</h2>
            <div className="dash-panel">
              <h3>Post a new announcement</h3>
              <Field label="Title">
                <input className="text-input" value={annForm.title} onChange={(e) => setAnnForm((f) => ({ ...f, title: e.target.value }))} />
              </Field>
              <Field label="Message">
                <textarea className="text-input" rows={3} value={annForm.body} onChange={(e) => setAnnForm((f) => ({ ...f, body: e.target.value }))} />
              </Field>
              <button className="btn-primary" disabled={annBusy} onClick={postAnnouncement}>
                {annBusy ? <><Loader2 size={16} className="spin" /> Postingâ€¦</> : <><Plus size={16} /> Post announcement</>}
              </button>
            </div>
            <div className="dash-panel">
              <h3>Posted announcements</h3>
              {announcements.length === 0 ? (
                <p className="empty-note">Nothing posted yet.</p>
              ) : (
                <div className="ann-list">
                  {announcements.map((a) => (
                    <div key={a.id} className="ann-row">
                      <div>
                        <div className="ann-row-title">{a.title}</div>
                        <div className="table-sub">{a.body}</div>
                        <div className="table-sub"> {a.author}, {fmtDate(a.datePosted)}</div>
                      </div>
                      <button className="icon-btn danger" onClick={() => deleteAnnouncement(a.id)} aria-label="Delete"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {dashTab === "feedback" && (
          <>
            <h2 className="dash-title">Anonymous feedback</h2>
            {feedback.length > 0 && (
              <div className="dash-panel feedback-summary">
                <span className="feedback-stars-read">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={18} fill={n <= Math.round(avgRating) ? "currentColor" : "none"} />
                  ))}
                </span>
                <strong className="feedback-avg">{avgRating.toFixed(1)} / 5</strong>
                <span className="table-sub">based on {feedback.length} {feedback.length === 1 ? "feedback" : "feedbacks"}</span>
              </div>
            )}
            {feedback.length === 0 ? (
              <p className="empty-note">No feedback yet. Residents' anonymous feedback will appear here.</p>
            ) : (
              <div className="feedback-list">
                {feedback.map((f) => (
                  <div key={f.id} className="feedback-card">
                    <div className="feedback-card-top">
                      <span className="feedback-stars-read">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} size={14} fill={n <= f.rating ? "currentColor" : "none"} />
                        ))}
                      </span>
                      <span className="table-sub">{fmtDate(f.dateSubmitted)}</span>
                    </div>
                    <p className="feedback-msg">{f.message}</p>
                    <span className="anon-chip"><EyeOff size={12} /> Anonymous</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {dashTab === "officials" && (
          <>
            <h2 className="dash-title">Officials directory</h2>
            {currentOfficial.isAdmin && (
              <div className="dash-panel">
                <h3>Pending approvals</h3>
                {pendingOfficials.length === 0 ? (
                  <p className="empty-note">No registrations waiting for approval.</p>
                ) : (
                  <div className="pending-list">
                    {pendingOfficials.map((o) => (
                      <div key={o.username} className="pending-row">
                        <div className="pending-info">
                          <div className="official-name"><OfficialAvatar official={o} sm /> {o.fullName}</div>
                          <div className="table-sub">{o.position} &middot; @{o.username}{o.email ? ` &middot; ${o.email}` : ""} &middot; applied {fmtDate(o.dateJoined)}</div>
                        </div>
                        <div className="pending-actions">
                          <button className="btn-primary sm" onClick={() => approveOfficial(o.username)}><CheckCircle2 size={14} /> Approve</button>
                          <button className="icon-btn danger" onClick={() => rejectOfficial(o.username)} aria-label="Reject"><X size={15} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="table-wrap">
              <table className="dash-table">
                <thead><tr><th>Name</th><th>Position</th><th>Username</th><th>Gmail</th><th>Joined</th></tr></thead>
                <tbody>
                  {officials.map((o) => (
                    <tr key={o.username}>
                      <td><span className="official-cell"><OfficialAvatar official={o} sm /> {o.fullName}</span> {o.username === currentOfficial.username && <span className="you-chip">You</span>}</td>
                      <td>{o.position}</td>
                      <td className="mono-tag">{o.username}</td>
                      <td className="table-sub">{o.email || "—"}</td>
                      <td className="table-sub">{fmtDate(o.dateJoined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {dashTab === "settings" && (
          <>
            <h2 className="dash-title">Settings</h2>
            <div className="dash-panel" style={{ maxWidth: 460 }}>
              <h3><KeyRound size={16} style={{ verticalAlign: -2, marginRight: 6 }} /> Change password</h3>
              <Field label="Current password">
                <input type="password" className="text-input" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} />
              </Field>
              <Field label="New password">
                <input type="password" className="text-input" value={pwForm.next} onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))} />
              </Field>
              <Field label="Confirm new password">
                <input type="password" className="text-input" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && handleChangePassword()} />
              </Field>
              {pwError && <p className="form-error">{pwError}</p>}
              {pwMsg && <p className="form-success">{pwMsg}</p>}
<button className="btn-primary" disabled={pwBusy} onClick={handleChangePassword}>
                {pwBusy ? <><Loader2 size={16} className="spin" /> Updating&hellip;</> : <><KeyRound size={16} /> Update password</>}
              </button>
            </div>
            <div className="dash-panel" style={{ maxWidth: 460 }}>
              <h3><Camera size={16} style={{ verticalAlign: -2, marginRight: 6 }} /> Profile picture</h3>
              <div className="profile-pic-row">
                <OfficialAvatar official={currentOfficial} />
                <div className="profile-pic-actions">
                  <button className="btn-ghost sm" onClick={() => photoInputRef.current && photoInputRef.current.click()}>Change photo</button>
                  {currentOfficial.photo && <button className="btn-ghost sm" onClick={handleRemovePhoto}>Remove</button>}
                </div>
              </div>
              <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={handlePhotoChange} />
              {photoError && <p className="form-error">{photoError}</p>}
              {photoMsg && <p className="form-success">{photoMsg}</p>}
            </div>
            <div className="dash-panel" style={{ maxWidth: 460 }}>
              <h3><MailIcon size={16} style={{ verticalAlign: -2, marginRight: 6 }} /> Account</h3>
              <div className="track-result-row"><span>Username</span><strong>@{currentOfficial.username}</strong></div>
              <div className="track-result-row"><span>Gmail</span><strong>{currentOfficial.email || "—"}</strong></div>
              <div className="track-result-row"><span>Position</span><strong>{currentOfficial.position}</strong></div>
            </div>
          </>
        )}
      </main>

      {forcePassword && (
        <ForcePasswordModal
          changePassword={changePassword}
          onDone={() => setForcePassword(false)}
        />
      )}
    </div>
  );
}

function ForcePasswordModal({ changePassword, onDone }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setError("");
    if (!current || !next) { setError("Please fill in every field."); return; }
    if (next !== confirm) { setError("New passwords do not match."); return; }
    setBusy(true);
    const res = await changePassword(current, next);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onDone();
  };

  return (
    <div className="force-pw-overlay">
      <div className="force-pw-card">
        <h3 className="modal-title"><KeyRound size={18} style={{ verticalAlign: -2, marginRight: 6 }} /> Change your password</h3>
        <p className="modal-sub">For security, you must set a new password before continuing.</p>
        <Field label="Current password">
          <input type="password" className="text-input" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 6 characters">
          <input type="password" className="text-input" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" className="text-input" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()} />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <button className="btn-primary lg" disabled={busy} onClick={handleSave} style={{ width: "100%" }}>
          {busy ? <><Loader2 size={16} className="spin" /> Saving&hellip;</> : <><KeyRound size={16} /> Save new password</>}
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, Icon, tone }) {
  return (
    <div className={`stat-card ${tone || ""}`}>
      <Icon size={18} />
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Styles                                                                 */
/* ---------------------------------------------------------------------- */
function FontsAndStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

      .portal-root {
        --paper:#FAF6ED; --manila:#D9B872; --manila-dark:#B89550; --ink:#241F1B; --ink-light:#5C564D;
        --seal:#A83B2D; --seal-dark:#8A2F23; --teal:#163B44; --teal-light:#1F5563; --palm:#3E6B4F;
        --box:rgba(250,246,237,0.96);
        font-family:'Public Sans', ui-sans-serif, system-ui, sans-serif;
        background:linear-gradient(rgba(22,59,68,0.45), rgba(20,26,22,0.55)), url(${JSON.stringify(cebuBgUrl)}) center/cover fixed no-repeat;
        color:var(--ink); min-height:100vh;
      }
      .portal-root * { box-sizing:border-box; }
      .portal-root h1, .portal-root h2, .portal-root h3, .portal-root h4 { font-family:'Lora', serif; margin:0; }
      .portal-root button { font-family:inherit; cursor:pointer; }
      .portal-root select, .portal-root input, .portal-root textarea { font-family:inherit; }
      .portal-root :focus-visible { outline:2px solid var(--teal); outline-offset:2px; }
      @media (prefers-reduced-motion: reduce) { .portal-root * { animation:none !important; transition:none !important; } }
      .spin { animation:spin 0.9s linear infinite; }
      @keyframes spin { to { transform:rotate(360deg); } }
      html, body { max-width:100%; overflow-x:hidden; }
      .portal-root { overflow-x:hidden; }

      /* Header */
      .site-header { position:relative; position:sticky; top:0; z-index:30; background:var(--box); border-bottom:1px solid var(--manila); }
      .header-inner { max-width:1180px; margin:0 auto; padding:12px 12px; display:flex; align-items:center; justify-content:space-between; }
      .brand { display:flex; align-items:center; gap:8px; cursor:pointer; }
      .left-header { display:flex; align-items:center; gap:12px; }
      .brand-text { display:flex; flex-direction:column; line-height:1.15; }
      .brand-name { font-family:'Lora', serif; font-weight:600; font-size:17px; color:var(--teal); }
      .brand-city { font-size:11px; color:var(--ink-light); letter-spacing:.03em; }
      .nav-desktop { display:none; align-items:center; gap:22px; }
      .nav-desktop button { background:none; border:none; font-size:14px; font-weight:500; color:var(--ink); padding:6px 0; }
      .nav-desktop button:hover { color:var(--teal); }
      .nav-track { display:flex; align-items:center; gap:6px; }
      .header-actions { margin-left:auto; display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
      .header-actions .btn-primary.sm { color:#000; background:var(--box); border:1.5px solid #000; }
      .header-actions .btn-primary.sm:hover { background:rgba(250,246,237,.9); }
      .header-feedback-btn { display:inline-flex; align-items:center; gap:6px; background:var(--box); border:1.5px solid var(--seal); color:var(--seal-dark); padding:7px 12px; border-radius:7px; font-size:12.5px; font-weight:600; }
      .header-feedback-btn:hover { background:#F7E8E4; }
      .header-feedback-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:flex-end; }
      .nav-burger { background:none; border:none; color:#000; display:flex; align-items:center; justify-content:center; width:42px; height:42px; border-radius:12px; transition:background .15s; }
      .nav-burger:hover { background:rgba(0,0,0,.08); }
      .nav-mobile { position:fixed; top:0; left:0; bottom:0; display:flex; flex-direction:column; padding:16px 10px; gap:8px; border-right:1px solid rgba(255,255,255,.2); background:rgba(22,59,68,0.92); backdrop-filter:blur(8px); box-shadow:2px 0 18px rgba(0,0,0,.08); width:min(1.75in, 80vw); z-index:40; overflow-y:auto; }
      .nav-mobile button { display:flex; align-items:center; justify-content:flex-start; background:none; border:none; padding:12px 6px; font-size:12px; color:#fff; text-align:left; border-bottom:1px dashed rgba(255,255,255,.25); width:100%; white-space:normal; line-height:1.2; flex-shrink:0; }
      .nav-mobile button:last-child { border-bottom:none; }
      .nav-mobile button:hover { background:rgba(255,255,255,.08); }
      @media (min-width:900px) { .nav-desktop { display:flex; } }

      /* Buttons */
      .btn-primary { display:inline-flex; align-items:center; gap:8px; background:var(--teal); color:#fff; border:none; padding:10px 18px; border-radius:7px; font-weight:600; font-size:14px; transition:background .15s, transform .1s; }
      .btn-primary:hover { background:var(--teal-light); }
      .btn-primary:active { transform:translateY(1px); }
      .btn-primary:disabled { opacity:.6; cursor:default; }
      .btn-primary.lg { padding:13px 22px; font-size:15px; }
      .btn-primary.sm { padding:7px 13px; font-size:13px; }
      .btn-ghost { display:inline-flex; align-items:center; gap:6px; background:transparent; color:var(--teal); border:1.5px solid var(--manila); padding:9px 16px; border-radius:7px; font-weight:600; font-size:14px; }
      .btn-ghost:hover { border-color:var(--teal); }
      .btn-ghost.lg { padding:12px 20px; font-size:15px; color:#fff; border-color:rgba(255,255,255,.45); }
      .btn-ghost.lg:hover { border-color:rgba(255,255,255,.7); }
      .btn-ghost.sm { padding:7px 12px; font-size:13px; width:100%; justify-content:center; }

      /* Hero */
      .hero { max-width:1180px; margin:0 auto; padding:56px 24px 64px; display:flex; align-items:center; gap:40px; flex-wrap:wrap-reverse; justify-content:center; background:linear-gradient(135deg, rgba(22,59,68,0.82) 0%, rgba(31,85,99,0.82) 100%); border:1px solid rgba(255,255,255,.15); border-radius:16px; backdrop-filter:blur(8px); }
      .hero-text { flex:1 1 420px; max-width:600px; }
      .eyebrow { display:inline-block; font-size:12px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; color:#FFD89B; margin-bottom:10px; }
      .hero h1 { font-size:clamp(28px,4.2vw,44px); line-height:1.15; color:#fff; font-weight:700; }
      .hero-sub-fil { font-style:italic; color:#E8F2F5; margin-top:8px; font-size:15px; }
      .hero-body { margin-top:18px; font-size:16px; color:#E8F2F5; line-height:1.6; max-width:480px; }
      .hero-ctas { display:flex; gap:12px; margin-top:26px; flex-wrap:wrap; }
      .hero-rating, .header-rating { display:flex; align-items:center; gap:7px; color:var(--ink); font-size:12px; font-weight:600; flex-wrap:wrap; }
      .hero-rating-stars, .header-rating-stars { display:inline-flex; gap:1px; color:#D9A126; }
      .hero-rating strong, .header-rating strong { font-size:12.5px; color:var(--teal); }
      .hero-seal { color:#fff; flex:0 0 auto; opacity:.9; }
      .btn-ghost.lg { color:#fff; border-color:rgba(255,255,255,.45); }
      .btn-ghost.lg:hover { border-color:rgba(255,255,255,.7); }

      .banner-warning { max-width:1180px; margin:0 auto 8px; padding:12px 24px; background:rgba(251,225,214,0.85); backdrop-filter:blur(8px); color:var(--seal-dark); font-size:13.5px; border-radius:8px; }

      /* Sections */
      .section { max-width:1180px; margin:0 auto; padding:60px 24px; }
      .section-alt { background:var(--box); backdrop-filter:blur(8px); }
      .section-heading { margin-bottom:32px; text-align:center; }
      .section-heading h2 { font-size:28px; color:var(--teal); font-weight:700; margin-top:6px; }
      #services .section-heading h2 { color:#fff; }
      #services .section-heading .eyebrow { color:#FFD89B; }
      #request-form .section-heading h2 { color:#fff; }
      #request-form .section-heading .eyebrow { color:#FFD89B; }
      #announcements .section-heading .eyebrow { color:#000; }
      #officials .section-heading .eyebrow { color:#000; }
      .empty-note { color:var(--ink-light); font-size:14px; }
      .loading-row { display:flex; align-items:center; gap:8px; color:var(--ink-light); font-size:14px; }

      /* Services */
      .services-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:18px; }
      .service-card { background:var(--box); border:1px solid #EADFC0; border-radius:12px; padding:22px; transition:transform .15s, box-shadow .15s; display:flex; flex-direction:column; }
      .service-card:hover { transform:translateY(-3px); box-shadow:0 8px 20px rgba(36,31,27,0.08); }
      .service-icon { width:38px; height:38px; border-radius:9px; background:#EAF1F1; color:var(--teal); display:flex; align-items:center; justify-content:center; margin-bottom:12px; }
      .service-card h3 { font-size:15.5px; color:var(--ink); margin-bottom:6px; }
      .service-card p { font-size:13px; color:var(--ink-light); line-height:1.5; flex:1; margin:0 0 12px; }
      .service-link { background:none; border:none; color:var(--seal); font-weight:600; font-size:13px; padding:0; display:inline-flex; align-items:center; gap:4px; align-self:flex-start; }

      /* Corkboard */
      .corkboard { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:26px; padding-top:6px; }
      .pin-note { background:var(--box); border:1px solid #EADFC0; padding:20px 18px 16px; border-radius:3px; box-shadow:0 6px 14px rgba(36,31,27,0.08); position:relative; backdrop-filter:blur(8px); }
      .pin-icon { position:absolute; top:-9px; left:50%; transform:translateX(-50%); color:var(--seal); }
      .pin-note h4 { font-size:15px; margin-bottom:8px; color:var(--teal); }
      .pin-note p { font-size:13.5px; color:var(--ink-light); line-height:1.5; margin:0 0 10px; }
      .pin-meta { font-size:11.5px; color:var(--manila-dark); }

      /* Request form */
      .request-layout { display:grid; grid-template-columns:1.3fr 1fr; gap:28px; align-items:start; }
      @media (max-width:820px) { .request-layout { grid-template-columns:1fr; } }
      .request-form-card { background:var(--box); border:1px solid #EADFC0; border-radius:14px; padding:28px; backdrop-filter:blur(8px); }
      .field-label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; color:var(--ink); margin-bottom:16px; }
      .field-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
      @media (max-width:500px) { .field-row { grid-template-columns:1fr; } }
      .field-hint { font-weight:400; font-size:12px; color:var(--ink-light); }
      .type-select { position:relative; }
      .type-select-trigger { width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; background:#FDFBF4; border:1.5px solid #E3D6AE; border-radius:7px; padding:8px 10px; font-size:13px; color:var(--ink); text-align:left; cursor:pointer; }
      .type-select-placeholder { color:var(--ink-light); }
      .type-select-chev { transition:transform .15s; color:var(--ink-light); flex-shrink:0; }
      .type-select-chev.open { transform:rotate(180deg); }
      .type-select-menu { position:absolute; top:calc(100% + 4px); left:0; right:0; background:#FDFBF4; border:1px solid #E3D6AE; border-radius:9px; box-shadow:0 12px 30px rgba(0,0,0,.16); z-index:70; padding:4px; }
      .type-option-wrap { display:flex; flex-direction:column; }
      .type-option { width:100%; background:none; border:none; text-align:left; padding:6px 9px; border-radius:7px; font-size:13px; color:var(--ink); cursor:pointer; }
      .type-option:hover { background:#EAF1F1; }
      .type-option.active { background:var(--teal); color:#fff; font-weight:600; }
      .type-comment-row { display:flex; align-items:center; gap:8px; padding:5px 8px; margin:2px 4px 4px; background:#F6F1E3; border:1px solid #E3D6AE; border-radius:8px; }
      .type-comment-row span { font-size:12px; font-weight:600; color:var(--teal); white-space:nowrap; }
      .type-comment-input { flex:1; min-width:0; font-size:13px; padding:5px 8px; background:#fff !important; }
      .text-input { width:100%; max-width:100%; min-width:0; border:1.5px solid #E3D6AE; border-radius:7px; padding:10px 12px; font-size:14px; color:var(--ink); background:var(--box); }
      .text-input:focus { border-color:var(--teal); }
      .mono-input { font-family:'JetBrains Mono', monospace; }
      .form-error { color:var(--seal-dark); font-size:13px; margin:-6px 0 14px; }
      .form-success { color:var(--palm); font-size:13px; line-height:1.5; margin:-6px 0 14px; }

      .ticket-slot { position:sticky; top:90px; }
      .ticket-list { display:flex; flex-direction:column; gap:16px; max-height:72vh; overflow-y:auto; padding-right:4px; }
      .ticket-placeholder { border:1.5px dashed #D9B872; border-radius:14px; padding:36px 24px; text-align:center; color:#FFD89B; display:flex; flex-direction:column; align-items:center; gap:12px; }
      .ticket-placeholder p { font-size:13px; max-width:240px; margin:0; color:#fff; }

      .ticket-stub { background:linear-gradient(135deg, rgba(22,59,68,0.85) 0%, rgba(31,85,99,0.85) 100%); border:1.5px solid var(--manila); border-radius:14px; padding:24px; position:relative; animation:stamp .35s ease-out; backdrop-filter:blur(8px); }
      @keyframes stamp { from { transform:scale(.92) rotate(-2deg); opacity:0; } to { transform:scale(1) rotate(0); opacity:1; } }
      .ticket-dismiss { position:absolute; top:12px; right:12px; background:none; border:none; color:#E8F2F5; }
      .ticket-stamp { position:absolute; top:18px; right:44px; border:2px solid #FF8A7A; color:#FF8A7A; font-weight:700; font-size:11px; letter-spacing:.08em; text-transform:uppercase; padding:3px 9px; border-radius:20px; transform:rotate(-8deg); }
      .ticket-eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#FFD89B; font-weight:700; }
      .ticket-ref { font-family:'JetBrains Mono', monospace; font-size:24px; font-weight:600; color:#fff; margin:4px 0 18px; }
      .ticket-perf { border-top:2px dashed #D9B872; margin-bottom:18px; }
      .ticket-body { display:flex; flex-direction:column; gap:10px; margin-bottom:16px; }
      .ticket-body > div { display:flex; justify-content:space-between; font-size:13px; gap:10px; }
      .ticket-body span { color:#E8F2F5; }
      .ticket-body strong { text-align:right; font-weight:600; color:#fff; }
      .ticket-hint { font-size:12px; color:#E8F2F5; margin:0; line-height:1.5; }

      /* Officials */
      .officials-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:16px; }
      .official-card { background:var(--box); border:1px solid #EADFC0; border-radius:12px; padding:16px; display:flex; align-items:center; gap:12px; backdrop-filter:blur(8px); }
      .official-avatar { width:42px; height:42px; border-radius:50%; background:var(--teal); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:13px; flex-shrink:0; }
      .official-avatar.photo { object-fit:cover; }
      .official-avatar.sm { width:32px; height:32px; font-size:11px; }
      .official-name { font-weight:600; font-size:14px; overflow-wrap:anywhere; }
      .official-name .official-avatar { display:inline-flex; vertical-align:middle; margin-right:6px; }
      .official-cell { display:inline-flex; align-items:center; gap:8px; }
      .profile-pic-row { display:flex; align-items:center; gap:16px; margin-bottom:4px; }
      .profile-pic-actions { display:flex; flex-direction:column; gap:8px; align-items:flex-start; }
      .official-position { font-size:12.5px; color:var(--ink-light); }
      .official-card > div:last-child { min-width:0; }
      .official-card .table-sub { word-break:break-all; overflow-wrap:anywhere; }

      /* Status badges */
      .status-badge { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; padding:4px 10px; border-radius:20px; white-space:nowrap; }
      .status-pending { background:#7A5B12; color:#fff; }
      .status-processing { background:#164A56; color:#fff; }
      .status-ready { background:#6B4A2F; color:#fff; }
      .status-released { background:#2C5C3A; color:#fff; }
      .status-rejected { background:#7A2E22; color:#fff; }

      /* Seal */
.seal { position:relative; display:flex; align-items:center; justify-content:center; border-radius:50%; overflow:hidden; color:currentColor; }
.seal img { display:block; width:100%; height:100%; object-fit:cover; }
      .seal-ring { position:absolute; inset:4%; border:2px dashed currentColor; border-radius:50%; opacity:.55; }
      .seal-ring::after { content:""; position:absolute; inset:14%; border:1.5px solid currentColor; border-radius:50%; opacity:.4; }
      .seal-star { position:absolute; top:6%; right:12%; }

      /* Footer */
      .site-footer { background:rgba(22,59,68,0.9); backdrop-filter:blur(8px); color:#EFE9D8; margin-top:20px; }
      .footer-inner { max-width:1180px; margin:0 auto; padding:40px 24px; display:flex; flex-wrap:wrap; gap:30px; justify-content:space-between; }
      .footer-note { font-size:12.5px; opacity:.75; max-width:280px; }
      .footer-contact { display:flex; flex-direction:column; gap:8px; font-size:13px; }
      .footer-contact div { display:flex; align-items:center; gap:8px; opacity:.9; }

      .chat-widget { position:fixed; bottom:24px; right:24px; z-index:55; display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
      .chat-toggle { display:inline-flex; align-items:center; justify-content:center; background:var(--teal); color:#fff; border:none; border-radius:50%; width:54px; height:54px; padding:0; box-shadow:0 18px 36px rgba(0,0,0,.18); }
      .chat-toggle:hover { background:var(--teal-light); }
      .chat-toggle-icon { width:28px; height:28px; object-fit:cover; border-radius:50%; }
      .chat-panel { width:340px; max-height:420px; background:var(--box); border:1px solid #E3D6AE; border-radius:18px; box-shadow:0 24px 60px rgba(0,0,0,.14); overflow:hidden; display:flex; flex-direction:column; backdrop-filter:blur(8px); }
      .chat-header { display:flex; align-items:center; gap:10px; padding:14px 16px; background:var(--teal); color:#fff; font-weight:700; font-size:14px; }
      .chat-messages { padding:14px 16px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; max-height:240px; }
      .chat-message { padding:10px 12px; border-radius:14px; font-size:13px; line-height:1.45; max-width:100%; }
      .chat-message.bot { background:var(--box); color:var(--ink); align-self:flex-start; }
      .chat-message.user { background:var(--teal); color:#fff; align-self:flex-end; }
      .chat-input-row { display:flex; gap:10px; padding:12px 14px 14px; background:var(--box); border-top:1px solid #EADFC0; }
      .chat-input-row .text-input { flex:1; min-width:0; border-color:#D8C29F; background:var(--box); }
      @media (max-width:900px) { .chat-widget { right:16px; bottom:16px; width:auto; } .chat-panel { width:min(100%, 340px); } }

      /* Modal */
      .modal-overlay { position:fixed; inset:0; background:rgba(36,31,27,.5); display:flex; align-items:center; justify-content:center; padding:20px; z-index:60; }
      .modal-card { background:var(--box); border-radius:16px; padding:28px; width:100%; position:relative; max-height:88vh; overflow-y:auto; backdrop-filter:blur(8px); }
      .modal-card-dark { background:linear-gradient(135deg, rgba(22,59,68,0.92) 0%, rgba(31,85,99,0.92) 100%); }
      .modal-card-dark .modal-title { color:#fff; }
      .modal-card-dark .modal-sub { color:#E8F2F5; }
      .modal-card-dark .modal-close { color:#E8F2F5; }
      .modal-card-dark .track-empty { color:#E8F2F5; }
      .modal-card-dark .track-result { border-top-color:rgba(255,255,255,.2); }
      .modal-card-dark .track-result-row span { color:#E8F2F5; }
      .modal-card-dark .track-result-row strong { color:#fff; }
      .modal-card-dark .text-input { background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.35); color:#fff; }
      .modal-card-dark .text-input::placeholder { color:rgba(255,255,255,.55); }
      .modal-close { position:absolute; top:16px; right:16px; background:none; border:none; color:var(--ink-light); }
      .modal-title { font-size:19px; color:var(--teal); margin-bottom:4px; }
      .modal-sub { font-size:13px; color:var(--ink-light); margin:0 0 18px; }
      .track-row { display:flex; gap:8px; }
      .track-row .text-input { flex:1; }
      .track-empty { font-size:13px; color:var(--ink-light); margin-top:14px; }
      .track-result { margin-top:18px; border-top:1px solid #E3D6AE; padding-top:14px; display:flex; flex-direction:column; gap:10px; }
      .track-result-row { display:flex; justify-content:space-between; font-size:13.5px; align-items:center; }
      .track-result-row span { color:var(--ink-light); }

      /* Auth */
      .auth-tabs { display:flex; gap:6px; margin-bottom:20px; background:var(--box); border-radius:9px; padding:4px; }
      .auth-tab { flex:1; display:flex; align-items:center; justify-content:center; gap:6px; background:none; border:none; padding:9px; border-radius:7px; font-size:13.5px; font-weight:600; color:var(--ink-light); }
      .auth-tab.active { background:var(--box); color:var(--teal); box-shadow:0 1px 3px rgba(0,0,0,.08); }
      .auth-form { display:flex; flex-direction:column; }
      .auth-link { align-self:center; background:none; border:none; color:var(--teal); font-size:12.5px; font-weight:600; margin-top:14px; padding:4px; }
      .auth-link:hover { text-decoration:underline; }
      .auth-demo-note { font-size:11.5px; color:var(--manila-dark); margin-top:12px; line-height:1.5; }

      .force-pw-overlay { position:fixed; inset:0; background:rgba(36,31,27,.65); display:flex; align-items:center; justify-content:center; padding:20px; z-index:80; }
      .force-pw-card { background:var(--box); border-radius:16px; padding:28px; width:100%; max-width:420px; box-shadow:0 24px 60px rgba(0,0,0,.2); }

      /* Dashboard */
      .dash-root { display:flex; min-height:100vh; }
      .dash-sidebar { width:230px; flex-shrink:0; background:rgba(22,59,68,0.9); backdrop-filter:blur(8px); color:#EFE9D8; padding:22px 16px; display:flex; flex-direction:column; position:sticky; top:0; height:100vh; }
      .dash-sidebar .brand-name { color:#fff; }
      .dash-sidebar .brand-city { color:#fff; }
      .dash-nav { display:flex; flex-direction:column; gap:3px; flex:1; }
      .dash-nav-item { display:flex; align-items:center; gap:10px; background:none; border:none; color:#D8E4E4; padding:10px 12px; border-radius:8px; font-size:13.5px; font-weight:500; text-align:left; }
      .dash-nav-item:hover { background:rgba(255,255,255,.08); }
      .dash-nav-item.active { background:var(--box); color:var(--teal); font-weight:700; }
      .dash-sidebar-footer { display:flex; flex-direction:column; gap:10px; padding-top:14px; border-top:1px solid rgba(255,255,255,.15); }
      .dash-user { display:flex; align-items:center; gap:10px; }
      .dash-user-name { font-size:12.5px; font-weight:600; }
      .dash-user-role { font-size:11px; color:#B9CBCE; }
      .dash-main { flex:1; padding:32px 36px; min-width:0; }
      .dash-topbar { display:flex; justify-content:flex-end; margin-bottom:8px; }
      .dash-title { font-size:24px; color:var(--teal); margin-bottom:20px; }

      .stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:26px; }
      .stat-card { background:var(--box); border:1px solid #EADFC0; border-radius:12px; padding:18px; color:var(--teal); backdrop-filter:blur(8px); }
      .stat-card.pending { color:#7A5B12; }
      .stat-card.processing { color:#164A56; }
      .stat-card.released { color:#2C5C3A; }
      .stat-value { font-size:28px; font-weight:700; font-family:'JetBrains Mono', monospace; margin-top:8px; color:var(--ink); }
      .stat-label { font-size:12.5px; color:var(--ink-light); margin-top:2px; }

      .dash-panel { background:var(--box); border:1px solid #EADFC0; border-radius:14px; padding:22px; margin-bottom:22px; backdrop-filter:blur(8px); }
      .dash-panel h3 { font-size:15px; color:var(--teal); margin-bottom:14px; }
      .activity-list { display:flex; flex-direction:column; gap:2px; }
      .activity-row { display:grid; grid-template-columns:130px 1fr 1fr auto; gap:10px; align-items:center; padding:10px 0; border-bottom:1px solid #F1E9D2; font-size:13px; }
      .activity-type { color:var(--ink-light); }
      .mono-tag { font-family:'JetBrains Mono', monospace; font-size:12.5px; background:var(--box); padding:2px 7px; border-radius:5px; color:var(--teal); }

      .filter-row { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px; }
      .filter-chip { background:var(--box); border:1.3px solid #EADFC0; padding:7px 13px; border-radius:20px; font-size:12.5px; font-weight:600; color:var(--ink-light); display:flex; align-items:center; gap:6px; }
      .filter-chip.active { background:var(--teal); border-color:var(--teal); color:#fff; }
      .filter-count { background:rgba(0,0,0,.12); border-radius:10px; padding:1px 6px; font-size:11px; }
      .filter-chip.active .filter-count { background:rgba(255,255,255,.25); }

      .table-wrap { overflow-x:auto; background:var(--box); border:1px solid #EADFC0; border-radius:14px; backdrop-filter:blur(8px); }
      .dash-table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:640px; }
      .dash-table th { text-align:left; padding:12px 16px; background:var(--box); color:var(--ink-light); font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; font-weight:700; }
      .dash-table td { padding:13px 16px; border-top:1px solid #F1E9D2; vertical-align:top; }
      .table-sub { font-size:12px; color:var(--ink-light); margin-top:2px; }
      .status-select { border:1.3px solid #E3D6AE; border-radius:7px; padding:6px 8px; font-size:12.5px; background:var(--box); color:#000; }
      .status-select option { color:#000; background:var(--box); }
      .you-chip { background:var(--palm); color:#fff; font-size:10px; padding:2px 7px; border-radius:10px; margin-left:8px; }

      .ann-list { display:flex; flex-direction:column; gap:2px; }
      .ann-row { display:flex; justify-content:space-between; gap:14px; padding:14px 0; border-bottom:1px solid #F1E9D2; }
      .ann-row-title { font-weight:600; font-size:14px; margin-bottom:3px; }
      .icon-btn { background:none; border:none; padding:6px; border-radius:7px; color:var(--ink-light); flex-shrink:0; }
      .icon-btn.danger:hover { background:#F5D6D2; color:var(--seal-dark); }

      .pending-list { display:flex; flex-direction:column; gap:10px; }
      .pending-row { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:12px 14px; border:1px solid #E3D6AE; border-radius:10px; background:var(--box); backdrop-filter:blur(8px); }
      .pending-info { min-width:0; }
      .pending-info .table-sub { word-break:break-all; overflow-wrap:anywhere; }
      .pending-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
      .dash-nav-badge { margin-left:auto; background:var(--seal); color:#fff; font-size:10.5px; font-weight:700; min-width:18px; height:18px; padding:0 5px; border-radius:9px; display:inline-flex; align-items:center; justify-content:center; }
      .dash-nav-item.active .dash-nav-badge { background:var(--seal); color:#fff; }

      .feedback-list { display:flex; flex-direction:column; gap:14px; }
      .feedback-summary { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
      .feedback-avg { font-size:20px; font-family:'JetBrains Mono', monospace; color:var(--teal); }
      .feedback-summary .table-sub { margin:0; }
      .feedback-card { background:var(--box); border:1px solid #EADFC0; border-radius:14px; padding:18px 20px; backdrop-filter:blur(8px); }
      .feedback-card-top { display:flex; justify-content:space-between; align-items:center; gap:12px; }
      .feedback-stars-read { display:inline-flex; gap:2px; color:#D9A126; }
      .feedback-msg { font-size:14px; line-height:1.55; margin:10px 0 12px; color:var(--ink); }
      .anon-chip { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; color:var(--ink-light); background:#F1E9D2; padding:4px 10px; border-radius:20px; }

      .feedback-stars { display:flex; gap:6px; justify-content:center; margin-bottom:20px; }
      .feedback-star { background:none; border:none; padding:2px; color:#D9B872; }
      .feedback-star.active { color:#D9A126; }
      .feedback-thanks { display:flex; justify-content:center; margin:8px 0 20px; }

      /* ---- Mobile / small-screen responsiveness (desktop unchanged) ---- */
      @media (max-width:900px) {
        .section { padding:44px 16px; }
        .hero { padding:32px 16px 40px; gap:24px; }
        .dash-main { padding:18px 14px; }
        .footer-inner { padding:32px 18px; }
      }
      @media (max-width:820px) {
        .modal-overlay { padding:0; align-items:stretch; }
        .modal-card { width:100%; max-width:100%; height:100vh; height:100dvh; max-height:100vh; max-height:100dvh; border-radius:0; padding:24px 18px; }
        .request-form-card { padding:20px 16px; }
        .ticket-list { max-height:none; }
        input, select, textarea { font-size:15px; }
      }
      @media (max-width:720px) {
        .dash-root { flex-direction:column; }
        .dash-sidebar { width:100%; height:auto; position:sticky; top:0; z-index:30; padding:10px 12px 8px; flex-direction:column; }
        .dash-sidebar .brand { margin-bottom:8px; }
        .dash-nav { flex-direction:row; flex-wrap:nowrap; gap:8px; flex:0 0 auto; overflow-x:auto; padding-bottom:2px; -webkit-overflow-scrolling:touch; }
        .dash-nav-item { flex:0 0 auto; padding:8px 12px; justify-content:center; white-space:nowrap; }
        .dash-sidebar-footer { display:none; }
        .dash-topbar { display:flex; }
        .activity-row { grid-template-columns:1fr; gap:5px; }
        .activity-row .status-badge { justify-self:flex-start; }
        .chat-widget { left:16px; right:16px; }
        .chat-panel { width:100%; max-width:none; }
        .chat-messages { max-height:34vh; }
      }
      @media (max-width:640px) {
        .services-grid, .corkboard, .officials-grid { grid-template-columns:1fr; }
      }
      @media (max-width:560px) {
        .hero h1 { font-size:clamp(23px,6.5vw,30px); }
        .hero-sub-fil { font-size:13px; }
        .hero-body { font-size:13.5px; line-height:1.5; }
        .eyebrow { font-size:10.5px; letter-spacing:.07em; }
        .hero-seal .seal { width:110px !important; height:110px !important; }
        .section-heading h2 { font-size:20px; }
        .section-heading .eyebrow { font-size:10.5px; }
        .dash-title { font-size:19px; }
        .stat-grid { grid-template-columns:repeat(2,1fr); }
        .footer-inner { flex-direction:column; gap:18px; }
        .ticket-ref { font-size:18px; }
        .service-card h3 { font-size:13.5px; }
        .service-card p { font-size:12px; }
        .service-link { font-size:12px; }
        .pin-note h4 { font-size:13.5px; }
        .pin-note p { font-size:12px; }
        .field-label { font-size:12px; }
        .field-hint { font-size:11px; }
        .btn-primary, .btn-ghost { font-size:12.5px; }
        .modal-title { font-size:16px; }
        .modal-sub { font-size:12px; }
        .status-badge { font-size:11px; }
        .chat-message { font-size:12px; }
        .chat-header { font-size:12.5px; }
        .official-name { font-size:12.5px; }
        .official-position { font-size:11.5px; }
        .ticket-body > div { font-size:12px; }
        .ticket-hint { font-size:11px; }
        .dash-nav-item { font-size:12px; }
        .stat-label { font-size:11.5px; }
        .dash-panel h3 { font-size:13.5px; }
        .dash-table { font-size:12px; }
        .activity-row { font-size:12px; }
        .filter-chip { font-size:11.5px; }
        .btn-primary.lg { width:100%; justify-content:center; }
        .track-row { flex-direction:column; align-items:stretch; }
        .track-row .btn-primary { justify-content:center; }
      }
      @media (max-width:520px) {
        .header-inner { gap:8px; padding:10px 8px; }
        .left-header { gap:6px; }
        .brand .seal { width:34px !important; height:34px !important; }
        .brand-name { font-size:14px; }
        .brand-city { font-size:10px; }
        .nav-burger { width:38px; height:38px; }
        .header-actions .btn-primary.sm { padding:6px 10px; font-size:12px; gap:5px; }
        .hero { padding:24px 12px 34px; gap:16px; }
        .hero-seal .seal { width:92px !important; height:92px !important; }
        .hero-ctas { width:100%; }
        .hero-ctas .btn-primary.lg, .hero-ctas .btn-ghost.lg { width:100%; justify-content:center; }
        .section { padding:38px 12px; }
        .section-heading { margin-bottom:24px; }
        .services-grid, .corkboard, .officials-grid { gap:14px; }
        .service-card { padding:18px; }
        .request-form-card { padding:18px 14px; }
        .chat-widget { left:12px; right:12px; bottom:12px; }
        .chat-toggle { width:48px; height:48px; }
        .chat-panel { max-height:60vh; }
        .dash-main { padding:14px 10px; }
        .dash-topbar .btn-primary.sm { width:100%; justify-content:center; }
        .stat-card { padding:14px 12px; }
        .stat-value { font-size:24px; }
        .dash-panel { padding:16px 14px; }
        .pending-row { flex-direction:column; align-items:flex-start; }
        .pending-actions { width:100%; }
        .pending-actions .btn-primary.sm { flex:1; justify-content:center; }
        .ann-row { flex-wrap:wrap; }
        .filter-chip { font-size:11.5px; padding:6px 10px; }
        .modal-card { padding:22px 16px; }
        .auth-tabs .auth-tab { font-size:12.5px; }
        .official-card { align-items:flex-start; }
      }
      @media (max-width:400px) {
        .header-inner { padding:8px 6px; }
        .left-header { gap:4px; }
        .brand { gap:5px; }
        .brand .seal { width:30px !important; height:30px !important; }
        .brand-text { min-width:0; }
        .brand-name { font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:128px; }
        .brand-city { font-size:9px; }
        .nav-burger { width:34px; height:34px; }
        .header-actions .btn-primary.sm { padding:5px 8px; font-size:11px; }
        .hero h1 { font-size:23px; }
        .section-heading h2 { font-size:20px; }
      }
      @media (min-width:561px) {
        #officials .section-heading { margin-bottom:22px; }
        #officials .section-heading h2 { font-size:24px; }
        #officials .section-heading .eyebrow { font-size:11px; }
        #officials .officials-grid { grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; }
        #officials .official-card { padding:12px 14px; gap:10px; }
        #officials .official-avatar { width:34px; height:34px; font-size:11px; }
        #officials .official-name { font-size:13px; }
        #officials .official-position { font-size:12px; }
        #officials .table-sub { font-size:11px; }
      }
    `}</style>
  );
}
