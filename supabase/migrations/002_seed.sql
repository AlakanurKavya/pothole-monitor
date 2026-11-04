-- Demo clustered potholes around New Delhi so the government map works
-- before live YOLO processing. Does not create auth users.

insert into public.pothole_locations (
  public_id, latitude, longitude, address,
  public_report_count, vehicle_detection_count,
  severity, verification_status, maintenance_status,
  computed_priority, location_weight, first_reported_at
) values
  ('P001', 28.6139, 77.2090, 'Janpath, New Delhi', 4, 3, 'high', 'verified', 'assigned', 'high', 1.2, now() - interval '18 days'),
  ('P002', 28.6304, 77.2177, 'Connaught Place, New Delhi', 2, 1, 'medium', 'corrected', 'under_repair', 'high', 1.4, now() - interval '9 days'),
  ('P003', 28.5921, 77.0460, 'NH-48, Dwarka stretch', 1, 0, null, 'pending', 'reported', 'medium', 1.0, now() - interval '2 days'),
  ('P004', 28.5672, 77.2100, 'Sri Aurobindo Marg', 1, 2, 'low', 'rejected', 'reported', 'low', 0.8, now() - interval '5 days'),
  ('P005', 28.6127, 77.2295, 'India Gate circle approach', 3, 1, 'high', 'verified', 'repaired', 'low', 1.5, now() - interval '30 days')
on conflict (public_id) do nothing;

insert into public.ai_detections (
  source, pothole_location_id, frame_image_path, bbox, confidence,
  frame_number, video_timestamp, latitude, longitude
)
select 'public'::public.detection_source, id, 'demo/p001-public.svg', '{"x":0.30,"y":0.45,"w":0.22,"h":0.16}'::jsonb, 0.88, 0, 0, 28.61395, 77.20905
from public.pothole_locations where public_id = 'P001'
union all
select 'vehicle'::public.detection_source, id, 'demo/p001-vehicle.svg', '{"x":0.33,"y":0.47,"w":0.20,"h":0.14}'::jsonb, 0.74, 42, 1.4, 28.61410, 77.20880
from public.pothole_locations where public_id = 'P001'
union all
select 'public'::public.detection_source, id, 'demo/p002-public.svg', '{"x":0.41,"y":0.52,"w":0.18,"h":0.12}'::jsonb, 0.81, 0, 0, 28.63050, 77.21760
from public.pothole_locations where public_id = 'P002'
union all
select 'public'::public.detection_source, id, 'demo/p003-public.svg', '{"x":0.25,"y":0.58,"w":0.28,"h":0.18}'::jsonb, 0.69, 0, 0, 28.59220, 77.04610
from public.pothole_locations where public_id = 'P003'
union all
select 'vehicle'::public.detection_source, id, 'demo/p004-vehicle.svg', '{"x":0.50,"y":0.40,"w":0.15,"h":0.11}'::jsonb, 0.51, 18, 0.6, 28.56730, 77.21020
from public.pothole_locations where public_id = 'P004'
union all
select 'public'::public.detection_source, id, 'demo/p005-public.svg', '{"x":0.36,"y":0.49,"w":0.21,"h":0.15}'::jsonb, 0.92, 0, 0, 28.61280, 77.22940
from public.pothole_locations where public_id = 'P005';
