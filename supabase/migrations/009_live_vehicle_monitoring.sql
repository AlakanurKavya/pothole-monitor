alter table public.vehicle_uploads
  add column if not exists monitoring_started_at timestamptz,
  add column if not exists monitoring_ended_at timestamptz,
  add column if not exists frame_interval_ms integer not null default 1500,
  add column if not exists confidence_threshold double precision not null default 0.5;

alter table public.ai_detections
  add column if not exists frame_hash text,
  add column if not exists detection_index integer,
  add column if not exists verification_status public.verification_status not null default 'pending';

update public.ai_detections detection
set verification_status = latest.action
from (
  select distinct on (ai_detection_id) ai_detection_id, action
  from public.verification_records
  order by ai_detection_id, created_at desc
) latest
where detection.id = latest.ai_detection_id;

create unique index if not exists idx_ai_detections_vehicle_frame_candidate
  on public.ai_detections (vehicle_upload_id, frame_hash, detection_index);

create index if not exists idx_vehicle_uploads_monitoring_started_at
  on public.vehicle_uploads (monitoring_started_at desc);
