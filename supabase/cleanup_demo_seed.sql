-- Safe cleanup for demo/seed data created by the sample migration.
-- This script is intentionally manual and should be reviewed before execution.
-- It targets only the known demo pothole IDs from the seed migration.
-- DO NOT run this automatically against a production database with real user data.

-- 1) Review the demo records first.
select id, public_id, address, latitude, longitude, verification_status, maintenance_status, created_at
from public.pothole_locations
where public_id in ('P001','P002','P003','P004','P005')
order by public_id;

-- 2) Review their related detections before deleting anything.
select d.id, d.source, d.pothole_location_id, d.latitude, d.longitude, d.created_at
from public.ai_detections d
join public.pothole_locations p on p.id = d.pothole_location_id
where p.public_id in ('P001','P002','P003','P004','P005')
order by d.created_at;

-- 3) Optional manual cleanup after review.
-- delete from public.verification_records
-- where pothole_location_id in (
--   select id from public.pothole_locations where public_id in ('P001','P002','P003','P004','P005')
-- );
--
-- delete from public.maintenance_records
-- where pothole_location_id in (
--   select id from public.pothole_locations where public_id in ('P001','P002','P003','P004','P005')
-- );
--
-- delete from public.ai_detections
-- where pothole_location_id in (
--   select id from public.pothole_locations where public_id in ('P001','P002','P003','P004','P005')
-- );
--
-- delete from public.pothole_locations
-- where public_id in ('P001','P002','P003','P004','P005');
