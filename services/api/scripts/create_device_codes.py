
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from app.services.supabase import supabase


STUDENT_IDS = ["STU001", "STU002"]


def main():
    expiry = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

    for student_code in STUDENT_IDS:
        result = (
            supabase.table("profiles")
            .select("id, full_name, student_id")
            .eq("student_id", student_code)
            .limit(1)
            .execute()
        )

        if not result.data:
            print(f"ERROR: No profile found for {student_code}")
            continue

        student = result.data[0]
        one_time_code = secrets.token_urlsafe(24)
        code_hash = hashlib.sha256(one_time_code.encode("utf-8")).hexdigest()

        (
            supabase.table("device_enrollment_codes")
            .upsert(
                {
                    "student_id": student["id"],
                    "code_hash": code_hash,
                    "expires_at": expiry,
                    "used_at": None,
                },
                on_conflict="student_id",
            )
            .execute()
        )

        print(f"Student: {student['full_name']} ({student_code})")
        print(f"ONE-TIME ENROLLMENT CODE: {one_time_code}")
        print()

    print("Codes expire in 24 hours. Share each code only with its student.")


if __name__ == "__main__":
    main()
