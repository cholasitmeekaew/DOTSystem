-- =============================================================
-- Work report cases + independent submission RPCs (migration 0014)
-- เพิ่มเพื่อรองรับรายงานแบบอิสระ หลายเคส/หลายรายการต่อรายงาน
-- =============================================================

-- เพิ่มฟิลด์สรุปรายงานหัวข้อ (เก็บสรุปสั้นๆ ของ officer)
alter table work_reports
  add column if not exists summary text;

-- ตารางเคสย่อยของรายงาน
create table if not exists work_report_cases (
  id uuid primary key default gen_random_uuid(),
  work_report_id uuid not null references work_reports(id) on delete cascade,
  case_type text,
  details text not null,
  evidence_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_report_cases_report_id_idx on work_report_cases (work_report_id);

-- เปิด realtime
alter publication supabase_realtime add table work_report_cases;

-- =============================================================
-- Security-definer RPC helpers
-- (แอปยืนยันตัวตนผ่าน localStorage จึง auth.uid() เป็น null)
-- =============================================================

-- สร้างหัวข้อรายงาน + เคสย่อยในคำเดียว (JSONB array)
drop function if exists public.create_work_report_with_cases(uuid, text, uuid, text, jsonb);
create or replace function create_work_report_with_cases(
  p_officer_id uuid,
  p_officer_name text,
  p_duty_log_id uuid default null,
  p_summary text default '',
  p_cases jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  r record;
begin
  insert into work_reports (officer_id, officer_name, duty_log_id, report_text, summary)
  values (p_officer_id, p_officer_name, p_duty_log_id, p_summary, p_summary)
  returning id into v_report_id;

  for r in
    select
      (c ->> 'case_type')::text   as case_type,
      (c ->> 'details')::text    as details,
      nullif(c ->> 'evidence_url', '') as evidence_url
    from jsonb_array_elements(p_cases) as c
  loop
    if trim(r.details) <> '' then
      insert into work_report_cases (work_report_id, case_type, details, evidence_url)
      values (v_report_id, r.case_type, r.details, r.evidence_url);
    end if;
  end loop;

  return v_report_id;
end;
$$;

-- อ่านเคสย่อยของรายงานหนึ่ง
drop function if exists public.get_work_report_cases(uuid);
create or replace function get_work_report_cases(p_work_report_id uuid)
returns table (
  id uuid,
  work_report_id uuid,
  case_type text,
  details text,
  evidence_url text,
  created_at timestamptz
)
language plpgsql security definer
set search_path = public
as $$
begin
  return query
  select c.id, c.work_report_id, c.case_type, c.details, c.evidence_url, c.created_at
  from work_report_cases c
  where c.work_report_id = p_work_report_id
  order by c.created_at asc;
end;
$$;

grant execute on function create_work_report_with_cases to anon, authenticated;
grant execute on function get_work_report_cases to anon, authenticated;
