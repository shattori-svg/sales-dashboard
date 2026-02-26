-- Run this in Supabase Dashboard → SQL Editor to create or migrate the reports table (multi-store).

-- If you are creating from scratch, use this block:
create table if not exists public.reports (
  store_id text not null default 'default',
  business_date text not null,
  data jsonb not null,
  created_at timestamptz default now(),
  primary key (store_id, business_date)
);

alter table public.reports enable row level security;

create policy "Service role full access"
  on public.reports
  for all
  to service_role
  using (true)
  with check (true);

-- Masters table (business hours per store, stores list, etc.)
create table if not exists public.masters (
  key text primary key,
  value jsonb not null
);

alter table public.masters enable row level security;

create policy "Service role full access on masters"
  on public.masters
  for all
  to service_role
  using (true)
  with check (true);

-- Optional: migrate existing table that had (business_date) as primary key:
-- 1. Add store_id column
-- alter table public.reports add column if not exists store_id text not null default 'default';
-- 2. Drop old primary key (replace reports_pkey with your actual constraint name if different)
-- alter table public.reports drop constraint if exists reports_pkey;
-- 3. Add new primary key
-- alter table public.reports add primary key (store_id, business_date);
