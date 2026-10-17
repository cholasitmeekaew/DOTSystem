-- =============================================================
-- 0039 — อ่านเคสย่อยทั้งหมดแบบ bulk สำหรับปุ่ม "ตรวจคะแนนค้าง · ปิดเคส"
-- =============================================================
-- ปัญหา: ตาราง work_report_cases ถูก RLS บัง (policy ใช้ auth.uid())
--   และระบบนี้ไม่มี Supabase Auth → query ตรงได้ 0 แถวเสมอโดยไม่ error
--   ปุ่มตรวจคะแนนค้างจึงมองไม่เห็นเคสเลย และให้คะแนน "+5 ปิดเคส" ไม่ได้
--
-- แก้โดยเพิ่ม RPC ที่คืนเฉพาะเคสที่ปิดสำเร็จ พร้อม report_id เพื่อรู้ว่า
-- เคสนั้นอยู่ในรายงานของใคร
--
-- คืนเฉพาะ case_status = 'completed' เพราะเฉพาะเคสนั้นที่ให้คะแนน
-- ลดทั้งปริมาณข้อมูลและจำนวน RPC ที่ต้องยิง
-- =============================================================

drop function if exists public.get_all_completed_report_cases();

create or replace function public.get_all_completed_report_cases()
returns table (
  id uuid,
  work_report_id uuid,
  case_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.work_report_id, c.case_status
  from public.work_report_cases c
  where c.case_status = 'completed';
$$;

revoke all on function public.get_all_completed_report_cases() from public;
grant execute on function public.get_all_completed_report_cases() to anon, authenticated;

-- ---------- ตรวจสอบ ----------
do $$
begin
  if exists (select 1 from pg_proc
             where proname = 'get_all_completed_report_cases') then
    raise notice '0039 สำเร็จ: get_all_completed_report_cases() พร้อมใช้งาน';
  else
    raise exception '0039 ล้มเหลว: ไม่พบฟังก์ชัน get_all_completed_report_cases';
  end if;
end $$;
