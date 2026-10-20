-- =============================================================
-- 0051: โหมดปิดปรับปรุงระบบ (Maintenance Mode)
-- =============================================================
-- ให้หัวหน้ากรมเปิดโหมดปิดระบบได้จาก Admin Settings
--
-- เมื่อเปิด:
--   - เจ้าหน้าที่ทุกคน (ยกเว้นหัวหน้ากรม) ถูกบล็อกจากทุกหน้า
--   - แสดงหน้า "ปิดปรับปรุงระบบ" พร้อมข้อความสาเหตุที่หัวหน้ากรมพิมพ์
--   - หัวหน้ากรมยังเข้าได้ตามปกติทุกเมนู เพื่อทดสอบระบบ
--
-- เมื่อปิด:
--   - ทุกคนใช้งานได้ตามปกติ
--
-- โครงสร้าง:
--   maintenance_mode    boolean  default false
--   maintenance_message text     nullable (ข้อความสาเหตุ)
-- =============================================================

alter table public.system_settings
  add column if not exists maintenance_mode boolean not null default false;

alter table public.system_settings
  add column if not exists maintenance_message text;

comment on column public.system_settings.maintenance_mode is
  'โหมดปิดปรับปรุงระบบ — true = block ทุกคนยกเว้นหัวหน้ากรม';

comment on column public.system_settings.maintenance_message is
  'ข้อความที่แสดงให้ผู้ใช้เห็นเมื่อระบบปิดปรับปรุง';

-- =============================================================
-- ตรวจสอบผลลัพธ์
-- =============================================================
select
  maintenance_mode,
  maintenance_message,
  login_enabled,
  duty_system_enabled
from public.system_settings
where id = 1;