-- =============================================================
-- Security-definer helpers for work_reports
--
-- แอปยืนยันตัวตนเจ้าหน้าที่ผ่าน localStorage (Officer object)
-- ไม่ได้สร้าง Supabase Auth session ที่ทำให้ใช้ auth.uid() เป็น null
-- ฟังก์ชันเหล่านี้เป็น SECURITY DEFINER (เจ้าของ = postgres)
-- จึงทำงานผ่าน RLS ได้โดยไม่ต้องมี session ของ Supabase Auth
-- =============================================================

-- รีเซ็ตก่อนสร้างใหม่ (รองรับการรันซ้ำ)
drop function if exists public.submit_work_report(uuid, text, text, uuid);
drop function if exists public.list_work_reports(uuid, text);

create or replace function submit_work_report(
  p_officer_id uuid,
  p_officer_name text,
  p_report_text text,
  p_duty_log_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into work_reports (officer_id, officer_name, duty_log_id, report_text)
  values (p_officer_id, p_officer_name, p_duty_log_id, p_report_text)
  returning id into v_id;
  return v_id;
end;
$$;

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

grant execute on function submit_work_report to anon, authenticated;
grant execute on function list_work_reports to anon, authenticated;
