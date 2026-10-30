import base64
import os
import secrets
from datetime import datetime, timedelta, timezone

from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
    PublicKeyCredentialDescriptor,
)

from app.services.supabase import supabase

RP_ID = os.getenv(
    "WEBAUTHN_RP_ID",
    "anti-proxy-attendance-system-f5i1.vercel.app",
)
RP_NAME = "AntiProxy Attendance"
ORIGIN = os.getenv(
    "WEBAUTHN_ORIGIN",
    "https://anti-proxy-attendance-system-f5i1.vercel.app",
)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _challenge(student_id: str, ceremony: str):
    challenge = secrets.token_bytes(32)
    expiry = (datetime.now(timezone.utc) + timedelta(minutes=3)).isoformat()

    result = supabase.table("webauthn_challenges").insert({
        "student_id": student_id,
        "challenge": _b64(challenge),
        "ceremony": ceremony,
        "expires_at": expiry,
    }).execute()

    return challenge, result.data[0]["id"]


def _consume_challenge(student_id: str, challenge_id: str, ceremony: str):
    result = (
        supabase.table("webauthn_challenges")
        .select("*")
        .eq("id", challenge_id)
        .eq("student_id", student_id)
        .eq("ceremony", ceremony)
        .is_("used_at", "null")
        .limit(1)
        .execute()
    )
    if not result.data:
        raise ValueError("Challenge is invalid or already used.")

    row = result.data[0]
    expires = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) >= expires:
        raise ValueError("Challenge expired.")

    return row


def registration_options(student_id: str, email: str):
    existing = (
        supabase.table("webauthn_credentials")
        .select("credential_id")
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        raise ValueError("This student already has a registered passkey.")

    challenge, challenge_id = _challenge(student_id, "registration")

    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=student_id.encode(),
        user_name=email,
        user_display_name=email,
        challenge=challenge,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )

    return {
        "options": options_to_json(options),
        "challenge_id": challenge_id,
    }


def finish_registration(student_id: str, challenge_id: str, credential: dict):
    row = _consume_challenge(student_id, challenge_id, "registration")

    verified = verify_registration_response(
        credential=credential,
        expected_challenge=_unb64(row["challenge"]),
        expected_rp_id=RP_ID,
        expected_origin=ORIGIN,
        require_user_verification=True,
    )

    supabase.table("webauthn_credentials").insert({
        "student_id": student_id,
        "credential_id": _b64(verified.credential_id),
        "public_key": _b64(verified.credential_public_key),
        "sign_count": verified.sign_count,
    }).execute()

    supabase.table("webauthn_challenges").update({
        "used_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", challenge_id).execute()

    return {"registered": True}


def authentication_options(student_id: str):
    result = (
        supabase.table("webauthn_credentials")
        .select("credential_id")
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise ValueError("Register this device before marking attendance.")

    challenge, challenge_id = _challenge(student_id, "authentication")

    options = generate_authentication_options(
        rp_id=RP_ID,
        challenge=challenge,
        allow_credentials=[
            PublicKeyCredentialDescriptor(
                id=_unb64(result.data[0]["credential_id"])
            )
        ],
        user_verification=UserVerificationRequirement.REQUIRED,
    )

    return {
        "options": options_to_json(options),
        "challenge_id": challenge_id,
    }


def finish_authentication(student_id: str, challenge_id: str, credential: dict):
    row = _consume_challenge(student_id, challenge_id, "authentication")

    stored = (
        supabase.table("webauthn_credentials")
        .select("*")
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    if not stored.data:
        raise ValueError("No registered passkey found.")

    saved = stored.data[0]

    verified = verify_authentication_response(
        credential=credential,
        expected_challenge=_unb64(row["challenge"]),
        expected_rp_id=RP_ID,
        expected_origin=ORIGIN,
        credential_public_key=_unb64(saved["public_key"]),
        credential_current_sign_count=int(saved["sign_count"]),
        require_user_verification=True,
    )

    supabase.table("webauthn_credentials").update({
        "sign_count": verified.new_sign_count,
    }).eq("student_id", student_id).execute()

    supabase.table("webauthn_challenges").update({
        "used_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", challenge_id).execute()

    return {"verified": True, "user_verified": verified.user_verified}
