import hashlib
import hmac
import json
import time
import uuid
import base64

from app.config import settings


QR_LIFETIME_SECONDS = 60


def _sign(payload: str) -> str:
    signature = hmac.new(
        settings.qr_signing_secret.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()

    return signature


def create_qr_token(session_id: str) -> dict:
    now = int(time.time())
    nonce = str(uuid.uuid4())

    payload = {
        "session_id": session_id,
        "timestamp": now,
        "nonce": nonce,
    }

    encoded_payload = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode()

    signature = _sign(encoded_payload)

    return {
        "token": f"{encoded_payload}.{signature}",
        "session_id": session_id,
        "timestamp": now,
        "nonce": nonce,
        "expires_at": now + QR_LIFETIME_SECONDS,
    }


def validate_qr_token(token: str) -> dict:
    try:
        encoded_payload, signature = token.split(".", 1)

        expected_signature = _sign(encoded_payload)

        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("Invalid QR signature")

        payload = json.loads(
            base64.urlsafe_b64decode(
                encoded_payload.encode()
            ).decode()
        )

        if int(time.time()) > payload["timestamp"] + QR_LIFETIME_SECONDS:
            raise ValueError("QR token expired")

        return payload

    except Exception as exc:
        raise ValueError(str(exc)) from exc
