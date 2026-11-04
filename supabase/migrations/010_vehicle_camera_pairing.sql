-- Supabase manages realtime.messages grants, ownership, and RLS state. Do not
-- alter those settings here. These policies authorize only Broadcast traffic
-- on active vehicle-pair topics; pairing clients use private Realtime channels.
create table if not exists public.vehicle_camera_pairings (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles (id) on delete cascade,
  vehicle_id text not null,
  token_hash text unique,
  mobile_close_token_hash text,
  signal_topic text not null unique,
  monitoring_session_id uuid references public.vehicle_uploads (id) on delete set null,
  created_at timestamptz not null default now(),
  laptop_heartbeat_at timestamptz,
  expires_at timestamptz not null,
  joined_at timestamptz,
  closed_at timestamptz
);

alter table public.vehicle_camera_pairings
  add column if not exists mobile_close_token_hash text,
  add column if not exists monitoring_session_id uuid references public.vehicle_uploads (id) on delete set null,
  add column if not exists laptop_heartbeat_at timestamptz;

create index if not exists idx_vehicle_camera_pairings_operator_created
  on public.vehicle_camera_pairings (operator_id, created_at desc);

create index if not exists idx_vehicle_camera_pairings_expiry
  on public.vehicle_camera_pairings (expires_at);

create unique index if not exists idx_vehicle_camera_pairings_close_token
  on public.vehicle_camera_pairings (mobile_close_token_hash)
  where mobile_close_token_hash is not null;

alter table public.vehicle_camera_pairings enable row level security;
revoke all on public.vehicle_camera_pairings from public, anon, authenticated;

drop policy if exists "paired vehicle camera topic read" on realtime.messages;
drop policy if exists "paired vehicle camera topic send" on realtime.messages;
drop policy if exists "paired vehicle camera topic isolation" on realtime.messages;
drop policy if exists "paired vehicle topic no update" on realtime.messages;
drop policy if exists "paired vehicle topic no delete" on realtime.messages;

drop function if exists public.can_join_vehicle_camera_topic(text);

create or replace function public.can_join_vehicle_camera_topic()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.vehicle_camera_pairings pairing
    where pairing.signal_topic = realtime.topic()
      and pg_catalog.left(pairing.signal_topic, pg_catalog.length('vehicle-pair:')) = 'vehicle-pair:'
      and pairing.joined_at is not null
      and pairing.closed_at is null
      and pairing.expires_at > pg_catalog.now()
      and pairing.laptop_heartbeat_at > pg_catalog.now() - interval '45 seconds'
  );
$$;

alter function public.can_join_vehicle_camera_topic() owner to postgres;
revoke all on function public.can_join_vehicle_camera_topic() from public;
grant execute on function public.can_join_vehicle_camera_topic() to anon, authenticated;

create policy "paired vehicle camera topic read" on realtime.messages
  as permissive for select to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_join_vehicle_camera_topic()
  );

create policy "paired vehicle camera topic isolation" on realtime.messages
  as restrictive for all to anon, authenticated
  using (
    pg_catalog.left(realtime.topic(), pg_catalog.length('vehicle-pair:')) <> 'vehicle-pair:'
    or public.can_join_vehicle_camera_topic()
  )
  with check (
    pg_catalog.left(realtime.topic(), pg_catalog.length('vehicle-pair:')) <> 'vehicle-pair:'
    or public.can_join_vehicle_camera_topic()
  );

create policy "paired vehicle topic no update" on realtime.messages
  as restrictive for update to anon, authenticated
  using (pg_catalog.left(realtime.topic(), pg_catalog.length('vehicle-pair:')) <> 'vehicle-pair:')
  with check (pg_catalog.left(realtime.topic(), pg_catalog.length('vehicle-pair:')) <> 'vehicle-pair:');

create policy "paired vehicle topic no delete" on realtime.messages
  as restrictive for delete to anon, authenticated
  using (pg_catalog.left(realtime.topic(), pg_catalog.length('vehicle-pair:')) <> 'vehicle-pair:');

create policy "paired vehicle camera topic send" on realtime.messages
  as permissive for insert to anon, authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.can_join_vehicle_camera_topic()
  );
