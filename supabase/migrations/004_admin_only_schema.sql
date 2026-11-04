-- Admin-only system schema adjustments.
-- Keep the existing application tables for compatibility while adding the exact
-- required names and ensuring public and vehicle submissions do not require auth.

create table if not exists public.admin_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'government' check (role in ('government', 'vehicle_operator', 'public')),
  vehicle_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.vehicle_videos (
  id uuid primary key default gen_random_uuid(),
  vehicle_id text,
  file_name text,
  storage_path text,
  gps_track jsonb,
  source text not null default 'government_vehicle',
  uploaded_at timestamptz not null default now(),
  ai_status text not null default 'pending',
  notes text
);

alter table public.citizen_reports
  alter column reporter_id drop not null;

alter table public.citizen_reports
  add column if not exists source text default 'public';

alter table public.citizen_reports
  add column if not exists gps jsonb;

alter table public.ai_detections
  add column if not exists source_name text;

create index if not exists idx_vehicle_videos_uploaded_at on public.vehicle_videos (uploaded_at desc);
create index if not exists idx_citizen_reports_source on public.citizen_reports (source);
create index if not exists idx_ai_detections_source on public.ai_detections (source);
create index if not exists idx_pothole_locations_verification on public.pothole_locations (verification_status, maintenance_status);

-- Allow anonymous public uploads while keeping the rest of the table read-only to the public.
drop policy if exists "citizen_reports_owner" on public.citizen_reports;
drop policy if exists "citizen_reports_insert_anonymous" on public.citizen_reports;
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
create policy "citizen_reports_gov_all" on public.citizen_reports
  for all using (public.current_role() = 'government')
  with check (public.current_role() = 'government');

-- Public users may not select/update/delete existing reports.
create policy "citizen_reports_select_gov_only" on public.citizen_reports
  for select using (public.current_role() = 'government');

-- Storage: allow anonymous public image upload to the public pothole-images bucket only.
drop policy if exists "pothole_images_access" on storage.objects;
drop policy if exists "pothole_images_public_insert" on storage.objects;
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

-- Optional data compatibility: government accounts can be synced to the admin_users table.
insert into public.admin_users (id, email, full_name, role, vehicle_id, is_active, created_at)
select p.id,
       au.email,
       p.full_name,
       p.role,
       p.vehicle_id,
       true,
       p.created_at
from public.profiles p
left join auth.users au on au.id = p.id
on conflict (id) do nothing;

insert into public.vehicle_videos (id, vehicle_id, file_name, storage_path, gps_track, source, uploaded_at, ai_status)
select v.id,
       v.vehicle_id,
       split_part(v.storage_path, '/', array_length(string_to_array(v.storage_path, '/'), 1)),
       v.storage_path,
       v.gps_track,
       'government_vehicle',
       v.uploaded_at,
       v.processing_status
from public.vehicle_uploads v
on conflict (id) do nothing;
