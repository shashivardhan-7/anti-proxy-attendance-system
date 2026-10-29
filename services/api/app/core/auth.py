
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.services.supabase import supabase

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_profile(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """Validate the Supabase access token and return its linked profile."""

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        # Validate the token with Supabase Auth; do not trust decoded claims alone.
        response = supabase.auth.get_user(credentials.credentials)
        user = response.user
    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    if not user or not user.email:
        raise HTTPException(status_code=401, detail="Invalid authenticated user")

    email = user.email.strip().lower()
    if not email.endswith("@iiitdwd.ac.in"):
        raise HTTPException(status_code=403, detail="College email required")

    try:
        result = (
            supabase.table("profiles")
            .select("id, full_name, email, role, student_id, auth_user_id")
            .eq("auth_user_id", str(user.id))
            .maybe_single()
            .execute()
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not resolve authenticated profile",
        ) from None

    profile = result.data
    if not profile:
        raise HTTPException(
            status_code=403,
            detail="No AntiProxy profile is linked to this account",
        )

    if (
        not profile.get("email")
        or profile["email"].strip().lower() != email
        or profile.get("role") not in {"admin", "professor", "student"}
    ):
        raise HTTPException(status_code=403, detail="Invalid AntiProxy profile")

    return {
        "auth_user_id": str(user.id),
        "email": email,
        "profile": profile,
        "role": profile["role"],
    }


def require_roles(*allowed_roles: str):
    """Create a dependency that allows only the specified profile roles."""

    def role_checker(
        identity: dict[str, Any] = Depends(get_current_profile),
    ) -> dict[str, Any]:
        if identity["role"] not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to perform this action",
            )
        return identity

    return role_checker
