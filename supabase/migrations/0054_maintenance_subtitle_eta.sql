-- =============================================================
-- 0054: เพิ่มข้อความรอง + เวลานับถอยหลัง
-- =============================================================

-- ข้อความรอง (แทนที่ข้อความ hardcoded "ระบบอยู่ระหว่างการบำรุงรักษา...")
alter table public.system_settings
  add column if not exists maintenance_subtitle text;

comment on column public.system_settings.maintenance_subtitle is
  'ข้อความรองใต้หัวข้อหน้า maintenance (แก้ได้จาก Admin)';

-- เวลาคาดว่าจะเสร็จ — ใช้นับถอยหลังบนหน้า maintenance
alter table public.system_settings
  add column if not exists maintenance_eta timestamptz;

comment on column public.system_settings.maintenance_eta is
  'เวลาที่คาดว่าระบบจะกลับมา — แสดงนับถอยหลังบนหน้า maintenance';

-- =============================================================
-- ตรวจสอบ
-- =============================================================
select
  maintenance_mode, maintenance_title, maintenance_subtitle,
  maintenance_message, maintenance_eta
from public.system_settings where id = 1;