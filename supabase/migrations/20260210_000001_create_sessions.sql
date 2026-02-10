create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  track_url text not null,
  track_sc_id text,
  created_at timestamptz not null default now(),
  playing boolean not null default false,
  position_ms integer not null default 0,
  state_updated_at timestamptz not null default now(),
  host_secret_hash text not null,
  host_lease_expires_at timestamptz not null default (now() + interval '20 seconds'),
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists sessions_created_at_idx on public.sessions (created_at);
create index if not exists sessions_host_lease_expires_at_idx on public.sessions (host_lease_expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sessions_set_updated_at on public.sessions;

create trigger sessions_set_updated_at
before update on public.sessions
for each row
execute function public.set_updated_at();

alter table public.sessions enable row level security;

create policy "sessions_select_all"
on public.sessions
for select
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;
end;
$$;
