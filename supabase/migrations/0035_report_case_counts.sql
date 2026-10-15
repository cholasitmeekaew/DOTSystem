-- =============================================================
-- 0035 — นับจำนวนเคสของรายงานทุกฉบับแบบ bulk
-- =============================================================
-- ปัญหา: ตาราง work_report_cases ถูก RLS บัง (policy ใช้ auth.uid())
--   และระบบนี้ไม่มี Supabase Auth → query ตรงได้ 0 แถวเสมอ โดยไม่ error
--   ตัวหน้า "ประวัติรายงานทั้งหมด" จึงแสดง "0 เคส" ในการ์ด
--   ขณะที่ modal (ที่เรียก RPC รายฉบับ) แสดงจำนวนถูกต้อง
--
-- แก้โดยเพิ่ม RPC ที่คืนจำนวนเคสของทุกรายงานในครั้งเดียว
-- (แทนการเรียก get_work_report_cases ทีละรายงาน ซึ่งแพงเกินไป)
--
-- SECURITY DEFINER + revoke จาก public เพื่อไม่ให้เปิดกว้างเกินจำเป็น
-- =============================================================

drop function if exists public.get_work_report_case_counts();

create or replace function public.get_work_report_case_counts()
returns table (
  work_report_id uuid,
  case_count bigint,
  completed_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.work_report_id,
    count(*)::bigint,
    count(*) filter (where c.case_status = 'completed')::bigint
  from public.work_report_cases c
  group by c.work_report_id;
$$;

revoke all on function public.get_work_report_case_counts() from public;
grant execute on function public.get_work_report_case_counts() to anon, authenticated;

-- ---------- ตรวจสอบ ----------
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'get_work_report_case_counts'
  ) then
    raise notice '0035 สำเร็จ: get_work_report_case_counts() พร้อมใช้งาน';
  else
    raise exception '0035 ล้มเหลว: ไม่พบฟังก์ชัน get_work_report_case_counts';
  end if;
end $$;
