from datetime import datetime, timedelta, timezone

from app.services.qr import validate_qr_token
from app.services.supabase import supabase


def create_session(
    class_id: str,
    professor_id: str,
    room: str,
    duration_minutes: int,
):
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=duration_minutes)

    result = (
        supabase.table("attendance_sessions")
        .insert(
            {
                "class_id": class_id,
                "professor_id": professor_id,
                "room": room,
                "started_at": now.isoformat(),
                "expires_at": expires_at.isoformat(),
                "status": "active",
            }
        )
        .execute()
    )

    return result.data[0]


def verify_attendance(
    student_id: str,
    session_id: str,
    qr_token: str,
    ble_verified: bool,
    biometric_verified: bool,
    device_verified: bool,
):
    # -----------------------------------------------------
    # 1. Validate QR cryptographically
    # -----------------------------------------------------

    try:
        qr_payload = validate_qr_token(qr_token)
    except ValueError as exc:
        _log_event(
            session_id,
            student_id,
            "qr_rejected",
            str(exc),
        )
        return {
            "verified": False,
            "reason": str(exc),
        }

    if qr_payload["session_id"] != session_id:
        _log_event(
            session_id,
            student_id,
            "qr_rejected",
            "QR belongs to another session",
        )
        return {
            "verified": False,
            "reason": "QR belongs to another session",
        }

    # -----------------------------------------------------
    # 2. Check session
    # -----------------------------------------------------

    session_result = (
        supabase.table("attendance_sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )

    if not session_result.data:
        return {
            "verified": False,
            "reason": "Session not found",
        }

    session = session_result.data[0]

    if not session:
        return {
            "verified": False,
            "reason": "Session not found",
        }

    if session["status"] != "active":
        _log_event(
            session_id,
            student_id,
            "attendance_rejected",
            "Session is closed",
        )
        return {
            "verified": False,
            "reason": "Session is closed",
        }

    # -----------------------------------------------------
    # 3. Check enrollment
    # -----------------------------------------------------

    enrollment_result = (
        supabase.table("enrollments")
        .select("id")
        .eq("class_id", session["class_id"])
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )

    if not enrollment_result.data:
        _log_event(
            session_id,
            student_id,
            "attendance_rejected",
            "Student is not enrolled in this class",
        )
        return {
            "verified": False,
            "reason": "Student is not enrolled in this class",
        }

    # -----------------------------------------------------
    # 4. Duplicate attendance
    # -----------------------------------------------------

    existing_result = (
        supabase.table("attendance_records")
        .select("id")
        .eq("session_id", session_id)
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )

    if existing_result.data:
        _log_event(
            session_id,
            student_id,
            "duplicate_attendance",
            "Attendance already recorded",
        )
        return {
            "verified": False,
            "reason": "Attendance already recorded",
        }

    # -----------------------------------------------------
    # 5. Security checks
    # -----------------------------------------------------

    if not ble_verified:
        _log_event(
            session_id,
            student_id,
            "ble_rejected",
            "Professor BLE signal not detected",
        )
        return {
            "verified": False,
            "reason": "Professor BLE signal not detected",
        }

    if not biometric_verified:
        _log_event(
            session_id,
            student_id,
            "biometric_rejected",
            "Biometric verification failed",
        )
        return {
            "verified": False,
            "reason": "Biometric verification failed",
        }

    if not device_verified:
        _log_event(
            session_id,
            student_id,
            "device_rejected",
            "Unregistered device",
        )
        return {
            "verified": False,
            "reason": "Unregistered device",
        }

    # -----------------------------------------------------
    # 6. Record successful attendance
    # -----------------------------------------------------

    result = (
        supabase.table("attendance_records")
        .insert(
            {
                "session_id": session_id,
                "student_id": student_id,
                "qr_verified": True,
                "ble_verified": True,
                "biometric_verified": True,
                "device_verified": True,
                "status": "verified",
            }
        )
        .execute()
    )

    # Record QR redemption for replay tracking.
    supabase.table("qr_token_redemptions").insert(
        {
            "session_id": session_id,
            "student_id": student_id,
            "nonce_hash": qr_payload["nonce"],
        }
    ).execute()

    _log_event(
        session_id,
        student_id,
        "attendance_verified",
        "All security checks passed",
    )

    return {
        "verified": True,
        "reason": "Attendance verified",
        "attendance": result.data[0],
    }


def _log_event(
    session_id: str,
    student_id: str,
    event_type: str,
    reason: str,
):
    supabase.table("security_events").insert(
        {
            "session_id": session_id,
            "student_id": student_id,
            "event_type": event_type,
            "reason": reason,
        }
    ).execute()
