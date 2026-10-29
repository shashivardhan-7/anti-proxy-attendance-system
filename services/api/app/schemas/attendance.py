
from pydantic import BaseModel, Field


class StartSessionRequest(BaseModel):
    class_id: str
    professor_id: str
    room: str
    duration_minutes: int = Field(default=10, ge=1, le=60)


class DeviceEnrollRequest(BaseModel):
    student_id: str
    enrollment_code: str
    public_key: str


class DeviceChallengeRequest(BaseModel):
    student_id: str
    session_id: str
    qr_token: str


class AttendanceRequest(BaseModel):
    student_id: str
    session_id: str
    qr_token: str
    ble_verified: bool = False
    biometric_verified: bool = False
    device_challenge_id: str
    device_signature: str
from pydantic import BaseModel, Field


class StartSessionRequest(BaseModel):
    class_id: str
    professor_id: str
    room: str
    duration_minutes: int = Field(default=10, ge=1, le=60)


class AttendanceRequest(BaseModel):
    student_id: str
    session_id: str
    qr_token: str

    ble_verified: bool = False
    biometric_verified: bool = False
    device_verified: bool = False
