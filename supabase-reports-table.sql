-- Run this in Supabase Dashboard → SQL Editor to create the reports table.
create table if not exists public.reports (
  business_date text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);

alter table public.reports enable row level security;

create policy "Service role full access"
  on public.reports
  for all
  to service_role
  using (true)
  with check (true);

-- Masters table (e.g. business hours by weekday)
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
