-- The officer UI uses the application's own login, so it cannot rely on
-- auth.uid()-based RLS when reading or writing case assignments.

create or replace function public.list_service_record_officers(p_record_ids uuid[])
returns table(service_record_id uuid, officer_id uuid)
language sql
security definer
set search_path = public
as $$
  select sro.service_record_id, sro.officer_id
  from service_record_officers sro
  where sro.service_record_id = any(coalesce(p_record_ids, '{}'::uuid[]));
$$;

-- The older version may have parameter defaults. PostgreSQL does not allow
-- removing those defaults with CREATE OR REPLACE, so replace this exact
-- signature explicitly.
drop function if exists public.assign_record_officers(uuid, uuid[], uuid);

create or replace function public.assign_record_officers(
  p_record_id uuid,
  p_officer_ids uuid[],
  p_assigned_by uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from officers
    where id = p_assigned_by and status = 'active'
  ) then
    raise exception 'Assigned by officer is not active' using errcode = '42501';
  end if;

  if not exists (select 1 from service_records where id = p_record_id) then
    raise exception 'Service record not found' using errcode = 'P0002';
  end if;

  delete from service_record_officers
  where service_record_id = p_record_id;

  insert into service_record_officers(service_record_id, officer_id, assigned_by)
  select p_record_id, officer_id, p_assigned_by
  from unnest(coalesce(p_officer_ids, '{}'::uuid[])) as assigned(officer_id)
  where exists (
    select 1 from officers
    where id = assigned.officer_id and status = 'active'
  )
  on conflict (service_record_id, officer_id) do nothing;
end;
$$;

grant execute on function public.list_service_record_officers(uuid[]) to anon, authenticated;
grant execute on function public.assign_record_officers(uuid, uuid[], uuid) to anon, authenticated;
