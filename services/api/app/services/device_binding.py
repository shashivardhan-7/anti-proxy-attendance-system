
import base64
import hashlib
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils

from app.services.supabase import supabase


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def resolve_student_id(value: str) -> str:
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

    # Also allow the internal profile UUID.
    result = (
        supabase.table("profiles")
        .select("id")
        .eq("id", value)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise ValueError("Student not found")

    return result.data[0]["id"]


def register_device(student_id: str, public_key_b64: str):
    student_id = resolve_student_id(student_id)

    from datetime import datetime, timezone

    try:
        public_key_bytes = base64.b64decode(public_key_b64, validate=True)
        public_key = serialization.load_der_public_key(public_key_bytes)
    except Exception as exc:
        raise ValueError("Invalid public key") from exc

    if not isinstance(public_key, ec.EllipticCurvePublicKey):
        raise ValueError("Unsupported public key type")

    if not isinstance(public_key.curve, ec.SECP256R1):
        raise ValueError("Public key must use the P-256 curve")

    normalized_key = base64.b64encode(
        public_key.public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    ).decode("ascii")

    device_id = _sha256(normalized_key)

    existing_key = (
        supabase.table("device_bindings")
        .select("student_id")
        .eq("device_id", device_id)
        .limit(1)
        .execute()
    )
    if existing_key.data and existing_key.data[0]["student_id"] != student_id:
        raise ValueError("This device is already registered to another student")

    existing_binding = (
        supabase.table("device_bindings")
        .select("*")
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )

    if existing_binding.data:
        binding = existing_binding.data[0]

        if binding["status"] == "active":
            raise ValueError(
                "A device is already registered for this student. "
                "Ask the administrator to revoke it before changing devices."
            )

        (
            supabase.table("device_bindings")
            .update({
                "device_id": device_id,
                "public_key": normalized_key,
                "status": "active",
                "registered_at": datetime.now(timezone.utc).isoformat(),
                "last_seen_at": None,
            })
            .eq("id", binding["id"])
            .execute()
        )
    else:
        (
            supabase.table("device_bindings")
            .insert({
                "student_id": student_id,
                "device_id": device_id,
                "public_key": normalized_key,
                "status": "active",
            })
            .execute()
        )


    return {"registered": True, "message": "Device registered successfully"}


def create_device_challenge(
    student_id: str,
    session_id: str,
    qr_token: str,
):
    from datetime import datetime, timedelta, timezone
    import secrets

    student_id = resolve_student_id(student_id)

    binding_result = (
        supabase.table("device_bindings")
        .select("id")
        .eq("student_id", student_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )

    if not binding_result.data:
        raise ValueError("No registered device. Register this browser first.")

    from app.services.qr import validate_qr_token

    payload = validate_qr_token(qr_token)
    if payload.get("session_id") != session_id:
        raise ValueError("QR belongs to another session")

    session_result = (
        supabase.table("attendance_sessions")
        .select("id, status, expires_at")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )

    if not session_result.data:
        raise ValueError("Session not found")

    session = session_result.data[0]
    if session["status"] != "active":
        raise ValueError("Session is closed")

    expires_at = datetime.fromisoformat(
        session["expires_at"].replace("Z", "+00:00")
    )
    if datetime.now(timezone.utc) >= expires_at:
        raise ValueError("Attendance session has expired")

    challenge = secrets.token_urlsafe(32)
    challenge_expiry = datetime.now(timezone.utc) + timedelta(seconds=45)

    row = (
        supabase.table("device_challenges")
        .insert({
            "student_id": student_id,
            "session_id": session_id,
            "challenge": challenge,
            "qr_token_hash": _sha256(qr_token),
            "expires_at": challenge_expiry.isoformat(),
        })
        .execute()
    )

    return {
        "challenge_id": row.data[0]["id"],
        "challenge": challenge,
        "expires_at": challenge_expiry.isoformat(),
    }


def verify_device_signature(
    student_id: str,
    session_id: str,
    qr_token: str,
    challenge_id: str,
    signature_b64: str,
) -> bool:
    from datetime import datetime, timezone

    student_id = resolve_student_id(student_id)

    challenge_result = (
        supabase.table("device_challenges")
        .select("*")
        .eq("id", challenge_id)
        .eq("student_id", student_id)
        .eq("session_id", session_id)
        .is_("used_at", "null")
        .limit(1)
        .execute()
    )

    if not challenge_result.data:
        raise ValueError("Challenge is invalid or has already been used")

    challenge_row = challenge_result.data[0]

    expires_at = datetime.fromisoformat(
        challenge_row["expires_at"].replace("Z", "+00:00")
    )
    if datetime.now(timezone.utc) >= expires_at:
        raise ValueError("Device challenge expired")

    if challenge_row["qr_token_hash"] != _sha256(qr_token):
        raise ValueError("Challenge does not match this QR token")

    binding_result = (
        supabase.table("device_bindings")
        .select("*")
        .eq("student_id", student_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )

    if not binding_result.data:
        raise ValueError("No registered device")

    binding = binding_result.data[0]

    try:
        public_key_bytes = base64.b64decode(binding["public_key"], validate=True)
        public_key = serialization.load_der_public_key(public_key_bytes)
        signature = base64.b64decode(signature_b64, validate=True)

        # Web Crypto returns raw 64-byte r||s for P-256.
        if len(signature) != 64:
            raise ValueError("Invalid signature format")

        r = int.from_bytes(signature[:32], "big")
        s = int.from_bytes(signature[32:], "big")
        der_signature = utils.encode_dss_signature(r, s)

        public_key.verify(
            der_signature,
            challenge_row["challenge"].encode("utf-8"),
            ec.ECDSA(hashes.SHA256()),
        )
    except InvalidSignature as exc:
        raise ValueError("Device signature is invalid") from exc
    except Exception as exc:
        raise ValueError("Could not verify device signature") from exc

    (
        supabase.table("device_challenges")
        .update({"used_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", challenge_id)
        .is_("used_at", "null")
        .execute()
    )

    (
        supabase.table("device_bindings")
        .update({"last_seen_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", binding["id"])
        .execute()
    )

    return True
