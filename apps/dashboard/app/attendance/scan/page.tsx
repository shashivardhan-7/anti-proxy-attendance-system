"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const API = "/api/backend";

function ScanForm() {
  const params = useSearchParams();
  const sessionId = params.get("session") ?? "";
  const qrToken = params.get("token") ?? "";

  const [studentId, setStudentId] = useState("");
  const [ble, setBle] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [device, setDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);

    try {
      const response = await fetch(`${API}/attendance/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId.trim(),
          session_id: sessionId,
          qr_token: qrToken,
          ble_verified: ble,
          biometric_verified: biometric,
          device_verified: device,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `Request failed (${response.status})`);
      }

      const verified = data.verified === true;
      setResult({
        ok: verified,
        message: verified
          ? "Attendance verified successfully."
          : data.reason || "Attendance was not verified.",
      });
    } catch (error) {
      setResult({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not connect to the attendance server.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!sessionId || !qrToken) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto mt-20 max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6">
          <h1 className="text-xl font-bold">Invalid attendance QR</h1>
          <p className="mt-2 text-slate-300">
            Scan the current QR displayed on the professor dashboard.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
          AntiProxy
        </p>
        <h1 className="mt-3 text-2xl font-bold">Mark attendance</h1>
        <p className="mt-2 text-sm text-slate-300">
          Enter your registered student ID and submit the current QR token.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-5">
          <div>
            <label htmlFor="studentId" className="mb-2 block text-sm text-slate-200">
              Student ID
            </label>
            <input
              id="studentId"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="e.g. STU001"
              required
              className="w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-400"
            />
          </div>

          <fieldset className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
            <legend className="px-1 text-sm font-semibold text-amber-200">
              Demo checks only
            </legend>
            <p className="text-xs leading-5 text-slate-300">
              These switches simulate checks for this prototype. They do not
              perform real Bluetooth, biometric, or device verification.
            </p>

            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={ble} onChange={(e) => setBle(e.target.checked)} />
              Simulate BLE proximity passed
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={biometric} onChange={(e) => setBiometric(e.target.checked)} />
              Simulate biometric check passed
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={device} onChange={(e) => setDevice(e.target.checked)} />
              Simulate registered device passed
            </label>
          </fieldset>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-cyan-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify attendance"}
          </button>
        </form>

        {result && (
          <div
            role="status"
            className={`mt-5 rounded-xl border p-4 ${
              result.ok
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-rose-400/30 bg-rose-400/10 text-rose-200"
            }`}
          >
            <p className="font-semibold">
              {result.ok ? "Success" : "Not verified"}
            </p>
            <p className="mt-1 break-words text-sm">{result.message}</p>
          </div>
        )}

        <p className="mt-6 break-all text-xs text-slate-500">
          Session: {sessionId}
        </p>
      </div>
    </main>
  );
}

export default function AttendanceScanPage() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-slate-950 p-8 text-white">Loading scan page…</main>}
    >
      <ScanForm />
    </Suspense>
  );
}
