from fastapi import APIRouter, HTTPException

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
        return verify_attendance(
            request.student_id,
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