-- =============================================================
-- 0034 — สวิตช์เปิด/ปิดการรายงานปฏิบัติงาน
-- =============================================================
-- เพิ่มคีย์สวิตช์ใน system_settings ให้หัวหน้ากรมควบคุมได้ว่า
-- เจ้าหน้าที่ยังส่งรายงานปฏิบัติงานได้หรือไม่
--
-- ค่าเริ่มต้น = true (เปิด) → ไม่เปลี่ยนพฤติกรรมของระบบที่ใช้อยู่แล้ว
--
-- หมายเหตุเรื่องขอบเขต:
--   สวิตช์นี้ควบคุมฝั่ง UI (ซ่อนปุ่มส่งรายงาน) — ยังไม่บังคับที่ฝั่งฐานข้อมูล
--   เพราะระบบนี้ไม่มี Supabase Auth ฐานข้อมูลระบุไม่ได้ว่า "ใครกำลังเรียก"
--   ใครมี access key ก็ยัง insert เข้า work_reports ได้โดยตรง
--   การบังคับจริงต้องรอ Supabase Auth
-- =============================================================

alter table system_settings
  add column if not exists work_reports_enabled boolean not null default true;

comment on column system_settings.work_reports_enabled is
  'true = เจ้าหน้าที่ส่งรายงานปฏิบัติงานได้ / false = ปิดการส่งรายงานทั้งระบบ';

-- ---------- ตรวจสอบ ----------
do $$
declare
  v_has boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'system_settings'
      and column_name = 'work_reports_enabled'
  ) into v_has;

  if v_has then
    raise notice '0034 สำเร็จ: system_settings.work_reports_enabled พร้อมใช้งาน';
  else
    raise exception '0034 ล้มเหลว: ไม่พบคอลัมน์ work_reports_enabled';
  end if;
end $$;
