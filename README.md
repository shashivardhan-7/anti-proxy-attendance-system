# AntiProxy Attendance System

University anti-proxy attendance MVP. Attendance is never written by the client. All submissions go through the backend.

Three verification layers:

1. Rotating QR
2. BLE proximity
3. Biometric + device binding

## Architecture

| Layer | Stack | Location |
| --- | --- | --- |
| Mobile (professor + student) | React Native, Expo, TypeScript | `apps/mobile` |
| Admin dashboard | Next.js, TypeScript, Tailwind CSS | `apps/dashboard` |
| API | FastAPI, Python | `services/api` |
| Database | Supabase PostgreSQL | hosted Supabase project |

The API validates sessions, QR tokens, timestamps, single-use nonces, student identity, device binding, and BLE evidence before recording attendance and security events.

## Development commands

Copy `services/api/.env.example` to `services/api/.env` and fill in local values. Never commit `.env`.

```bash
# API (from repo root)
python3 -m venv services/api/.venv
source services/api/.venv/bin/activate
pip install -r services/api/requirements.txt
cd services/api
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health check: `GET http://127.0.0.1:8000/health`

```bash
# Dashboard
cd apps/dashboard
npm install
npm run dev
```

```bash
# Mobile
cd apps/mobile
npm install
npx expo start
```

## Project layout

```
apps/mobile       Expo app (professor and student roles)
apps/dashboard    Next.js operations dashboard
services/api      FastAPI backend
```
