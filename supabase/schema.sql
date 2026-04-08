create extension if not exists pgcrypto;

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type text not null check (type in ('task', 'focus', 'buffer')),
  priority text not null check (priority in ('low', 'medium', 'high')),
  duration integer not null check (duration > 0),
  deadline date,
  scheduled_date date not null,
  start_minutes integer not null check (start_minutes >= 0 and start_minutes < 1440),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.schedule_items enable row level security;

create policy "public read schedule items"
  on public.schedule_items
  for select
  using (true);

create policy "public insert schedule items"
  on public.schedule_items
  for insert
  with check (true);

create policy "public update schedule items"
  on public.schedule_items
  for update
  using (true);
