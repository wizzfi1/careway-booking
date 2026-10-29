"use client";
import { useEffect, useState, useRef } from "react";
import {
  ArrowRight,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  KeyRound,
  Leaf,
  MapPin,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
type Slot = {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
};
type Booking = {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
};
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
export default function Home() {
  const [apiKey, setApiKey] = useState(""),
    [draftKey, setDraftKey] = useState(""),
    [keyOpen, setKeyOpen] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]),
    [selected, setSelected] = useState<Slot | null>(null),
    [provider, setProvider] = useState("all"),
    [day, setDay] = useState("");
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState<Booking | null>(null),
    [tab, setTab] = useState("book"),
    [bookings, setBookings] = useState<Booking[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [searched, setSearched] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const pending = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    const saved = sessionStorage.getItem("careway-key");
    if (saved) {
      setApiKey(saved);
      setDraftKey(saved);
    }
  }, []);
  async function api<T>(path: string, options: RequestInit = {}, key = apiKey): Promise<T> {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
        ...options.headers,
      },
    });
    const data: unknown = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(
          response.status === 429
            ? `Please wait ${response.headers.get("Retry-After") || "60"} seconds before trying again.`
            : (data as {error?: string}).error || "Something went wrong. Please try again.",
        ),
        { status: response.status },
      );
    return data as T;
  }
  async function loadSlots() {
    setLoading(true);
    try {
      const data = await api<{slots: Slot[]}>("/slots");
      setSlots(data.slots);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (apiKey) void loadSlots();
  }, [apiKey]);
  const providers = Array.from(new Set(slots.map((s) => s.provider)));
  const eligible = slots.filter(
    (s) => provider === "all" || s.provider === provider,
  );
  const dates = Array.from(new Set(eligible.map((s) => dateLabel(s.start))));
  const activeDay = dates.includes(day) ? day : dates[0];
  const visible = eligible.filter((s) => dateLabel(s.start) === activeDay);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const data = await api<{slots: Slot[]}>("/slots", {}, draftKey.trim());
      sessionStorage.setItem("careway-key", draftKey.trim());
      setApiKey(draftKey.trim());
      setSlots(data.slots);
      setKeyOpen(false);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setNotice("");
    const body = JSON.stringify({ slot_id: selected.id, name, email });
    if (pending.current?.body !== body)
      pending.current = { body, key: crypto.randomUUID() };
    try {
      const result = await api<Booking>("/bookings", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": pending.current!.key },
      });
      setConfirmation(result);
      pending.current = null;
      await loadSlots();
    } catch (e) {
      if (
        (e as { status?: number }).status &&
        (e as { status: number }).status < 500
      )
        pending.current = null;
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function searchBookings(next = false) {
    setBusy(true);
    setNotice("");
    try {
      const data = await api<{bookings: Booking[]; next_cursor: string | null}>(
        `/bookings?email=${encodeURIComponent(email)}&limit=5${next && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      setBookings(next ? [...bookings, ...data.bookings] : data.bookings);
      setCursor(data.next_cursor);
      setSearched(true);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!cancelTarget) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<Booking>(
        `/bookings/${encodeURIComponent(cancelTarget.id)}`,
        { method: "DELETE" },
      );
      setBookings(bookings.map((b) => (b.id === result.id ? result : b)));
      if (confirmation?.id === result.id) setConfirmation(result);
      setCancelTarget(null);
      await loadSlots();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function switchTab(value: string) {
    setTab(value);
    setNotice("");
    setConfirmation(null);
  }
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Careway home">
          <span className="brand-mark">
            <Plus size={25} />
          </span>
          careway<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={tab === "book" ? "nav-link active" : "nav-link"}
            onClick={() => switchTab("book")}
          >
            Book a visit
          </button>
          <button
            className={tab === "manage" ? "nav-link active" : "nav-link"}
            onClick={() => switchTab("manage")}
          >
            My appointments
          </button>
        </nav>
        <button
          className="connection"
          onClick={() => {
            setKeyOpen(!keyOpen);
            setNotice("");
          }}
        >
          <span className={apiKey ? "status-dot connected" : "status-dot"} />
          <span>{apiKey ? "Connected" : "Connect API"}</span>
          <KeyRound size={14} />
        </button>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">
              <span /> A LITTLE TIME FOR YOURSELF
            </p>
            <h1>
              {tab === "book" ? "Good care starts" : "Your care, all"}
              <br />
              <span>
                {tab === "book" ? "with a simple step." : "in one place."}
              </span>
            </h1>
            <p className="intro-copy">
              {tab === "book"
                ? "Find a time that fits your day. We’ll take care of the rest."
                : "Look up your upcoming visits and manage your appointments."}
            </p>
          </div>
          <div className="intro-note">
            <span className="leaf-icon">
              <Leaf size={31} />
            </span>
            <p>
              Less waiting.
              <br />
              More living.
            </p>
            <span>Care that fits around you.</span>
          </div>
        </section>
        {notice && (
          <div className="alert" role="alert">
            <span>{notice}</span>
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {(keyOpen || !apiKey) && (
          <section className="connect-panel">
            <div>
              <KeyRound size={20} />
              <div>
                <h2>Connect to your clinic</h2>
                <p>Enter the supplied API key to view and book appointments.</p>
              </div>
            </div>
            <form onSubmit={connect}>
              <label className="sr-only" htmlFor="api-key">
                API key
              </label>
              <input
                id="api-key"
                type="password"
                placeholder="Enter API key"
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                required
                autoComplete="off"
              />
              <button className="primary" disabled={busy}>
                {busy ? "Connecting..." : "Connect"}
                <ArrowRight size={17} />
              </button>
            </form>
          </section>
        )}
        {tab === "book" && !confirmation && (
          <div className="booking-layout">
            <section className="schedule panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">01 / FIND YOUR TIME</p>
                  <h2>Choose an appointment</h2>
                </div>
                <CalendarDays size={24} />
              </div>
              <div className="filter-row">
                <label htmlFor="provider">Your care provider</label>
                <select
                  id="provider"
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setSelected(null);
                  }}
                >
                  <option value="all">All providers</option>
                  {providers.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="date-strip" aria-label="Appointment dates">
                {dates.map((d) => (
                  <button
                    key={d}
                    className={d === activeDay ? "date selected" : "date"}
                    onClick={() => {
                      setDay(d);
                      setSelected(null);
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="slot-heading">
                <h3>{activeDay || "Available appointments"}</h3>
                <span>
                  <Clock3 size={13} /> Lagos time (WAT)
                </span>
              </div>
              <div className="slot-grid">
                {visible.map((s) => {
                  const unavailable =
                    !s.available || Date.parse(s.start) <= Date.now();
                  return (
                    <button
                      key={s.id}
                      disabled={unavailable}
                      aria-pressed={selected?.id === s.id}
                      className={`slot ${selected?.id === s.id ? "chosen" : ""}`}
                      onClick={() => {
                        setSelected(s);
                        pending.current = null;
                        setNotice("");
                      }}
                    >
                      <span className="slot-time">
                        {timeLabel(s.start)}
                        {selected?.id === s.id && <Check size={16} />}
                      </span>
                      <span>{s.provider}</span>
                      <small>
                        {unavailable
                          ? "Unavailable"
                          : `${Math.round((Date.parse(s.end) - Date.parse(s.start)) / 60000)} min visit`}
                      </small>
                    </button>
                  );
                })}
              </div>
              {(loading || !visible.length) && (
                <div className="empty">
                  <CalendarDays size={30} />
                  <h3>
                    {loading
                      ? "Loading appointments"
                      : !apiKey
                        ? "Your next visit starts here"
                        : "No appointments available"}
                  </h3>
                  <p>
                    {loading
                      ? "Checking the latest availability."
                      : !apiKey
                        ? "Connect with your API key to see available times."
                        : "Try another provider, or check back for new times."}
                  </p>
                  {apiKey && !loading && (
                    <button className="secondary" onClick={loadSlots}>
                      Refresh availability
                    </button>
                  )}
                </div>
              )}
              <div className="schedule-footer">
                <span className="tiny-circle" /> Availability updates after
                every booking.
              </div>
            </section>
            <aside>
              <section className="details panel">
                <p className="eyebrow">02 / MAKE IT YOURS</p>
                <h2>Your visit details</h2>
                <div className="selection-summary">
                  <span className="summary-icon">
                    <CalendarDays size={22} />
                  </span>
                  <div>
                    <strong>
                      {selected ? selected.provider : "A time just for you"}
                    </strong>
                    <p>
                      {selected
                        ? `${dateLabel(selected.start)} at ${timeLabel(selected.start)}`
                        : "Select an appointment to continue"}
                    </p>
                  </div>
                </div>
                <form onSubmit={book}>
                  <label htmlFor="name">Full name</label>
                  <input
                    id="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ada Obi"
                    required
                  />
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <p className="field-note">
                    Use this email to find your appointments later.
                  </p>
                  <button
                    className="primary book-button"
                    disabled={!selected || !apiKey || busy}
                  >
                    {busy ? "Booking your visit..." : "Confirm appointment"}
                    <ArrowRight size={18} />
                  </button>
                </form>
                <p className="privacy">
                  <ShieldCheck size={15} /> Your details are used for this
                  appointment.
                </p>
              </section>
              <div className="help-note">
                <span>GOOD TO KNOW</span>
                <p>
                  Plans change. You can cancel a confirmed appointment from My
                  appointments.
                </p>
              </div>
            </aside>
          </div>
        )}
        {confirmation && (
          <section className="confirmation panel">
            <span className="success-icon">
              <CheckCircle2 size={35} />
            </span>
            <p className="eyebrow">
              {confirmation.status === "confirmed"
                ? "YOU’RE ALL SET"
                : "APPOINTMENT UPDATED"}
            </p>
            <h2>
              {confirmation.status === "confirmed"
                ? "A little time, just for you."
                : "Your visit is cancelled."}
            </h2>
            <p>
              {confirmation.status === "confirmed"
                ? `Your appointment is confirmed, ${confirmation.name.split(" ")[0]}.`
                : "The time is now available for someone else."}
            </p>
            <div className="confirm-details">
              <div>
                <span>Care provider</span>
                <strong>{selected?.provider}</strong>
              </div>
              <div>
                <span>Date & time (WAT)</span>
                <strong>
                  {selected &&
                    `${dateLabel(selected.start)}, ${timeLabel(selected.start)}`}
                </strong>
              </div>
              <div>
                <span>Booking reference</span>
                <code>{confirmation.id}</code>
              </div>
              <div>
                <span>Email</span>
                <strong>{confirmation.email}</strong>
              </div>
            </div>
            <div className="button-row">
              <button
                className="primary"
                onClick={() => {
                  setConfirmation(null);
                  setSelected(null);
                }}
              >
                Book another visit
                <ArrowRight size={17} />
              </button>
              {confirmation.status === "confirmed" && (
                <button
                  className="secondary"
                  onClick={() => setCancelTarget(confirmation)}
                >
                  Cancel appointment
                </button>
              )}
            </div>
          </section>
        )}
        {tab === "manage" && !confirmation && (
          <section className="manage panel">
            <p className="eyebrow">YOUR APPOINTMENTS</p>
            <h2>Let’s find your visits</h2>
            <form
              className="lookup"
              onSubmit={(e) => {
                e.preventDefault();
                void searchBookings();
              }}
            >
              <label className="sr-only" htmlFor="lookup-email">
                Booking email address
              </label>
              <input
                id="lookup-email"
                type="email"
                placeholder="Email used for your booking"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setSearched(false);
                  setBookings([]);
                  setCursor(null);
                }}
              />
              <button className="primary" disabled={!apiKey || busy}>
                Find appointments
                <ArrowRight size={17} />
              </button>
            </form>
            {bookings.map((b) => {
              const s = slots.find((s) => s.id === b.slot_id);
              return (
                <article className="booking-row" key={b.id}>
                  <span className="summary-icon">
                    <CalendarDays size={22} />
                  </span>
                  <div>
                    <h3>{s?.provider || "Clinic appointment"}</h3>
                    <p>
                      {s
                        ? `${dateLabel(s.start)}, ${timeLabel(s.start)} WAT`
                        : b.slot_id}
                    </p>
                    <small>{b.id}</small>
                  </div>
                  <span className={`badge ${b.status}`}>{b.status}</span>
                  {b.status === "confirmed" && (
                    <button
                      className="text-button"
                      onClick={() => setCancelTarget(b)}
                    >
                      Cancel
                    </button>
                  )}
                </article>
              );
            })}
            {searched && !bookings.length && (
              <div className="empty">
                <CalendarDays size={30} />
                <h3>No appointments found</h3>
                <p>Check your email address or book your first visit.</p>
              </div>
            )}
            {cursor && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => searchBookings(true)}
              >
                Load more appointments
              </button>
            )}
          </section>
        )}
        <div className="bottom-note">
          <ShieldCheck size={17} />
          <span>Simple booking. Clear confirmation. More peace of mind.</span>
        </div>
      </main>
      <footer>
        <a className="brand small" href="/">
          careway.
        </a>
        <span>Made for a healthier everyday.</span>
        <span>Assessment demo · Please use sample details</span>
      </footer>
      {cancelTarget && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-title"
            className="modal panel"
          >
            <h2 id="cancel-title">Cancel this appointment?</h2>
            <p>
              Your time will become available for someone else. You can book a
              new visit whenever you’re ready.
            </p>
            <div className="button-row">
              <button
                className="secondary"
                onClick={() => setCancelTarget(null)}
                disabled={busy}
              >
                Keep appointment
              </button>
              <button className="primary" onClick={cancel} disabled={busy}>
                {busy ? "Cancelling..." : "Yes, cancel"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
