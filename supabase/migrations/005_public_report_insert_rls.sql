-- Minimal anonymous insert policy for public pothole reports.
-- This keeps public users anonymous, allows only new inserts, and blocks reads/updates/deletes.

drop policy if exists "citizen_reports_insert_anonymous" on public.citizen_reports;
create policy "citizen_reports_insert_anonymous"
on public.citizen_reports
for insert
with check (
  public.current_role() = 'government'
  or (
    reporter_id is null
    and auth.uid() is null
    and latitude between -90 and 90
    and longitude between -180 and 180
  )
);

drop policy if exists "citizen_reports_select_gov_only" on public.citizen_reports;
create policy "citizen_reports_select_gov_only"
on public.citizen_reports
for select
using (public.current_role() = 'government');

drop policy if exists "citizen_reports_gov_all" on public.citizen_reports;
create policy "citizen_reports_gov_all"
on public.citizen_reports
for update
using (public.current_role() = 'government')
with check (public.current_role() = 'government');

drop policy if exists "citizen_reports_gov_delete" on public.citizen_reports;
create policy "citizen_reports_gov_delete"
on public.citizen_reports
for delete
using (public.current_role() = 'government');

-- Storage upload allowance for anonymous public images only, without exposing existing files.
drop policy if exists "pothole_images_public_insert" on storage.objects;
create policy "pothole_images_public_insert"
on storage.objects
for insert
with check (
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

drop policy if exists "pothole_images_gov_full" on storage.objects;
create policy "pothole_images_gov_full"
on storage.objects
for all
using (bucket_id = 'pothole-images' and public.current_role() = 'government')
with check (bucket_id = 'pothole-images' and public.current_role() = 'government');
