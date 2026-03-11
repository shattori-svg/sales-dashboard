-- Create users table for app authentication (run this in Supabase SQL Editor)
-- This is separate from Supabase Auth; used for app login and role (user/admin).

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now(),
  preferred_store TEXT,
  preferred_department TEXT,
  preferred_currency TEXT,
  preferred_language TEXT
);

-- Optional: add index for login lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users (username);

-- If you already have the users table without preferred_store/preferred_department, run:
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name TEXT;
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_store TEXT;
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_department TEXT;
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_currency TEXT;
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_language TEXT;

-- Grant usage to service role (required when using service_role key from app)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Policy: service role bypasses RLS by default, so no extra policy needed for app access.
-- If you use anon key elsewhere, add policies as needed.
