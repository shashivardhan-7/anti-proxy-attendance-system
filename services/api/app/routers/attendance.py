from fastapi import APIRouter, HTTPException, Depends
from app.services.supabase import supabase
from app.schemas.attendance import (
    AttendanceRequest,
    StartSessionRequest,
    DeviceEnrollRequest,
    DeviceChallengeRequest,
)
from app.services.attendance import create_session, verify_attendance
from app.services.qr import create_qr_token
from app.services.device_binding import (
    register_device,
    create_device_challenge,
    verify_device_signature,
)
from app.core.auth import require_roles

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _resolve_student_id(value: str) -> str:
    value = value.strip()
    result = (
        supabase.table("profiles")
        .select("id")
        .eq("student_id", value)
        .limit(1)
        .execute()
    )
    if result.data:
        return result.data[0]["id"]

    result = (
        supabase.table("profiles")
        .select("id")
        .eq("id", value)
        .limit(1)
        .execute()
    )
    if result.data:
        return result.data[0]["id"]

    raise ValueError("Student not found")


@router.post("/devices/register")
def enroll_device(
    request: DeviceEnrollRequest,
    identity: dict = Depends(require_roles("admin", "student")),
):
    try:
        return register_device(
            request.student_id,
            request.public_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Device registration failed") from exc


@router.post("/devices/challenge")
def issue_device_challenge(
    request: DeviceChallengeRequest,
    identity: dict = Depends(require_roles("student")),
):
    try:
        return create_device_challenge(
            request.student_id,
            request.session_id,
            request.qr_token,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not create device challenge") from exc


@router.post("/sessions")
def start_session(
    request: StartSessionRequest,
    identity: dict = Depends(require_roles("admin", "professor")),
):
    try:
        session = create_session(
            request.class_id,
            request.professor_id,
            request.room,
            request.duration_minutes,
        )
        qr = create_qr_token(session["id"])
        return {"session": session, "qr": qr}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/qr")
def get_qr(
    session_id: str,
    identity: dict = Depends(require_roles("admin", "professor")),
):
    try:
        return create_qr_token(session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/verify")
def verify(
    request: AttendanceRequest,
    identity: dict = Depends(require_roles("student")),
):
    try:
        profile = identity["profile"]
        supplied_id = request.student_id.strip()

        if supplied_id not in {
            str(profile.get("id", "")),
            str(profile.get("student_id", "")),
        }:
            raise HTTPException(
                status_code=403,
                detail="You can only submit attendance for your own account",
            )

        student_id = str(profile["id"])

        # This is the server-side device check. The browser cannot set it
        # directly; a valid signature from the registered public key is required.
        verify_device_signature(
            student_id=student_id,
            session_id=request.session_id,
            qr_token=request.qr_token,
            challenge_id=request.device_challenge_id,
            signature_b64=request.device_signature,
        )

        return verify_attendance(
            student_id,
            request.session_id,
            request.qr_token,
            request.ble_verified,
            request.biometric_verified,
            True,
        )
    except ValueError as exc:
        return {
            "verified": False,
            "reason": str(exc),
        }
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception(
            "Attendance verification crashed"
        )
        raise HTTPException(
            status_code=500,
            detail=f"DEBUG: {type(exc).__name__}: {exc}",
        ) from exc

@router.get("/sessions/{session_id}/records")
def get_session_records(
    session_id: str,
    identity: dict = Depends(require_roles("admin", "professor")),
):
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
def get_session_events(
    session_id: str,
    identity: dict = Depends(require_roles("admin", "professor")),
):
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


# WebAuthn demo endpoints
from app.services import webauthn_demo


@router.post("/devices/webauthn/register/options")
def webauthn_register_options(identity: dict = Depends(require_roles("student"))):
    profile = identity["profile"]
    try:
        return webauthn_demo.registration_options(
            str(profile["id"]), identity["email"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("WebAuthn registration options failed")
        raise HTTPException(status_code=500, detail="Could not start device registration") from exc


@router.post("/devices/webauthn/register/verify")
def webauthn_register_verify(
    payload: dict,
    identity: dict = Depends(require_roles("student")),
):
    profile = identity["profile"]
    try:
        return webauthn_demo.finish_registration(
            str(profile["id"]), payload["challenge_id"], payload["credential"]
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("WebAuthn registration verification failed")
        raise HTTPException(status_code=500, detail="Device registration verification failed") from exc


@router.post("/devices/webauthn/authenticate/options")
def webauthn_authenticate_options(
    identity: dict = Depends(require_roles("student")),
):
    try:
        return webauthn_demo.authentication_options(
            str(identity["profile"]["id"])
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("WebAuthn authentication options failed")
        raise HTTPException(status_code=500, detail="Could not start device verification") from exc


@router.post("/devices/webauthn/authenticate/verify")
def webauthn_authenticate_verify(
    payload: dict,
    identity: dict = Depends(require_roles("student")),
):
    try:
        return webauthn_demo.finish_authentication(
            str(identity["profile"]["id"]),
            payload["challenge_id"],
            payload["credential"],
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("WebAuthn authentication verification failed")
        raise HTTPException(status_code=500, detail="Device authentication failed") from exc
