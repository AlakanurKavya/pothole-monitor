-- Let authenticated public users view only the reports associated with their profile.
-- Government access remains governed by the existing government-only policies.
drop policy if exists "citizen_reports_select_owner" on public.citizen_reports;
create policy "citizen_reports_select_owner"
on public.citizen_reports
for select
to authenticated
using (
  reporter_id = auth.uid()
  and public.current_role() = 'public'
);