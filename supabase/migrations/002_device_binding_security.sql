
-- One-time codes used to authorize initial device enrollment.
create table if not exists device_enrollment_codes (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references profiles(id) on delete cascade,
    code_hash text not null,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now(),
    unique(student_id)
);

-- Short-lived, single-use challenges for device signature verification.
create table if not exists device_challenges (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references profiles(id) on delete cascade,
    session_id uuid not null references attendance_sessions(id) on delete cascade,
    challenge text not null,
    qr_token_hash text not null,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);

-- A registered public key must not be bound to multiple students.
create unique index if not exists
    idx_device_bindings_public_key_unique
    on device_bindings(public_key)
    where public_key is not null;

create index if not exists idx_device_challenges_student
    on device_challenges(student_id);

create index if not exists idx_device_challenges_expiry
    on device_challenges(expires_at);

alter table device_enrollment_codes enable row level security;
alter table device_challenges enable row level security;
