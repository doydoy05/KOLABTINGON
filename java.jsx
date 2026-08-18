import React, { useState, useEffect, useCallback } from "react";
import {
  Menu, X, FileCheck2, Receipt, HeartHandshake, Home, Briefcase, BadgeCheck,
  AlertCircle, MessageSquare, Search, ShieldCheck, LogIn, UserPlus, LogOut,
  ClipboardList, Megaphone, Users, LayoutDashboard, ChevronRight,
  CheckCircle2, Clock, PackageCheck, XCircle, Plus, Trash2, Building2, Star,
  MapPin, Phone, Mail, Loader2, Pin as PinIcon,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import logoUrl from "./Images/KOLABTINGON LOGO.jpg";
import chatIconUrl from "./Images/CHATBOT.jpg";

/* ---------------------------------------------------------------------- */
/*  Content constants — edit these to rename/rebrand for a real barangay  */
/* ---------------------------------------------------------------------- */
const BARANGAY_NAME = "Barangay Kolabtingon";
const CITY_LINE = "Lungsod ng Dumanjug, Sugbo";
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

function Modal({ onClose, children, width = 480 }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: width }}>
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

  const [reqForm, setReqForm] = useState({ type: "", fullName: "", contact: "", address: "", details: "" });
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState("");
  const [ticket, setTicket] = useState(null);

  const [dashTab, setDashTab] = useState("overview");
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

  useEffect(() => {
    (async () => {
      setBooting(true);
      try {
        await Promise.all([loadRequests(), loadAnnouncements(), loadOfficials()]);
        
        // Ensure the demo admin exists in storage so it can approve registrations
        const demoOfficial = {
          username: "admin",
          password: "admin123",
          fullName: "Maria Santos",
          position: "Punong Barangay",
          isAdmin: true,
          status: "approved",
          dateJoined: Date.now() - 86400000,
        };
        try {
          const existing = await window.storage.get(`officials:${demoOfficial.username}`, true);
          if (!existing) {
            await window.storage.set(`officials:${demoOfficial.username}`, JSON.stringify(demoOfficial), true);
          }
        } catch {}
        setOfficials((prev) =>
          prev.some((o) => o.username === demoOfficial.username) ? prev : [...prev, demoOfficial]
        );
        
        // Add sample requests if none exist
        setRequests((prev) => {
          if (prev.length > 0) return prev;
          return [
            {
              id: "req_sample_1",
              refNumber: "BRGY-2026-1234",
              type: "clearance",
              fullName: "Juan Dela Cruz",
              contact: "09123456789",
              address: "Purok 1, Barangay Kolabtingon",
              details: "For job application",
              status: "Pending",
              dateSubmitted: Date.now() - 86400000,
              lastUpdated: Date.now() - 86400000,
            },
            {
              id: "req_sample_2",
              refNumber: "BRGY-2026-5678",
              type: "residency",
              fullName: "Maria Garcia",
              contact: "09234567890",
              address: "Purok 2, Barangay Kolabtingon",
              details: "For scholarship application",
              status: "Processing",
              dateSubmitted: Date.now() - 172800000,
              lastUpdated: Date.now() - 43200000,
            },
            {
              id: "req_sample_3",
              refNumber: "BRGY-2026-9012",
              type: "business",
              fullName: "Jose Lopez",
              contact: "09345678901",
              address: "Purok 3, Barangay Kolabtingon",
              details: "Sari-sari store endorsement",
              status: "Ready for Release",
              dateSubmitted: Date.now() - 259200000,
              lastUpdated: Date.now() - 86400000,
            },
          ];
        });
      } catch { setStorageError(true); }
      setBooting(false);
    })();
  }, [loadRequests, loadAnnouncements, loadOfficials]);

  /* ------------------------------- actions ------------------------------ */
  async function handleSubmitRequest() {
    setReqError("");
    if (!reqForm.type || !reqForm.fullName.trim() || !reqForm.contact.trim() || !reqForm.address.trim()) {
      setReqError("Please fill in your name, contact number, address, and the type of request.");
      return;
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
      status: "Pending",
      dateSubmitted: Date.now(),
      lastUpdated: Date.now(),
    };
    try {
      const result = await window.storage.set(`requests:${id}`, JSON.stringify(payload), true);
      if (!result) throw new Error("Storage returned no result");
      setRequests((prev) => [payload, ...prev]);
      setTicket(payload);
      setReqForm({ type: "", fullName: "", contact: "", address: "", details: "" });
    } catch {
      setReqError("Something went wrong saving your request. Please try again.");
    }
    setReqBusy(false);
  }

  async function handleTrack() {
    const ref = trackInput.trim().toUpperCase();
    if (!ref) return;
    const found = requests.find((r) => r.refNumber.toUpperCase() === ref);
    setTrackResult(found || null);
  }

  async function handleRegister(form) {
    setAuthError("");
    setRegMessage("");
    if (!form.username.trim() || !form.password || !form.fullName.trim() || !form.position) {
      setAuthError("Please complete every field.");
      return;
    }
    if (form.password !== form.confirm) {
      setAuthError("Passwords do not match.");
      return;
    }
    setAuthBusy(true);
    const username = form.username.trim().toLowerCase();
    
    // Check if username already exists (approved or pending)
    if (officials.find(o => o.username === username) || pendingOfficials.find(o => o.username === username)) {
      setAuthError("That username is already taken. Please choose another.");
      setAuthBusy(false);
      return;
    }
    const official = {
      username,
      password: form.password,
      fullName: form.fullName.trim(),
      position: form.position,
      status: "pending",
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
      setAuthError("Enter your username and password.");
      return;
    }
    setAuthBusy(true);
    const username = form.username.trim().toLowerCase();
    
    // Check demo account first
    const demoOfficial = officials.find(o => o.username === username);
    if (demoOfficial) {
      if (demoOfficial.status === "pending") {
        setAuthError("Your account is still waiting for admin approval.");
        setAuthBusy(false);
        return;
      }
      if (demoOfficial.status === "rejected") {
        setAuthError("Your account was rejected. Please contact the barangay office.");
        setAuthBusy(false);
        return;
      }
      if (demoOfficial.password !== form.password) {
        setAuthError("Incorrect password.");
        setAuthBusy(false);
        return;
      }
      setCurrentOfficial(demoOfficial);
      setAuthOpen(false);
      setView("dashboard");
      setAuthBusy(false);
      return;
    }
    
    try {
      const result = await window.storage.get(`officials:${username}`, true);
      const official = JSON.parse(result.value);
      if (official.status === "pending") {
        setAuthError("Your account is still waiting for admin approval.");
        setAuthBusy(false);
        return;
      }
      if (official.status === "rejected") {
        setAuthError("Your account was rejected. Please contact the barangay office.");
        setAuthBusy(false);
        return;
      }
      if (official.password !== form.password) {
        setAuthError("Incorrect password.");
        setAuthBusy(false);
        return;
      }
      setCurrentOfficial(official);
      setAuthOpen(false);
      setView("dashboard");
    } catch {
      setAuthError("No account found with that username.");
    }
    setAuthBusy(false);
  }

  function handleLogout() {
    setCurrentOfficial(null);
    setView("public");
    setDashTab("overview");
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
          officials={officials}
          announcements={announcements}
          reqForm={reqForm}
          setReqForm={setReqForm}
          reqBusy={reqBusy}
          reqError={reqError}
          handleSubmitRequest={handleSubmitRequest}
          ticket={ticket}
          setTicket={setTicket}
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
        />
      )}

      {trackOpen && (
        <Modal onClose={() => { setTrackOpen(false); setTrackResult(undefined); setTrackInput(""); }}>
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
  setAuthOpen, setAuthTab, setTrackOpen, officials, announcements,
  reqForm, setReqForm, reqBusy, reqError, handleSubmitRequest, ticket, setTicket,
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
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
                  onClick={() => { setReqForm((f) => ({ ...f, type: s.id })); scrollTo("request-form"); }}
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
              <Field label="Type of request">
                <select
                  className="text-input"
                  value={reqForm.type}
                  onChange={(e) => setReqForm((f) => ({ ...f, type: e.target.value }))}
                >
                  <option value="">Select a request type</option>
                  {SERVICE_TYPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
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
              <Field label="Details" hint="Purpose of the document, or describe your concern">
                <textarea className="text-input" rows={4} value={reqForm.details}
                  onChange={(e) => setReqForm((f) => ({ ...f, details: e.target.value }))}
                  placeholder="e.g. For job application at..." />
              </Field>
              {reqError && <p className="form-error">{reqError}</p>}
              <button className="btn-primary lg" disabled={reqBusy} onClick={handleSubmitRequest}>
                {reqBusy ? <><Loader2 size={16} className="spin" /> Submittingâ€¦</> : <>Submit request <ChevronRight size={16} /></>}
              </button>
            </div>

            <div className="ticket-slot">
              {ticket ? (
                <TicketStub ticket={ticket} onDismiss={() => setTicket(null)} />
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
                  <div className="official-avatar">{o.fullName.split(" ").map(p => p[0]).slice(0, 2).join("")}</div>
                  <div>
                    <div className="official-name">{o.fullName}</div>
                    <div className="official-position">{o.position}</div>
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
            <div><MapPin size={14} /> Barangay Hall, {CITY_LINE}</div>
            <div><Phone size={14} /> (032) 000-0000</div>
            <div><Mail size={14} /> office@{BARANGAY_NAME.toLowerCase().replace(/\s+/g, "")}.gov.ph</div>
          </div>
        </div>
      </footer>

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
function AuthModal({ authTab, setAuthTab, authError, setAuthError, regMessage, setRegMessage, authBusy, onClose, onLogin, onRegister }) {
  const [login, setLogin] = useState({ username: "", password: "" });
  const [reg, setReg] = useState({ username: "", password: "", confirm: "", fullName: "", position: "" });

  return (
    <Modal onClose={onClose} width={420}>
      <div className="auth-tabs">
        <button className={authTab === "login" ? "auth-tab active" : "auth-tab"} onClick={() => { setAuthTab("login"); setAuthError(""); setRegMessage(""); }}>
          <LogIn size={15} /> Log in
        </button>
        <button className={authTab === "register" ? "auth-tab active" : "auth-tab"} onClick={() => { setAuthTab("register"); setAuthError(""); setRegMessage(""); }}>
          <UserPlus size={15} /> Register
        </button>
      </div>

      {authTab === "login" ? (
        <div className="auth-form">
          <Field label="Username">
            <input className="text-input" value={login.username} onChange={(e) => setLogin((f) => ({ ...f, username: e.target.value }))} />
          </Field>
          <Field label="Password">
            <input type="password" className="text-input" value={login.password} onChange={(e) => setLogin((f) => ({ ...f, password: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && onLogin(login)} />
          </Field>
          {authError && <p className="form-error">{authError}</p>}
          <button className="btn-primary lg" disabled={authBusy} onClick={() => onLogin(login)}>
            {authBusy ? <><Loader2 size={16} className="spin" /> Logging inâ€¦</> : "Log in"}
          </button>
        </div>
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
            <Field label="Password">
              <input type="password" className="text-input" value={reg.password} onChange={(e) => setReg((f) => ({ ...f, password: e.target.value }))} />
            </Field>
            <Field label="Confirm password">
              <input type="password" className="text-input" value={reg.confirm} onChange={(e) => setReg((f) => ({ ...f, confirm: e.target.value }))} />
            </Field>
            {authError && <p className="form-error">{authError}</p>}
            {regMessage && <p className="form-success">{regMessage}</p>}
            <button className="btn-primary lg" disabled={authBusy} onClick={() => onRegister(reg)}>
              {authBusy ? <><Loader2 size={16} className="spin" /> Submittingâ€¦</> : "Create account"}
            </button>
          </div>
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
  pendingOfficials, approveOfficial, rejectOfficial,
}) {
  const total = requests.length;
  const inProgress = counts["Processing"] + counts["Ready for Release"];

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
          <button className={dashTab === "officials" ? "dash-nav-item active" : "dash-nav-item"} onClick={() => setDashTab("officials")}>
            <Users size={16} /> Officials
          </button>
        </nav>
        <div className="dash-sidebar-footer">
          <button className="btn-ghost sm" onClick={() => setView("public")}>View public site</button>
          <div className="dash-user">
            <div className="official-avatar sm">{currentOfficial.fullName.split(" ").map(p => p[0]).slice(0, 2).join("")}</div>
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
                          <div className="official-name">{o.fullName}</div>
                          <div className="table-sub">{o.position} &middot; @{o.username} &middot; applied {fmtDate(o.dateJoined)}</div>
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
                <thead><tr><th>Name</th><th>Position</th><th>Username</th><th>Joined</th></tr></thead>
                <tbody>
                  {officials.map((o) => (
                    <tr key={o.username}>
                      <td>{o.fullName} {o.username === currentOfficial.username && <span className="you-chip">You</span>}</td>
                      <td>{o.position}</td>
                      <td className="mono-tag">{o.username}</td>
                      <td className="table-sub">{fmtDate(o.dateJoined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
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
        font-family:'Public Sans', ui-sans-serif, system-ui, sans-serif;
        background:var(--paper); color:var(--ink); min-height:100vh;
      }
      .portal-root * { box-sizing:border-box; }
      .portal-root h1, .portal-root h2, .portal-root h3, .portal-root h4 { font-family:'Lora', serif; margin:0; }
      .portal-root button { font-family:inherit; cursor:pointer; }
      .portal-root select, .portal-root input, .portal-root textarea { font-family:inherit; }
      .portal-root :focus-visible { outline:2px solid var(--teal); outline-offset:2px; }
      @media (prefers-reduced-motion: reduce) { .portal-root * { animation:none !important; transition:none !important; } }
      .spin { animation:spin 0.9s linear infinite; }
      @keyframes spin { to { transform:rotate(360deg); } }

      /* Header */
      .site-header { position:relative; position:sticky; top:0; z-index:30; background:var(--paper); border-bottom:1px solid var(--manila); }
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
      .header-actions .btn-primary.sm { color:#000; background:#fff; border:1.5px solid #000; }
      .header-actions .btn-primary.sm:hover { background:#f5f5f5; }
      .nav-burger { background:none; border:none; color:#000; display:flex; align-items:center; justify-content:center; width:42px; height:42px; border-radius:12px; transition:background .15s; }
      .nav-burger:hover { background:rgba(0,0,0,.08); }
      .nav-mobile { position:fixed; top:0; left:0; bottom:0; display:flex; flex-direction:column; padding:16px 10px; gap:8px; border-right:1px solid rgba(255,255,255,.2); background:var(--teal); box-shadow:2px 0 18px rgba(0,0,0,.08); width:1.75in; z-index:40; overflow:hidden; }
      .nav-mobile button { display:flex; align-items:center; justify-content:flex-start; background:none; border:none; padding:12px 6px; font-size:12px; color:#fff; text-align:left; border-bottom:1px dashed rgba(255,255,255,.25); width:100%; white-space:normal; line-height:1.2; }
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
      .hero { max-width:1180px; margin:0 auto; padding:56px 24px 64px; display:flex; align-items:center; gap:40px; flex-wrap:wrap-reverse; justify-content:center; background:linear-gradient(135deg, var(--teal) 0%, var(--teal-light) 100%); border-radius:16px; }
      .hero-text { flex:1 1 420px; max-width:600px; }
      .eyebrow { display:inline-block; font-size:12px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; color:#FFD89B; margin-bottom:10px; }
      .hero h1 { font-size:clamp(28px,4.2vw,44px); line-height:1.15; color:#fff; font-weight:700; }
      .hero-sub-fil { font-style:italic; color:#E8F2F5; margin-top:8px; font-size:15px; }
      .hero-body { margin-top:18px; font-size:16px; color:#E8F2F5; line-height:1.6; max-width:480px; }
      .hero-ctas { display:flex; gap:12px; margin-top:26px; flex-wrap:wrap; }
      .hero-seal { color:#fff; flex:0 0 auto; opacity:.9; }

      .banner-warning { max-width:1180px; margin:0 auto 8px; padding:12px 24px; background:#FBE1D6; color:var(--seal-dark); font-size:13.5px; border-radius:8px; }

      /* Sections */
      .section { max-width:1180px; margin:0 auto; padding:60px 24px; }
      .section-alt { background:#F3ECD9; }
      .section-heading { margin-bottom:32px; text-align:center; }
      .section-heading h2 { font-size:28px; color:var(--teal); font-weight:700; margin-top:6px; }
      .empty-note { color:var(--ink-light); font-size:14px; }
      .loading-row { display:flex; align-items:center; gap:8px; color:var(--ink-light); font-size:14px; }

      /* Services */
      .services-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:18px; }
      .service-card { background:#fff; border:1px solid #EADFC0; border-radius:12px; padding:22px; transition:transform .15s, box-shadow .15s; display:flex; flex-direction:column; }
      .service-card:hover { transform:translateY(-3px); box-shadow:0 8px 20px rgba(36,31,27,0.08); }
      .service-icon { width:38px; height:38px; border-radius:9px; background:#EAF1F1; color:var(--teal); display:flex; align-items:center; justify-content:center; margin-bottom:12px; }
      .service-card h3 { font-size:15.5px; color:var(--ink); margin-bottom:6px; }
      .service-card p { font-size:13px; color:var(--ink-light); line-height:1.5; flex:1; margin:0 0 12px; }
      .service-link { background:none; border:none; color:var(--seal); font-weight:600; font-size:13px; padding:0; display:inline-flex; align-items:center; gap:4px; align-self:flex-start; }

      /* Corkboard */
      .corkboard { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:26px; padding-top:6px; }
      .pin-note { background:#FFFDF6; border:1px solid #EADFC0; padding:20px 18px 16px; border-radius:3px; box-shadow:0 6px 14px rgba(36,31,27,0.08); position:relative; }
      .pin-icon { position:absolute; top:-9px; left:50%; transform:translateX(-50%); color:var(--seal); }
      .pin-note h4 { font-size:15px; margin-bottom:8px; color:var(--teal); }
      .pin-note p { font-size:13.5px; color:var(--ink-light); line-height:1.5; margin:0 0 10px; }
      .pin-meta { font-size:11.5px; color:var(--manila-dark); }

      /* Request form */
      .request-layout { display:grid; grid-template-columns:1.3fr 1fr; gap:28px; align-items:start; }
      @media (max-width:820px) { .request-layout { grid-template-columns:1fr; } }
      .request-form-card { background:#fff; border:1px solid #EADFC0; border-radius:14px; padding:28px; }
      .field-label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; color:var(--ink); margin-bottom:16px; }
      .field-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
      @media (max-width:500px) { .field-row { grid-template-columns:1fr; } }
      .field-hint { font-weight:400; font-size:12px; color:var(--ink-light); }
      .text-input { border:1.5px solid #E3D6AE; border-radius:7px; padding:10px 12px; font-size:14px; color:var(--ink); background:#FFFEFB; }
      .text-input:focus { border-color:var(--teal); }
      .mono-input { font-family:'JetBrains Mono', monospace; }
      .form-error { color:var(--seal-dark); font-size:13px; margin:-6px 0 14px; }
      .form-success { color:var(--palm); font-size:13px; line-height:1.5; margin:-6px 0 14px; }

      .ticket-slot { position:sticky; top:90px; }
      .ticket-placeholder { border:1.5px dashed #D9B872; border-radius:14px; padding:36px 24px; text-align:center; color:var(--manila-dark); display:flex; flex-direction:column; align-items:center; gap:12px; }
      .ticket-placeholder p { font-size:13px; max-width:240px; margin:0; color:var(--ink-light); }

      .ticket-stub { background:#FFFDF6; border:1.5px solid var(--manila); border-radius:14px; padding:24px; position:relative; animation:stamp .35s ease-out; }
      @keyframes stamp { from { transform:scale(.92) rotate(-2deg); opacity:0; } to { transform:scale(1) rotate(0); opacity:1; } }
      .ticket-dismiss { position:absolute; top:12px; right:12px; background:none; border:none; color:var(--ink-light); }
      .ticket-stamp { position:absolute; top:18px; right:44px; border:2px solid var(--seal); color:var(--seal); font-weight:700; font-size:11px; letter-spacing:.08em; text-transform:uppercase; padding:3px 9px; border-radius:20px; transform:rotate(-8deg); }
      .ticket-eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--manila-dark); font-weight:700; }
      .ticket-ref { font-family:'JetBrains Mono', monospace; font-size:24px; font-weight:600; color:var(--teal); margin:4px 0 18px; }
      .ticket-perf { border-top:2px dashed #D9B872; margin-bottom:18px; }
      .ticket-body { display:flex; flex-direction:column; gap:10px; margin-bottom:16px; }
      .ticket-body > div { display:flex; justify-content:space-between; font-size:13px; gap:10px; }
      .ticket-body span { color:var(--ink-light); }
      .ticket-body strong { text-align:right; font-weight:600; }
      .ticket-hint { font-size:12px; color:var(--ink-light); margin:0; line-height:1.5; }

      /* Officials */
      .officials-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:16px; }
      .official-card { background:#fff; border:1px solid #EADFC0; border-radius:12px; padding:16px; display:flex; align-items:center; gap:12px; }
      .official-avatar { width:42px; height:42px; border-radius:50%; background:var(--teal); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:13px; flex-shrink:0; }
      .official-avatar.sm { width:32px; height:32px; font-size:11px; }
      .official-name { font-weight:600; font-size:14px; }
      .official-position { font-size:12.5px; color:var(--ink-light); }

      /* Status badges */
      .status-badge { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; padding:4px 10px; border-radius:20px; white-space:nowrap; }
      .status-pending { background:#F3E6C0; color:#000; }
      .status-processing { background:#D9EAEE; color:#000; }
      .status-ready { background:#FBE1D6; color:#000; }
      .status-released { background:#DCEBDD; color:#000; }
      .status-rejected { background:#F5D6D2; color:#000; }

      /* Seal */
.seal { position:relative; display:flex; align-items:center; justify-content:center; border-radius:50%; overflow:hidden; color:currentColor; }
.seal img { display:block; width:100%; height:100%; object-fit:cover; }
      .seal-ring { position:absolute; inset:4%; border:2px dashed currentColor; border-radius:50%; opacity:.55; }
      .seal-ring::after { content:""; position:absolute; inset:14%; border:1.5px solid currentColor; border-radius:50%; opacity:.4; }
      .seal-star { position:absolute; top:6%; right:12%; }

      /* Footer */
      .site-footer { background:var(--teal); color:#EFE9D8; margin-top:20px; }
      .footer-inner { max-width:1180px; margin:0 auto; padding:40px 24px; display:flex; flex-wrap:wrap; gap:30px; justify-content:space-between; }
      .footer-note { font-size:12.5px; opacity:.75; max-width:280px; }
      .footer-contact { display:flex; flex-direction:column; gap:8px; font-size:13px; }
      .footer-contact div { display:flex; align-items:center; gap:8px; opacity:.9; }

      .chat-widget { position:fixed; bottom:24px; right:24px; z-index:55; display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
      .chat-toggle { display:inline-flex; align-items:center; justify-content:center; background:var(--teal); color:#fff; border:none; border-radius:50%; width:54px; height:54px; padding:0; box-shadow:0 18px 36px rgba(0,0,0,.18); }
      .chat-toggle:hover { background:var(--teal-light); }
      .chat-toggle-icon { width:28px; height:28px; object-fit:cover; border-radius:50%; }
      .chat-panel { width:340px; max-height:420px; background:#fff; border:1px solid #E3D6AE; border-radius:18px; box-shadow:0 24px 60px rgba(0,0,0,.14); overflow:hidden; display:flex; flex-direction:column; }
      .chat-header { display:flex; align-items:center; gap:10px; padding:14px 16px; background:var(--teal); color:#fff; font-weight:700; font-size:14px; }
      .chat-messages { padding:14px 16px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; max-height:240px; }
      .chat-message { padding:10px 12px; border-radius:14px; font-size:13px; line-height:1.45; max-width:100%; }
      .chat-message.bot { background:#F3ECD9; color:var(--ink); align-self:flex-start; }
      .chat-message.user { background:var(--teal); color:#fff; align-self:flex-end; }
      .chat-input-row { display:flex; gap:10px; padding:12px 14px 14px; background:#F9F5EE; border-top:1px solid #EADFC0; }
      .chat-input-row .text-input { flex:1; min-width:0; border-color:#D8C29F; background:#fff; }
      @media (max-width:900px) { .chat-widget { right:16px; bottom:16px; width:auto; } .chat-panel { width:min(100%, 340px); } }

      /* Modal */
      .modal-overlay { position:fixed; inset:0; background:rgba(36,31,27,.5); display:flex; align-items:center; justify-content:center; padding:20px; z-index:60; }
      .modal-card { background:var(--paper); border-radius:16px; padding:28px; width:100%; position:relative; max-height:88vh; overflow-y:auto; }
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
      .auth-tabs { display:flex; gap:6px; margin-bottom:20px; background:#F0E9D5; border-radius:9px; padding:4px; }
      .auth-tab { flex:1; display:flex; align-items:center; justify-content:center; gap:6px; background:none; border:none; padding:9px; border-radius:7px; font-size:13.5px; font-weight:600; color:var(--ink-light); }
      .auth-tab.active { background:#fff; color:var(--teal); box-shadow:0 1px 3px rgba(0,0,0,.08); }
      .auth-form { display:flex; flex-direction:column; }
      .auth-demo-note { font-size:11.5px; color:var(--manila-dark); margin-top:12px; line-height:1.5; }

      /* Dashboard */
      .dash-root { display:flex; min-height:100vh; }
      .dash-sidebar { width:230px; flex-shrink:0; background:var(--teal); color:#EFE9D8; padding:22px 16px; display:flex; flex-direction:column; position:sticky; top:0; height:100vh; }
      .dash-sidebar .brand-city { color:#B9CBCE; }
      .dash-nav { display:flex; flex-direction:column; gap:3px; flex:1; }
      .dash-nav-item { display:flex; align-items:center; gap:10px; background:none; border:none; color:#D8E4E4; padding:10px 12px; border-radius:8px; font-size:13.5px; font-weight:500; text-align:left; }
      .dash-nav-item:hover { background:rgba(255,255,255,.08); }
      .dash-nav-item.active { background:#fff; color:var(--teal); font-weight:700; }
      .dash-sidebar-footer { display:flex; flex-direction:column; gap:10px; padding-top:14px; border-top:1px solid rgba(255,255,255,.15); }
      .dash-user { display:flex; align-items:center; gap:10px; }
      .dash-user-name { font-size:12.5px; font-weight:600; }
      .dash-user-role { font-size:11px; color:#B9CBCE; }
      .dash-main { flex:1; padding:32px 36px; min-width:0; }
      .dash-topbar { display:flex; justify-content:flex-end; margin-bottom:8px; }
      .dash-title { font-size:24px; color:var(--teal); margin-bottom:20px; }

      .stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:26px; }
      .stat-card { background:#fff; border:1px solid #EADFC0; border-radius:12px; padding:18px; color:var(--teal); }
      .stat-card.pending { color:#7A5B12; }
      .stat-card.processing { color:#164A56; }
      .stat-card.released { color:#2C5C3A; }
      .stat-value { font-size:28px; font-weight:700; font-family:'JetBrains Mono', monospace; margin-top:8px; color:var(--ink); }
      .stat-label { font-size:12.5px; color:var(--ink-light); margin-top:2px; }

      .dash-panel { background:#fff; border:1px solid #EADFC0; border-radius:14px; padding:22px; margin-bottom:22px; }
      .dash-panel h3 { font-size:15px; color:var(--teal); margin-bottom:14px; }
      .activity-list { display:flex; flex-direction:column; gap:2px; }
      .activity-row { display:grid; grid-template-columns:130px 1fr 1fr auto; gap:10px; align-items:center; padding:10px 0; border-bottom:1px solid #F1E9D2; font-size:13px; }
      .activity-type { color:var(--ink-light); }
      .mono-tag { font-family:'JetBrains Mono', monospace; font-size:12.5px; background:#F0E9D5; padding:2px 7px; border-radius:5px; color:var(--teal); }

      .filter-row { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px; }
      .filter-chip { background:#fff; border:1.3px solid #EADFC0; padding:7px 13px; border-radius:20px; font-size:12.5px; font-weight:600; color:var(--ink-light); display:flex; align-items:center; gap:6px; }
      .filter-chip.active { background:var(--teal); border-color:var(--teal); color:#fff; }
      .filter-count { background:rgba(0,0,0,.12); border-radius:10px; padding:1px 6px; font-size:11px; }
      .filter-chip.active .filter-count { background:rgba(255,255,255,.25); }

      .table-wrap { overflow-x:auto; background:#fff; border:1px solid #EADFC0; border-radius:14px; }
      .dash-table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:640px; }
      .dash-table th { text-align:left; padding:12px 16px; background:#F3ECD9; color:var(--ink-light); font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; font-weight:700; }
      .dash-table td { padding:13px 16px; border-top:1px solid #F1E9D2; vertical-align:top; }
      .table-sub { font-size:12px; color:var(--ink-light); margin-top:2px; }
      .status-select { border:1.3px solid #E3D6AE; border-radius:7px; padding:6px 8px; font-size:12.5px; background:#FFFEFB; color:#000; }
      .status-select option { color:#000; background:#fff; }
      .you-chip { background:var(--palm); color:#fff; font-size:10px; padding:2px 7px; border-radius:10px; margin-left:8px; }

      .ann-list { display:flex; flex-direction:column; gap:2px; }
      .ann-row { display:flex; justify-content:space-between; gap:14px; padding:14px 0; border-bottom:1px solid #F1E9D2; }
      .ann-row-title { font-weight:600; font-size:14px; margin-bottom:3px; }
      .icon-btn { background:none; border:none; padding:6px; border-radius:7px; color:var(--ink-light); flex-shrink:0; }
      .icon-btn.danger:hover { background:#F5D6D2; color:var(--seal-dark); }

      .pending-list { display:flex; flex-direction:column; gap:10px; }
      .pending-row { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:12px 14px; border:1px solid #E3D6AE; border-radius:10px; background:#FFFEFB; }
      .pending-info { min-width:0; }
      .pending-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
    `}</style>
  );
}
