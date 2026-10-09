from app.services.supabase import supabase

professor = {
    "id": "00000000-0000-0000-0000-000000000001",
    "full_name": "Demo Professor",
    "email": "professor@antiproxy.demo",
    "role": "professor",
}

rahul = {
    "id": "00000000-0000-0000-0000-000000000002",
    "full_name": "Rahul Kumar",
    "email": "rahul@antiproxy.demo",
    "role": "student",
    "student_id": "STU001",
}

priya = {
    "id": "00000000-0000-0000-0000-000000000003",
    "full_name": "Priya Sharma",
    "email": "priya@antiproxy.demo",
    "role": "student",
    "student_id": "STU002",
}

print("Seeding profiles...")
supabase.table("profiles").upsert(
    [professor, rahul, priya],
    on_conflict="id",
).execute()

demo_class = {
    "id": "10000000-0000-0000-0000-000000000001",
    "name": "Operating Systems",
    "code": "CS301",
    "professor_id": professor["id"],
    "room": "LH-204",
}

print("Seeding class...")
supabase.table("classes").upsert(
    demo_class,
    on_conflict="id",
).execute()

enrollments = [
    {
        "class_id": demo_class["id"],
        "student_id": rahul["id"],
    },
    {
        "class_id": demo_class["id"],
        "student_id": priya["id"],
    },
]

print("Seeding enrollments...")
supabase.table("enrollments").upsert(
    enrollments,
    on_conflict="class_id,student_id",
).execute()

print("Seed complete.")

print("\nProfiles:")
print(
    supabase.table("profiles")
    .select("id,full_name,email,role,student_id")
    .execute()
    .data
)

print("\nClasses:")
print(
    supabase.table("classes")
    .select("*")
    .execute()
    .data
)

print("\nEnrollments:")
print(
    supabase.table("enrollments")
    .select("*")
    .execute()
    .data
)
