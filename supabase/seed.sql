-- AntiProxy MVP demo seed data

insert into public.profiles (
  id,
  full_name,
  email,
  role
)
values
(
  '00000000-0000-0000-0000-000000000001',
  'Demo Professor',
  'professor@antiproxy.demo',
  'professor'
),
(
  '00000000-0000-0000-0000-000000000002',
  'Rahul Kumar',
  'rahul@antiproxy.demo',
  'student'
),
(
  '00000000-0000-0000-0000-000000000003',
  'Priya Sharma',
  'priya@antiproxy.demo',
  'student'
);

update public.profiles
set student_id = 'STU001'
where id = '00000000-0000-0000-0000-000000000002';

update public.profiles
set student_id = 'STU002'
where id = '00000000-0000-0000-0000-000000000003';

insert into public.classes (
  id,
  name,
  code,
  professor_id,
  room
)
values (
  '10000000-0000-0000-0000-000000000001',
  'Operating Systems',
  'CS301',
  '00000000-0000-0000-0000-000000000001',
  'LH-204'
);

insert into public.enrollments (
  class_id,
  student_id
)
values
(
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
),
(
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003'
);
