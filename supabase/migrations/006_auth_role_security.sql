-- Keep government invites exact-match and prevent authenticated clients from changing profile roles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned user_role;
  allowlist text;
begin
  assigned := 'public';
  allowlist := coalesce(current_setting('app.government_emails', true), '');

  if exists (
    select 1
    from unnest(string_to_array(allowlist, ',')) as invited(email)
    where lower(btrim(invited.email)) = lower(btrim(new.email))
  ) then
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

revoke update on table public.profiles from authenticated;
grant update (full_name, vehicle_id) on table public.profiles to authenticated;