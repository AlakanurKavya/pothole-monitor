-- Pothole monitoring schema
create extension if not exists "pgcrypto";

do $$ begin
  create type user_role as enum ('government', 'vehicle_operator', 'public');
exception when duplicate_object then null; end $$;

do $$ begin
  create type detection_source as enum ('vehicle', 'public');
exception when duplicate_object then null; end $$;

do $$ begin
  create type processing_status as enum ('pending', 'processing', 'completed', 'failed', 'ai_disconnected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_status as enum ('pending', 'verified', 'rejected', 'corrected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type severity_level as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type maintenance_status as enum ('reported', 'verified', 'assigned', 'under_repair', 'repaired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type priority_level as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role user_role not null default 'public',
  vehicle_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.pothole_locations (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  public_report_count integer not null default 0,
  vehicle_detection_count integer not null default 0,
  severity severity_level,
  verification_status verification_status not null default 'pending',
  maintenance_status maintenance_status not null default 'reported',
  computed_priority priority_level not null default 'medium',
  priority_override priority_level,
  location_weight numeric not null default 1,
  first_reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_uploads (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles (id) on delete cascade,
  vehicle_id text not null,
  storage_path text not null,
  gps_track jsonb,
  uploaded_at timestamptz not null default now(),
  processing_status processing_status not null default 'pending',
  processing_error text
);

create table if not exists public.citizen_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete cascade,
  report_code text unique not null,
  storage_path text not null,
  latitude double precision not null,
  longitude double precision not null,
  reported_at timestamptz not null default now(),
  processing_status processing_status not null default 'pending',
  processing_error text
);

create table if not exists public.ai_detections (
  id uuid primary key default gen_random_uuid(),
  source detection_source not null,
  vehicle_upload_id uuid references public.vehicle_uploads (id) on delete set null,
  public_report_id uuid references public.citizen_reports (id) on delete set null,
  pothole_location_id uuid references public.pothole_locations (id) on delete set null,
  frame_image_path text not null,
  bbox jsonb not null,
  confidence double precision not null,
  frame_number integer,
  video_timestamp double precision,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.verification_records (
  id uuid primary key default gen_random_uuid(),
  ai_detection_id uuid not null references public.ai_detections (id) on delete cascade,
  pothole_location_id uuid references public.pothole_locations (id) on delete set null,
  verified_by uuid not null references public.profiles (id),
  action verification_status not null,
  original_bbox jsonb not null,
  corrected_bbox jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  pothole_location_id uuid not null references public.pothole_locations (id) on delete cascade,
  status maintenance_status not null,
  updated_by uuid not null references public.profiles (id),
  notes text,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
  assigned user_role;
  allowlist text;
begin
  requested := coalesce(new.raw_user_meta_data->>'role', 'public');
  allowlist := coalesce(current_setting('app.government_emails', true), '');

  if requested = 'government' then
    assigned := 'public';
  elsif requested = 'vehicle_operator' then
    assigned := 'vehicle_operator';
  else
    assigned := 'public';
  end if;

  if position(lower(new.email) in lower(allowlist)) > 0 then
    assigned := 'government';
  end if;

  insert into public.profiles (id, full_name, role, vehicle_id)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    assigned,
    new.raw_user_meta_data->>'vehicle_id'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.haversine_meters(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
) returns double precision
language sql
immutable
as $$
  select 6371000 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

create or replace function public.next_pothole_public_id()
returns text
language plpgsql
as $$
declare
  n integer;
begin
  select coalesce(max(substring(public_id from 2)::int), 0) + 1
    into n
  from public.pothole_locations
  where public_id ~ '^P[0-9]+$';
  return 'P' || lpad(n::text, 3, '0');
end;
$$;

create or replace function public.recompute_pothole_priority(loc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  loc public.pothole_locations%rowtype;
  score numeric := 0;
  age_days numeric;
  computed priority_level;
begin
  select * into loc from public.pothole_locations where id = loc_id;
  if not found then
    return;
  end if;

  if loc.maintenance_status = 'repaired' then
    computed := 'low';
  else
    score := score + case loc.severity
      when 'high' then 30
      when 'medium' then 15
      when 'low' then 5
      else 8
    end;
    score := score + (loc.public_report_count * 8);
    score := score + (loc.vehicle_detection_count * 6);
    age_days := extract(epoch from (now() - loc.first_reported_at)) / 86400.0;
    score := score + least(20, age_days * 0.5);
    score := score + (coalesce(loc.location_weight, 1) * 5);

    if score >= 40 then
      computed := 'high';
    elsif score >= 20 then
      computed := 'medium';
    else
      computed := 'low';
    end if;
  end if;

  update public.pothole_locations
    set computed_priority = computed, updated_at = now()
    where id = loc_id;
end;
$$;

create or replace function public.assign_or_create_pothole_location(
  in_lat double precision,
  in_lng double precision,
  in_source detection_source,
  in_address text default null,
  radius_m double precision default 40
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  loc_id uuid;
begin
  if in_lat is null or in_lng is null then
    return null;
  end if;

  select id into loc_id
  from public.pothole_locations
  where public.haversine_meters(latitude, longitude, in_lat, in_lng) <= radius_m
  order by public.haversine_meters(latitude, longitude, in_lat, in_lng)
  limit 1;

  if loc_id is null then
    insert into public.pothole_locations (
      public_id, latitude, longitude, address, public_report_count, vehicle_detection_count
    ) values (
      public.next_pothole_public_id(),
      in_lat,
      in_lng,
      in_address,
      case when in_source = 'public' then 1 else 0 end,
      case when in_source = 'vehicle' then 1 else 0 end
    )
    returning id into loc_id;
  else
    update public.pothole_locations
      set
        public_report_count = public_report_count + case when in_source = 'public' then 1 else 0 end,
        vehicle_detection_count = vehicle_detection_count + case when in_source = 'vehicle' then 1 else 0 end,
        latitude = (latitude + in_lat) / 2.0,
        longitude = (longitude + in_lng) / 2.0,
        updated_at = now()
      where id = loc_id;
  end if;

  perform public.recompute_pothole_priority(loc_id);
  return loc_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.vehicle_uploads enable row level security;
alter table public.citizen_reports enable row level security;
alter table public.ai_detections enable row level security;
alter table public.pothole_locations enable row level security;
alter table public.verification_records enable row level security;
alter table public.maintenance_records enable row level security;

drop policy if exists "profiles_self_read" on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "vehicle_uploads_operator" on public.vehicle_uploads;
drop policy if exists "citizen_reports_insert_anonymous" on public.citizen_reports;
drop policy if exists "citizen_reports_select_gov_only" on public.citizen_reports;
drop policy if exists "citizen_reports_gov_all" on public.citizen_reports;
drop policy if exists "citizen_reports_gov_delete" on public.citizen_reports;
drop policy if exists "ai_detections_read" on public.ai_detections;
drop policy if exists "ai_detections_insert_own" on public.ai_detections;
drop policy if exists "pothole_locations_gov" on public.pothole_locations;
drop policy if exists "pothole_locations_read_limited" on public.pothole_locations;
drop policy if exists "verification_gov_only" on public.verification_records;
drop policy if exists "maintenance_gov_only" on public.maintenance_records;

create policy "profiles_self_read" on public.profiles
  for select using (id = auth.uid() or public.current_role() = 'government');

create policy "profiles_self_update" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid()));

create policy "vehicle_uploads_operator" on public.vehicle_uploads
  for all using (
    operator_id = auth.uid() or public.current_role() = 'government'
  ) with check (
    operator_id = auth.uid() or public.current_role() = 'government'
  );

create policy "citizen_reports_insert_anonymous" on public.citizen_reports
  for insert with check (
    public.current_role() = 'government'
    or (
      reporter_id is null
      and auth.uid() is null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  );

create policy "citizen_reports_select_gov_only" on public.citizen_reports
  for select using (public.current_role() = 'government');

create policy "citizen_reports_gov_all" on public.citizen_reports
  for update using (public.current_role() = 'government')
  with check (public.current_role() = 'government');

create policy "citizen_reports_gov_delete" on public.citizen_reports
  for delete using (public.current_role() = 'government');

create policy "ai_detections_read" on public.ai_detections
  for select using (
    public.current_role() = 'government'
    or exists (
      select 1 from public.citizen_reports r
      where r.id = public_report_id and r.reporter_id = auth.uid()
    )
    or exists (
      select 1 from public.vehicle_uploads v
      where v.id = vehicle_upload_id and v.operator_id = auth.uid()
    )
  );

create policy "ai_detections_insert_own" on public.ai_detections
  for insert with check (
    public.current_role() = 'government'
    or exists (
      select 1 from public.citizen_reports r
      where r.id = public_report_id and r.reporter_id = auth.uid()
    )
    or exists (
      select 1 from public.vehicle_uploads v
      where v.id = vehicle_upload_id and v.operator_id = auth.uid()
    )
  );

create policy "pothole_locations_gov" on public.pothole_locations
  for all using (public.current_role() = 'government')
  with check (public.current_role() = 'government');

create policy "pothole_locations_read_limited" on public.pothole_locations
  for select using (
    public.current_role() = 'government'
    or exists (
      select 1 from public.ai_detections d
      join public.citizen_reports r on r.id = d.public_report_id
      where d.pothole_location_id = pothole_locations.id and r.reporter_id = auth.uid()
    )
    or exists (
      select 1 from public.ai_detections d
      join public.vehicle_uploads v on v.id = d.vehicle_upload_id
      where d.pothole_location_id = pothole_locations.id and v.operator_id = auth.uid()
    )
  );

create policy "verification_gov_only" on public.verification_records
  for all using (public.current_role() = 'government')
  with check (public.current_role() = 'government');

create policy "maintenance_gov_only" on public.maintenance_records
  for all using (public.current_role() = 'government')
  with check (public.current_role() = 'government');

insert into storage.buckets (id, name, public)
values
  ('vehicle-videos', 'vehicle-videos', false),
  ('pothole-images', 'pothole-images', false)
on conflict (id) do nothing;

drop policy if exists "vehicle_videos_access" on storage.objects;
drop policy if exists "pothole_images_access" on storage.objects;

create policy "vehicle_videos_access" on storage.objects
  for all using (
    bucket_id = 'vehicle-videos'
    and (
      public.current_role() = 'government'
      or auth.uid()::text = (storage.foldername(name))[1]
    )
  ) with check (
    bucket_id = 'vehicle-videos'
    and (
      public.current_role() = 'government'
      or auth.uid()::text = (storage.foldername(name))[1]
    )
  );

create policy "pothole_images_public_insert" on storage.objects
  for insert with check (
    bucket_id = 'pothole-images'
    and (
      public.current_role() = 'government'
      or (
        auth.uid() is null
        and array_length(storage.foldername(name), 1) = 1
        and storage.foldername(name)[1] = 'anonymous'
      )
    )
  );

create policy "pothole_images_gov_full" on storage.objects
  for all using (bucket_id = 'pothole-images' and public.current_role() = 'government')
  with check (bucket_id = 'pothole-images' and public.current_role() = 'government');
