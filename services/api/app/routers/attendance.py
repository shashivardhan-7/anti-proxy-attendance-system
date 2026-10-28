from fastapi import APIRouter, HTTPException
from app.services.supabase import supabase

from app.schemas.attendance import (
    AttendanceRequest,
    StartSessionRequest,
)
from app.services.attendance import (
    create_session,
    verify_attendance,
)
from app.services.qr import create_qr_token

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.post("/sessions")
def start_session(request: StartSessionRequest):
    try:
        session = create_session(
            request.class_id,
            request.professor_id,
            request.room,
            request.duration_minutes,
        )

        qr = create_qr_token(session["id"])

        return {
            "session": session,
            "qr": qr,
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc


@router.get("/sessions/{session_id}/qr")
def get_qr(session_id: str):
    try:
        return create_qr_token(session_id)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc


@router.post("/verify")
def verify(request: AttendanceRequest):
    try:
        # Accept either a human-readable student ID (e.g. STU001)
        # or an internal profile UUID.
        student_id = request.student_id.strip()
        profile_result = (
            supabase.table("profiles")
            .select("id")
            .eq("student_id", student_id)
            .limit(1)
            .execute()
        )
        if profile_result.data:
            student_id = profile_result.data[0]["id"]

        return verify_attendance(
            student_id,
            request.session_id,
            request.qr_token,
            request.ble_verified,
            request.biometric_verified,
            request.device_verified,
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc

@router.get("/sessions/{session_id}/records")
def get_session_records(session_id: str):
    try:
        result = (
            supabase.table("attendance_records")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        records = result.data or []
        student_ids = list({
            row["student_id"] for row in records if row.get("student_id")
        })
        profiles = {}
        if student_ids:
            profile_result = (
                supabase.table("profiles")
                .select("id, full_name, student_id, email")
                .in_("id", student_ids)
                .execute()
            )
            profiles = {
                profile["id"]: profile for profile in (profile_result.data or [])
            }
        for row in records:
            row["student"] = profiles.get(row.get("student_id"))
        return {"session_id": session_id, "count": len(records), "records": records}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load attendance records: {exc}") from exc


@router.get("/sessions/{session_id}/events")
def get_session_events(session_id: str):
    try:
        result = (
            supabase.table("security_events")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        events = result.data or []
        student_ids = list({
            row["student_id"] for row in events if row.get("student_id")
        })
        profiles = {}
        if student_ids:
            profile_result = (
                supabase.table("profiles")
                .select("id, full_name, student_id, email")
                .in_("id", student_ids)
                .execute()
            )
            profiles = {
                profile["id"]: profile for profile in (profile_result.data or [])
            }
        for row in events:
            row["student"] = profiles.get(row.get("student_id"))
        return {"session_id": session_id, "count": len(events), "events": events}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load security events: {exc}") from exc
