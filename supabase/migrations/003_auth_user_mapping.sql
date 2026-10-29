ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS auth_user_id uuid
REFERENCES auth.users(id)
ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_auth_user_id
ON public.profiles(auth_user_id)
WHERE auth_user_id IS NOT NULL;
