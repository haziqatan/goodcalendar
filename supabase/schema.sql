create extension if not exists pgcrypto;

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type text not null check (type in ('task', 'focus', 'buffer')),
  priority text not null check (priority in ('low', 'medium', 'high', 'critical')),
  duration integer not null check (duration > 0),
  min_duration integer check (min_duration is null or min_duration > 0),
  max_duration integer check (max_duration is null or max_duration > 0),
  hour_preset text,
  hours_start integer check (hours_start is null or (hours_start >= 0 and hours_start < 1440)),
  hours_end integer check (hours_end is null or (hours_end > 0 and hours_end <= 1440)),
  hours_ranges jsonb,
  earliest_start_at timestamp without time zone,
  schedule_after date,
  due_at timestamp without time zone,
  deadline date,
  scheduled_date date not null,
  start_minutes integer not null check (start_minutes >= 0 and start_minutes < 1440),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  constraint schedule_items_hours_window check (
    (hours_start is null and hours_end is null) or
    (hours_start is not null and hours_end is not null and hours_start < hours_end)
  ),
  constraint schedule_items_duration_bounds check (
    min_duration is null or max_duration is null or min_duration <= max_duration
  )
);

alter table public.schedule_items add column if not exists min_duration integer;
alter table public.schedule_items add column if not exists max_duration integer;
alter table public.schedule_items add column if not exists hour_preset text;
alter table public.schedule_items add column if not exists hours_start integer;
alter table public.schedule_items add column if not exists hours_end integer;
alter table public.schedule_items add column if not exists hours_ranges jsonb;
alter table public.schedule_items add column if not exists earliest_start_at timestamp without time zone;
alter table public.schedule_items add column if not exists schedule_after date;
alter table public.schedule_items add column if not exists due_at timestamp without time zone;
alter table public.schedule_items add column if not exists is_pinned boolean not null default false;
alter table public.schedule_items add column if not exists done_at timestamptz;
alter table public.schedule_items add column if not exists deleted_at timestamptz;
alter table public.schedule_items add column if not exists workflow_config jsonb;
alter table public.schedule_items add column if not exists workflow_parent_id uuid references public.schedule_items(id) on delete cascade;
alter table public.schedule_items add column if not exists workflow_stage_id text;

update public.schedule_items
set
  earliest_start_at = coalesce(earliest_start_at, schedule_after::timestamp + interval '9 hours'),
  due_at = coalesce(due_at, deadline::timestamp + interval '18 hours')
where earliest_start_at is null or due_at is null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'schedule_items_priority_check'
  ) then
    alter table public.schedule_items
      drop constraint schedule_items_priority_check;
  end if;

  alter table public.schedule_items
    add constraint schedule_items_priority_check check (priority in ('low', 'medium', 'high', 'critical'));

  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_items_hours_window'
  ) then
    alter table public.schedule_items
      add constraint schedule_items_hours_window check (
        (hours_start is null and hours_end is null) or
        (hours_start is not null and hours_end is not null and hours_start < hours_end)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_items_duration_bounds'
  ) then
    alter table public.schedule_items
      add constraint schedule_items_duration_bounds check (
        min_duration is null or max_duration is null or min_duration <= max_duration
      );
  end if;
end $$;

alter table public.schedule_items enable row level security;

drop policy if exists "public read schedule items" on public.schedule_items;
drop policy if exists "public insert schedule items" on public.schedule_items;
drop policy if exists "public update schedule items" on public.schedule_items;

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

drop policy if exists "public delete schedule items" on public.schedule_items;

create policy "public delete schedule items"
  on public.schedule_items
  for delete
  using (true);

-- External calendar integration tables
create table if not exists public.external_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  calendar_id text not null,
  calendar_name text not null,
  calendar_description text,
  color text,
  primary_calendar boolean not null default false,
  sync_enabled boolean not null default true,
  last_sync_at timestamptz,
  sync_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider, calendar_id)
);

create table if not exists public.external_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  external_calendar_id uuid references public.external_calendars(id) on delete cascade,
  external_event_id text not null,
  title text not null,
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  recurring boolean not null default false,
  recurrence_rule text,
  status text check (status in ('confirmed', 'tentative', 'cancelled')),
  attendees jsonb,
  last_modified timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(external_calendar_id, external_event_id)
);

-- Enable RLS on new tables
alter table public.external_calendars enable row level security;
alter table public.external_events enable row level security;

-- RLS policies for external_calendars
create policy "users can read their own external calendars"
  on public.external_calendars
  for select
  using (auth.uid() = user_id);

create policy "users can insert their own external calendars"
  on public.external_calendars
  for insert
  with check (auth.uid() = user_id);

create policy "users can update their own external calendars"
  on public.external_calendars
  for update
  using (auth.uid() = user_id);

create policy "users can delete their own external calendars"
  on public.external_calendars
  for delete
  using (auth.uid() = user_id);

-- RLS policies for external_events
create policy "users can read their own external events"
  on public.external_events
  for select
  using (auth.uid() = user_id);

create policy "users can insert their own external events"
  on public.external_events
  for insert
  with check (auth.uid() = user_id);

create policy "users can update their own external events"
  on public.external_events
  for update
  using (auth.uid() = user_id);

create policy "users can delete their own external events"
  on public.external_events
  for delete
  using (auth.uid() = user_id);
