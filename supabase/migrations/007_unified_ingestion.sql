-- Canonicalize vehicle camera sessions on vehicle_uploads and preserve legacy uploads.
-- Service-role writes happen server-side in Next.js; RLS remains enabled for client access.

alter table public.vehicle_uploads
  alter column operator_id drop not null,
  alter column storage_path drop not null,
  alter column vehicle_id set default 'browser-camera';

alter table public.ai_detections
  add column if not exists captured_at timestamptz;

update public.ai_detections
set captured_at = created_at
where captured_at is null;

insert into public.vehicle_uploads (
  id,
  operator_id,
  vehicle_id,
  storage_path,
  gps_track,
  uploaded_at,
  processing_status
)
select
  video.id,
  null,
  coalesce(nullif(video.vehicle_id, ''), 'legacy-vehicle'),
  video.storage_path,
  video.gps_track,
  video.uploaded_at,
  case
    when video.ai_status in ('pending', 'processing', 'completed', 'failed', 'ai_disconnected')
      then video.ai_status::public.processing_status
    else 'completed'::public.processing_status
  end
from public.vehicle_videos video
on conflict (id) do nothing;

create index if not exists idx_ai_detections_captured_at
  on public.ai_detections (captured_at desc);

create index if not exists idx_vehicle_uploads_uploaded_at
  on public.vehicle_uploads (uploaded_at desc);