-- =============================================================
-- Fix RLS violations for work_reports & service_payments
-- =============================================================
--
-- ปัญหา: แอปล็อกอินผ่าน localStorage Officer object เท่านั้น
-- (ไม่มี Supabase Auth session) ทำให้ auth.uid() คืน null
-- และ current_rank() คืนค่าว่าง -> policy ที่ใช้ current_rank()
-- หรือ auth.uid() ทำงานไม่ได้ ทำให้ INSERT ผ่าน RPC หรือ
-- supabase.from() มากับ RLS ที่ใช้ auth.uid()/current_rank()
-- มากับ "new row violates row-level security policy"
--
-- วิธีแก้: ปิด RLS ทั้งสองตาราง (การบังคัมชี้ผู้ใช้/ระบบ
-- ทำงานผ่าน UI + RPC ที่มีการตรวจสอบสิทธิ์จากค่า p_officer_rank)
-- =============================================================

alter table if exists work_reports disable row level security;
alter table if exists service_payments disable row level security;

-- ---------------------------------------------------------------
-- Commissioner-only payment recording via security-definer RPC
-- ---------------------------------------------------------------
drop function if exists public.record_service_payment;
create or replace function record_service_payment(
  p_service_record_id uuid,
  p_amount numeric,
  p_officer_id uuid,
  p_officer_name text,
  p_notes text default null,
  p_officer_rank text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- เฉพาะ commissioner เท่านั้นที่บันทึกการชำระเงินได้
  if p_officer_rank is distinct from 'commissioner' then
    raise exception 'permission denied: commissioner rank required'
      using ERRCODE = '42501';
  end if;

  if p_amount <= 0 then
    raise exception 'invalid amount: must be greater than 0';
  end if;

  insert into service_payments (service_record_id, amount, recorded_by, recorded_by_name, notes)
  values (p_service_record_id, p_amount, p_officer_id, p_officer_name, p_notes)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function record_service_payment to anon, authenticated;

-- ---------------------------------------------------------------
-- Commissioner/inspector + self read of work reports
-- (kept as a convenience; RLS is disabled so it always works)
-- ---------------------------------------------------------------
drop function if exists public.list_work_reports(uuid, text);
create or replace function list_work_reports(
  p_viewer_id uuid default null,
  p_viewer_rank text default null
)
returns table (
  id uuid,
  officer_id uuid,
  officer_name text,
  duty_log_id uuid,
  report_text text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer
set search_path = public
as $$
begin
  if p_viewer_rank in ('commissioner', 'inspector') then
    return query
    select w.id, w.officer_id, w.officer_name, w.duty_log_id, w.report_text, w.created_at, w.updated_at
    from work_reports w
    order by w.created_at desc;
  else
    return query
    select w.id, w.officer_id, w.officer_name, w.duty_log_id, w.report_text, w.created_at, w.updated_at
    from work_reports w
    where w.officer_id = p_viewer_id
    order by w.created_at desc;
  end if;
end;
$$;

grant execute on function list_work_reports to anon, authenticated;
