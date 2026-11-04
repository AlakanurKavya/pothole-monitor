-- Extend vehicle uploads with metadata required for browser-based recorded-video workflows.
-- This is additive and keeps the existing table and RLS model intact.

alter table public.vehicle_uploads
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists recorded_started_at timestamptz,
  add column if not exists recorded_ended_at timestamptz,
  add column if not exists duration_seconds double precision,
  add column if not exists gps_samples jsonb;

create index if not exists idx_vehicle_uploads_recorded_started_at
  on public.vehicle_uploads (recorded_started_at desc);
