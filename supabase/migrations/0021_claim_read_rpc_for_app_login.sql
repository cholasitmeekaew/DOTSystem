-- The application uses its own officer login rather than a Supabase Auth session.
-- Read claim data through controlled security-definer RPCs instead of auth.uid()-based RLS.

create or replace function list_claims_for_officer(p_officer_id uuid)
returns setof claim_records
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select *
    from claim_records
    where officer_id = p_officer_id
    order by created_at desc;
end;
$$;

create or replace function list_claims_for_commissioner(
  p_viewer_id uuid,
  p_status text
)
returns setof claim_records
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from officers
    where id = p_viewer_id
      and rank = 'commissioner'
      and status = 'active'
  ) then
    raise exception 'Only commissioners can view claim approvals' using errcode = '42501';
  end if;

  return query
    select *
    from claim_records
    where status = p_status
    order by created_at desc;
end;
$$;

grant execute on function list_claims_for_officer(uuid) to anon, authenticated;
grant execute on function list_claims_for_commissioner(uuid, text) to anon, authenticated;
