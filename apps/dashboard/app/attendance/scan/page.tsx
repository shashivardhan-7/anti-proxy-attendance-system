
"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "/login";
    throw new Error("Please sign in before scanning attendance.");
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);

  return fetch(url, { ...options, headers });
}


const API = "/api/backend";
const DB_NAME = "antiproxy-device";
const STORE_NAME = "keys";
const KEY_NAME = "browser-keypair";

type KeyPair = CryptoKeyPair;

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadKeyPair(): Promise<KeyPair | null> {
  const db = await openKeyDB();

  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(KEY_NAME);

    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function saveKeyPair(pair: KeyPair): Promise<void> {
  const db = await openKeyDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(pair, KEY_NAME);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };

    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function getOrCreateKeyPair(): Promise<KeyPair> {
  const existing = await loadKeyPair();
  if (existing) return existing;

  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );

  await saveKeyPair(pair);
  return pair;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function ScanForm() {
  const params = useSearchParams();
  const sessionId = params.get("session") ?? "";
  const qrToken = params.get("token") ?? "";

  const [studentId, setStudentId] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [ble, setBle] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  async function registerDevice() {
    if (!studentId.trim() || !enrollmentCode.trim()) {
      setResult({
        ok: false,
        message: "Enter your student ID and one-time enrollment code.",
      });
      return;
    }

    setBusy(true);
    setResult(null);

    try {
      if (!window.isSecureContext || !crypto.subtle) {
        throw new Error(
          "Secure browser cryptography is unavailable. Open the dashboard through localhost or HTTPS.",
        );
      }

      const pair = await getOrCreateKeyPair();
      const publicKey = await crypto.subtle.exportKey("spki", pair.publicKey);

      const response = await authenticatedFetch(`${API}/attendance/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId.trim(),
          enrollment_code: enrollmentCode.trim(),
          public_key: toBase64(publicKey),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Device registration failed.");
      }

      setEnrollmentCode("");
      setResult({
        ok: true,
        message:
          "This browser is now registered. Keep this browser profile for future attendance.",
      });
    } catch (error) {
      setResult({
        ok: false,
        message:
          error instanceof Error ? error.message : "Device registration failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);

    try {
      if (!window.isSecureContext || !crypto.subtle) {
        throw new Error(
          "Secure browser cryptography is unavailable. Open the dashboard through localhost or HTTPS.",
        );
      }

      const pair = await loadKeyPair();

      if (!pair) {
        throw new Error("Register this browser before marking attendance.");
      }

      const challengeResponse = await authenticatedFetch(
        `${API}/attendance/devices/challenge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            student_id: studentId.trim(),
            session_id: sessionId,
            qr_token: qrToken,
          }),
        },
      );

      const challengeData = await challengeResponse.json();

      if (!challengeResponse.ok) {
        throw new Error(
          challengeData.detail || "Could not obtain device challenge.",
        );
      }

      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        new TextEncoder().encode(challengeData.challenge),
      );

      const response = await authenticatedFetch(`${API}/attendance/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId.trim(),
          session_id: sessionId,
          qr_token: qrToken,
          ble_verified: ble,
          biometric_verified: biometric,
          device_challenge_id: challengeData.challenge_id,
          device_signature: toBase64(signature),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `Request failed (${response.status})`);
      }

      setResult({
        ok: data.verified === true,
        message: data.verified
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
          Register this browser once, then use it to mark attendance.
        </p>

        <div className="mt-6">
          <label
            htmlFor="studentId"
            className="mb-2 block text-sm text-slate-200"
          >
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

        <div className="mt-4 rounded-xl border border-cyan-400/20 p-4">
          <h2 className="font-semibold">Register this browser</h2>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            Use the one-time code issued to you. Registration is normally
            needed only once per browser profile.
          </p>

          <label
            htmlFor="enrollmentCode"
            className="mb-2 mt-4 block text-sm text-slate-200"
          >
            One-time enrollment code
          </label>
          <input
            id="enrollmentCode"
            type="password"
            autoComplete="off"
            value={enrollmentCode}
            onChange={(event) => setEnrollmentCode(event.target.value)}
            placeholder="Enter your code"
            className="w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-400"
          />

          <button
            type="button"
            onClick={registerDevice}
            disabled={busy}
            className="mt-3 w-full rounded-xl border border-cyan-400 px-4 py-3 font-semibold text-cyan-200 transition hover:bg-cyan-400/10 disabled:opacity-50"
          >
            {busy ? "Please wait…" : "Register browser"}
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-5">
          <fieldset className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
            <legend className="px-1 text-sm font-semibold text-amber-200">
              Demo checks only
            </legend>
            <p className="text-xs leading-5 text-slate-300">
              These switches simulate Bluetooth and biometric checks. They do
              not perform real proximity or biometric verification.
            </p>

            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={ble}
                onChange={(event) => setBle(event.target.checked)}
              />
              Simulate BLE proximity passed
            </label>

            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={biometric}
                onChange={(event) => setBiometric(event.target.checked)}
              />
              Simulate biometric check passed
            </label>
          </fieldset>

          <button
            type="submit"
            disabled={busy || !studentId.trim()}
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
      fallback={
        <main className="min-h-screen bg-slate-950 p-8 text-white">
          Loading scan page…
        </main>
      }
    >
      <ScanForm />
    </Suspense>
  );
}
