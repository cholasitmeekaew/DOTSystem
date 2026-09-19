-- =============================================================
-- DOTSystem — Secure RPC layer for work reports
-- Migration 0016
--
-- IMPORTANT:
-- The current web login stores Officer in localStorage and does not
-- provide a trusted Supabase Auth identity. Therefore this migration
-- does NOT pretend that a client-supplied officer_id/rank is secure.
--
-- The RPCs below are hardened against parameter tampering as far as
-- the current architecture allows. They also prepare a single place
-- for the application to move to a trusted server-side identity.
--
-- Until the login is migrated to Supabase Auth (or another trusted
-- backend session), direct anon RPC access remains inherently unable
-- to authenticate the caller.
-- =============================================================

-- ---------------------------------------------------------------
-- Work report list
-- Return summary as well as legacy report_text.
-- ---------------------------------------------------------------
drop function if exists public.list_work_reports(uuid, text);

create or replace function public.list_work_reports(
  p_viewer_id uuid default null,
  p_viewer_rank text default null
)
returns table (
  id uuid,
  officer_id uuid,
  officer_name text,
  duty_log_id uuid,
  report_text text,
  summary text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Do not allow arbitrary rank values to unlock all reports.
  -- This is only a compatibility guard until trusted auth is wired in.
  if p_viewer_id is null then
    return;
  end if;

  if p_viewer_rank in ('commissioner', 'inspector') then
    return query
      select
        w.id,
        w.officer_id,
        w.officer_name,
        w.duty_log_id,
        w.report_text,
        w.summary,
        w.created_at,
        w.updated_at
      from public.work_reports w
      order by w.created_at desc;
  else
    return query
      select
        w.id,
        w.officer_id,
        w.officer_name,
        w.duty_log_id,
        w.report_text,
        w.summary,
        w.created_at,
        w.updated_at
      from public.work_reports w
      where w.officer_id = p_viewer_id
      order by w.created_at desc;
  end if;
end;
$$;

revoke all on function public.list_work_reports(uuid, text) from public;
grant execute on function public.list_work_reports(uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------
-- Create work report + cases
-- ---------------------------------------------------------------
drop function if exists public.create_work_report_with_cases(uuid, text, uuid, text, jsonb);

create or replace function public.create_work_report_with_cases(
  p_officer_id uuid,
  p_officer_name text,
  p_duty_log_id uuid default null,
  p_summary text default '',
  p_cases jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_officer_name text;
  r record;
  v_case_count integer := 0;
begin
  -- Basic input validation.
  if p_officer_id is null then
    raise exception 'invalid officer: officer_id is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.officers o
    where o.id = p_officer_id
      and o.status = 'active'
  ) then
    raise exception 'invalid officer: officer not found or inactive'
      using errcode = '22023';
  end if;

  -- Never persist the officer name supplied by the browser.
  select o.name into v_officer_name
  from public.officers o
  where o.id = p_officer_id;

  if p_duty_log_id is not null and not exists (
    select 1
    from public.duty_logs d
    where d.id = p_duty_log_id
      and d.officer_id = p_officer_id
      and d.deleted_at is null
  ) then
    raise exception 'invalid duty log: duty log does not belong to officer'
      using errcode = '22023';
  end if;

  if p_cases is null or jsonb_typeof(p_cases) <> 'array' then
    raise exception 'invalid cases: expected JSON array'
      using errcode = '22023';
  end if;

  -- Prevent unexpectedly large payloads / abuse.
  if jsonb_array_length(p_cases) > 50 then
    raise exception 'too many cases: maximum is 50'
      using errcode = '22023';
  end if;

  -- Keep summary and legacy report_text intentionally identical for
  -- backwards compatibility with the existing UI/schema.
  insert into public.work_reports (
    officer_id,
    officer_name,
    duty_log_id,
    report_text,
    summary
  )
  values (
    p_officer_id,
    v_officer_name,
    p_duty_log_id,
    coalesce(trim(p_summary), ''),
    coalesce(trim(p_summary), '')
  )
  returning id into v_report_id;

  for r in
    select
      nullif(trim(c ->> 'case_type'), '') as case_type,
      nullif(trim(c ->> 'details'), '') as details,
      nullif(trim(c ->> 'evidence_url'), '') as evidence_url
    from jsonb_array_elements(p_cases) as c
  loop
    if r.details is not null then
      v_case_count := v_case_count + 1;

      insert into public.work_report_cases (
        work_report_id,
        case_type,
        details,
        evidence_url
      )
      values (
        v_report_id,
        r.case_type,
        r.details,
        r.evidence_url
      );
    end if;
  end loop;

  return v_report_id;
end;
$$;

revoke all on function public.create_work_report_with_cases(uuid, text, uuid, text, jsonb) from public;
grant execute on function public.create_work_report_with_cases(uuid, text, uuid, text, jsonb) to anon, authenticated;


-- ---------------------------------------------------------------
-- Read cases for one report
-- ---------------------------------------------------------------
drop function if exists public.get_work_report_cases(uuid);

create or replace function public.get_work_report_cases(p_work_report_id uuid)
returns table (
  id uuid,
  work_report_id uuid,
  case_type text,
  details text,
  evidence_url text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_work_report_id is null then
    raise exception 'invalid report id'
      using errcode = '22023';
  end if;

  return query
    select
      c.id,
      c.work_report_id,
      c.case_type,
      c.details,
      c.evidence_url,
      c.created_at,
      c.updated_at
    from public.work_report_cases c
    where c.work_report_id = p_work_report_id
    order by c.created_at asc;
end;
$$;

revoke all on function public.get_work_report_cases(uuid) from public;
grant execute on function public.get_work_report_cases(uuid) to anon, authenticated;


-- ---------------------------------------------------------------
-- Legacy single-report submit RPC
-- Keep it compatible, but never trust the supplied officer name.
-- ---------------------------------------------------------------
drop function if exists public.submit_work_report(uuid, text, text, uuid);

create or replace function public.submit_work_report(
  p_officer_id uuid,
  p_officer_name text,
  p_report_text text,
  p_duty_log_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_officer_name text;
begin
  if p_officer_id is null then
    raise exception 'invalid officer: officer_id is required'
      using errcode = '22023';
  end if;

  select o.name into v_officer_name
  from public.officers o
  where o.id = p_officer_id
    and o.status = 'active';

  if v_officer_name is null then
    raise exception 'invalid officer: officer not found or inactive'
      using errcode = '22023';
  end if;

  if p_duty_log_id is not null and not exists (
    select 1
    from public.duty_logs d
    where d.id = p_duty_log_id
      and d.officer_id = p_officer_id
      and d.deleted_at is null
  ) then
    raise exception 'invalid duty log: duty log does not belong to officer'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_report_text, '')), '') is null then
    raise exception 'invalid report: report text is required'
      using errcode = '22023';
  end if;

  insert into public.work_reports (
    officer_id,
    officer_name,
    duty_log_id,
    report_text,
    summary
  )
  values (
    p_officer_id,
    v_officer_name,
    p_duty_log_id,
    trim(p_report_text),
    trim(p_report_text)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_work_report(uuid, text, text, uuid) from public;
grant execute on function public.submit_work_report(uuid, text, text, uuid) to anon, authenticated;


-- =============================================================
-- NOTE FOR NEXT AUTH MIGRATION
--
-- The functions above still accept p_officer_id because the current
-- application authenticates via localStorage. Once Supabase Auth is
-- enabled, these RPCs MUST be changed to derive identity from auth.uid()
-- and the anon grants must be removed.
-- =============================================================
