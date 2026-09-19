-- =============================================================
-- Duty report detail fields
-- =============================================================

alter table work_reports
  add column if not exists duty_category text;

alter table work_report_cases
  add column if not exists case_name text,
  add column if not exists citizen_username text,
  add column if not exists citizen_id uuid references citizens(id) on delete set null,
  add column if not exists case_status text default 'completed';

drop function if exists public.create_work_report_with_cases(uuid, text, uuid, text, jsonb);
create or replace function create_work_report_with_cases(
  p_officer_id uuid,
  p_officer_name text,
  p_duty_log_id uuid default null,
  p_summary text default '',
  p_cases jsonb default '[]'::jsonb,
  p_duty_category text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  r record;
begin
  insert into work_reports (officer_id, officer_name, duty_log_id, report_text, summary, duty_category)
  values (p_officer_id, p_officer_name, p_duty_log_id, p_summary, p_summary, p_duty_category)
  returning id into v_report_id;

  for r in
    select
      nullif(c ->> 'case_name', '')::text as case_name,
      nullif(c ->> 'case_type', '')::text as case_type,
      coalesce(nullif(c ->> 'case_status', ''), 'completed')::text as case_status,
      nullif(c ->> 'citizen_username', '')::text as citizen_username,
      nullif(c ->> 'citizen_id', '')::uuid as citizen_id,
      (c ->> 'details')::text as details,
      nullif(c ->> 'evidence_url', '') as evidence_url
    from jsonb_array_elements(p_cases) as c
  loop
    if trim(coalesce(r.details, '')) <> '' or trim(coalesce(r.case_name, '')) <> '' then
      insert into work_report_cases (
        work_report_id, case_name, case_type, case_status, citizen_username, citizen_id, details, evidence_url
      )
      values (
        v_report_id, r.case_name, r.case_type, r.case_status, r.citizen_username, r.citizen_id, coalesce(r.details, ''), r.evidence_url
      );
    end if;
  end loop;

  return v_report_id;
end;
$$;

drop function if exists public.get_work_report_cases(uuid);
create or replace function get_work_report_cases(p_work_report_id uuid)
returns table (
  id uuid,
  work_report_id uuid,
  case_name text,
  case_type text,
  citizen_username text,
  citizen_id uuid,
  case_status text,
  details text,
  evidence_url text,
  created_at timestamptz
)
language plpgsql security definer
set search_path = public
as $$
begin
  return query
  select
    c.id, c.work_report_id, c.case_name, c.case_type, c.citizen_username, c.citizen_id,
    c.case_status, c.details, c.evidence_url, c.created_at
  from work_report_cases c
  where c.work_report_id = p_work_report_id
  order by c.created_at asc;
end;
$$;

grant execute on function create_work_report_with_cases to anon, authenticated;
grant execute on function get_work_report_cases to anon, authenticated;
