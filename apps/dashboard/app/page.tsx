"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ShieldCheck,
  Radio,
  Fingerprint,
  Smartphone,
  RefreshCw,
  Play,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  LockKeyhole,
  Activity,
  Copy,
  GraduationCap,
} from "lucide-react";

const API = "/api/backend";
const CLASS_ID = "10000000-0000-0000-0000-000000000001";
const PROFESSOR_ID = "00000000-0000-0000-0000-000000000001";
const QR_REFRESH_MS = 40_000;
const QR_LIFETIME_SECONDS = 45;

type Session = {
  id: string;
  room: string;
  status: string;
  expires_at?: string;
};

type AttendanceRecord = {
  id: string;
  student_id: string;
  status: string;
  timestamp?: string;
  created_at?: string;
  student?: { full_name?: string; student_id?: string; email?: string } | null;
};

type SecurityEvent = {
  id: string;
  event_type: string;
  reason?: string;
  created_at: string;
  student?: { full_name?: string; student_id?: string } | null;
};

type Notice = {
  kind: "success" | "error" | "info";
  message: string;
};

function getSessionId(data: any): string | undefined {
  return (
    data?.session?.id ??
    data?.session?.session_id ??
    data?.session_id ??
    data?.id
  );
}

function getToken(data: any): string | undefined {
  return (
    data?.token ??
    data?.qr_token ??
    data?.qr?.token ??
    data?.data?.token
  );
}

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: text || "Unexpected server response" };
  }

  if (!response.ok) {
    throw new Error(
      data?.detail || data?.message || `Request failed (${response.status})`
    );
  }

  return data;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(QR_LIFETIME_SECONDS);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorError, setMonitorError] = useState("");
  const [now, setNow] = useState(Date.now());
  const refreshInFlight = useRef(false);
  const tokenUpdatedAt = useRef(Date.now());
  const scanUrl =
  session && token
    ? `http://${window.location.hostname}:3000/attendance/scan?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(token)}`
    : "";

  const loadQr = useCallback(async (sessionId: string, silent = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!silent) setRefreshing(true);

    try {
      const data = await requestJson(
        `${API}/attendance/sessions/${sessionId}/qr`,
        { cache: "no-store" }
      );
      const nextToken = getToken(data);

      if (!nextToken) {
        throw new Error("The API did not return a QR token.");
      }

      setToken(nextToken);
      tokenUpdatedAt.current = Date.now();
      setSecondsLeft(QR_LIFETIME_SECONDS);
      setNotice(null);
      setServerOnline(true);
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not refresh QR.",
      });
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  const startSession = async () => {
    setStarting(true);
    setNotice(null);

    try {
      const data = await requestJson(`${API}/attendance/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: CLASS_ID,
          professor_id: PROFESSOR_ID,
          room: "LH-204",
          duration_minutes: 10,
        }),
      });

      const sessionId = getSessionId(data);
      if (!sessionId) {
        throw new Error(
          "Session was created, but its ID was missing from the API response."
        );
      }

      const nextSession: Session = {
        id: sessionId,
        room: data?.session?.room ?? data?.room ?? "LH-204",
        status: data?.session?.status ?? data?.status ?? "active",
        expires_at: data?.session?.expires_at ?? data?.expires_at,
      };

      setSession(nextSession);

      // Use the initial token if the create-session endpoint returned one.
      const initialToken = getToken(data);
      if (initialToken) {
        setToken(initialToken);
        tokenUpdatedAt.current = Date.now();
        setSecondsLeft(QR_LIFETIME_SECONDS);
        setServerOnline(true);
        setNotice({
          kind: "success",
          message: "Attendance session started successfully.",
        });
      } else {
        await loadQr(sessionId);
        setNotice({
          kind: "success",
          message: "Attendance session started successfully.",
        });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not start session.",
      });
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
  const checkHealth = async () => {
    try {
      const result = await requestJson(`${API}/health`, {
        cache: "no-store",
      });

      console.log("[AntiProxy] API health check succeeded:", result);
      setServerOnline(true);
    } catch (error) {
      console.error("[AntiProxy] API health check failed:", error);
      setServerOnline(false);
    }
  };

  void checkHealth();

  const healthInterval = window.setInterval(checkHealth, 10_000);
  return () => window.clearInterval(healthInterval);
}, []);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!session) return;

    const interval = window.setInterval(() => {
      void loadQr(session.id, true);
    }, QR_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [session, loadQr]);

  useEffect(() => {
    if (!session?.id) {
      setAttendanceRecords([]);
      setSecurityEvents([]);
      return;
    }

    let cancelled = false;

    const loadMonitoringData = async () => {
      try {
        const [recordsData, eventsData] = await Promise.all([
          requestJson(`${API}/attendance/sessions/${session.id}/records`, {
            cache: "no-store",
          }),
          requestJson(`${API}/attendance/sessions/${session.id}/events`, {
            cache: "no-store",
          }),
        ]);

        if (cancelled) return;
        setAttendanceRecords(recordsData.records ?? []);
        setSecurityEvents(eventsData.events ?? []);
        setMonitorError("");
      } catch (error) {
        if (!cancelled) {
          setMonitorError(
            error instanceof Error ? error.message : "Could not load monitoring data."
          );
        }
      } finally {
        if (!cancelled) setMonitorLoading(false);
      }
    };

    setMonitorLoading(true);
    void loadMonitoringData();
    const interval = window.setInterval(() => void loadMonitoringData(), 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [session?.id]);

  useEffect(() => {
    if (!token) return;
    const elapsed = Math.floor((now - tokenUpdatedAt.current) / 1000);
    setSecondsLeft(Math.max(0, QR_LIFETIME_SECONDS - elapsed));
  }, [now, token]);

  const copySessionId = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.id);
      setNotice({ kind: "success", message: "Session ID copied." });
    } catch {
      setNotice({ kind: "error", message: "Could not copy the session ID." });
    }
  };

  const qrProgress = (secondsLeft / QR_LIFETIME_SECONDS) * 100;

  return (
    <main className="min-h-screen bg-[#080b12] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-48 left-1/3 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-indigo-500/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-5 border-b border-white/[0.08] pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10">
              <ShieldCheck className="h-7 w-7 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Anti<span className="text-cyan-300">Proxy</span>
              </h1>
              <p className="text-xs tracking-wide text-slate-500">
                ATTENDANCE SECURITY CONSOLE
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2">
            <span
              className={`h-2 w-2 rounded-full ${
                serverOnline ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-rose-400"
              }`}
            />
            <span className="text-sm text-slate-300">
              API {serverOnline ? "Connected" : "Offline"}
            </span>
          </div>
        </header>

        <section className="py-9">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            <Activity className="h-4 w-4" />
            Live monitoring
          </div>
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Attendance Control Center
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
                Secure classroom attendance with rotating QR tokens and
                multi-layer verification.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clock3 className="h-4 w-4" />
              QR rotation: every 20 seconds
            </div>
          </div>
        </section>

        {notice && (
          <div
            className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
              notice.kind === "error"
                ? "border-rose-400/20 bg-rose-400/[0.07] text-rose-200"
                : notice.kind === "success"
                  ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200"
                  : "border-cyan-400/20 bg-cyan-400/[0.07] text-cyan-200"
            }`}
          >
            {notice.kind === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
        )}

        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-3xl border border-white/[0.09] bg-[#101520]/90 p-5 shadow-2xl shadow-black/20 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <GraduationCap className="h-4 w-4 text-cyan-300" />
                  CLASSROOM SESSION
                </div>
                <h3 className="mt-2 text-2xl font-semibold">Operating Systems</h3>
                <p className="mt-1 text-sm text-slate-500">
                  CS301 <span className="mx-2 text-slate-700">/</span> Room LH-204
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  session
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                    : "border-slate-700 bg-slate-800/70 text-slate-400"
                }`}
              >
                <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-current" />
                {session ? "SESSION ACTIVE" : "NO ACTIVE SESSION"}
              </span>
            </div>

            <div className="mt-7 grid gap-5 md:grid-cols-[1fr_220px]">
              <div className="flex min-h-[330px] flex-col justify-center rounded-2xl border border-white/[0.07] bg-[#0b0f18] p-5">
                {!session || !token ? (
                  <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                    <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl border border-cyan-400/15 bg-cyan-400/[0.06]">
                      <LockKeyhole className="h-9 w-9 text-cyan-300" />
                    </div>
                    <h4 className="text-lg font-semibold">Ready to begin?</h4>
                    <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
                      Start a session to generate a signed, rotating attendance QR.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center">
                    <div className="rounded-2xl bg-white p-4 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
                      <QRCodeSVG value={scanUrl || token} size={220} level="H" includeMargin />
                    </div>
                    <div className="mt-5 flex items-center gap-2 text-sm text-cyan-200">
                      <RefreshCw
                        className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                      />
                      Rotating signed QR token
                    </div>
                    <div className="mt-4 h-1.5 w-full max-w-[260px] overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          secondsLeft <= 5 ? "bg-rose-400" : "bg-cyan-400"
                        }`}
                        style={{ width: `${qrProgress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Refreshing in{" "}
                      <span className={secondsLeft <= 5 ? "text-rose-300" : "text-slate-300"}>
                        {secondsLeft}s
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Session duration
                  </p>
                  <p className="mt-2 text-2xl font-semibold">10 min</p>
                  <p className="mt-1 text-xs text-slate-500">Configured for demo</p>
                </div>
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Token lifetime
                  </p>
                  <p className="mt-2 text-2xl font-semibold">30 sec</p>
                  <p className="mt-1 text-xs text-slate-500">HMAC signed by API</p>
                </div>
                <button
                  onClick={startSession}
                  disabled={starting}
                  className="mt-auto flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {starting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                  {starting ? "Starting session..." : session ? "Start new session" : "Start attendance"}
                </button>
                {session && (
                  <button
                    onClick={() => void loadQr(session.id)}
                    disabled={refreshing}
                    className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05] disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    Refresh QR now
                  </button>
                )}
              </div>
            </div>

            {session && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">Session ID</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-300">
                    {session.id}
                  </p>
                </div>
                <button
                  onClick={copySessionId}
                  className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.05]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy ID
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-5">
            <div className="rounded-3xl border border-white/[0.09] bg-[#101520]/90 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-400/10">
                  <ShieldCheck className="h-5 w-5 text-indigo-300" />
                </div>
                <div>
                  <h3 className="font-semibold">Security layers</h3>
                  <p className="text-xs text-slate-500">Verification pipeline</p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {[
                  {
                    icon: RefreshCw,
                    title: "Rotating QR token",
                    desc: "Signed token with expiry validation",
                    color: "text-cyan-300 bg-cyan-300/10",
                  },
                  {
                    icon: Radio,
                    title: "BLE proximity",
                    desc: "Confirm presence near classroom device",
                    color: "text-violet-300 bg-violet-300/10",
                  },
                  {
                    icon: Fingerprint,
                    title: "Biometric verification",
                    desc: "Student identity confirmation",
                    color: "text-emerald-300 bg-emerald-300/10",
                  },
                  {
                    icon: Smartphone,
                    title: "Device binding",
                    desc: "Check enrolled student device",
                    color: "text-amber-300 bg-amber-300/10",
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{item.title}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{item.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-amber-300/15 bg-amber-300/[0.04] p-5">
              <div className="flex items-center gap-2 text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                <h3 className="text-sm font-semibold">Prototype status</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                The rotating QR is generated and validated by the backend. BLE,
                biometric, and device checks are still demo inputs—not yet
                hardware-backed verification.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-white/[0.09] bg-[#101520]/90 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Live records</p>
                <h3 className="mt-2 text-xl font-semibold">Attendance register</h3>
                <p className="mt-1 text-sm text-slate-500">Verified attendance from the current session</p>
              </div>
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-4 py-3">
                <p className="text-xs text-emerald-300">Verified</p>
                <p className="mt-1 text-2xl font-bold text-emerald-200">
                  {attendanceRecords.filter((r) => r.status === "verified").length}
                </p>
              </div>
            </div>

            {monitorError && (
              <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-sm text-rose-200">
                Live data: {monitorError}
              </p>
            )}

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="border-b border-white/[0.08] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Student</th>
                    <th className="pb-3 pr-4 font-medium">Student ID</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {attendanceRecords.map((record) => (
                    <tr key={record.id}>
                      <td className="py-3 pr-4 font-medium text-slate-200">
                        {record.student?.full_name ?? "Student"}
                      </td>
                      <td className="py-3 pr-4 text-slate-400">
                        {record.student?.student_id ?? record.student_id.slice(0, 8)}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs ${
                          record.status === "verified"
                            ? "bg-emerald-400/10 text-emerald-300"
                            : "bg-rose-400/10 text-rose-300"
                        }`}>
                          {record.status}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-slate-400">
                        {new Date(record.timestamp ?? record.created_at ?? Date.now()).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                  {attendanceRecords.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-slate-500">
                        {monitorLoading ? "Loading attendance…" : "No attendance records for this session yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-slate-600">Updates every 5 seconds</p>
          </div>

          <div className="rounded-3xl border border-white/[0.09] bg-[#101520]/90 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Threat monitoring</p>
                <h3 className="mt-2 text-xl font-semibold">Security events</h3>
                <p className="mt-1 text-sm text-slate-500">Recent verification outcomes</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-300/10">
                <AlertTriangle className="h-5 w-5 text-amber-300" />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {securityEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-200">
                      {event.event_type.replaceAll("_", " ")}
                    </p>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {new Date(event.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {event.reason || "No reason provided"}
                  </p>
                  {event.student && (
                    <p className="mt-2 text-xs text-slate-500">
                      {event.student.full_name ?? "Student"}
                      {event.student.student_id ? ` · ${event.student.student_id}` : ""}
                    </p>
                  )}
                </div>
              ))}
              {securityEvents.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
                  <ShieldCheck className="mx-auto h-7 w-7 text-slate-600" />
                  <p className="mt-3 text-sm text-slate-400">No security events recorded</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Rejected scans will appear here when the backend logs them.
                  </p>
                </div>
              )}
            </div>
            <p className="mt-4 text-xs text-slate-600">Updates every 5 seconds</p>
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] py-5 text-xs text-slate-600">
          <span>AntiProxy · Security-first classroom attendance</span>
          <span>Development environment · Do not use for production attendance yet</span>
        </footer>
      </div>
    </main>
  );
}
