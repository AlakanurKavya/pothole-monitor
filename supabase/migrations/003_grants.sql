grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage on type user_role, detection_source, processing_status, verification_status, severity_level, maintenance_status, priority_level to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.assign_or_create_pothole_location(double precision, double precision, detection_source, text, double precision) to authenticated;
grant execute on function public.recompute_pothole_priority(uuid) to authenticated;
grant execute on function public.haversine_meters(double precision, double precision, double precision, double precision) to authenticated;
