-- =============================================================
-- 0053: เปลี่ยน maintenance_mode → 3 โหมด
-- =============================================================
-- เดิม: maintenance_mode boolean (true/false)
-- ใหม่: maintenance_mode text
--   'off'       → ปิด ไม่บล็อกใคร
--   'standard'  → 🟢 บล็อกทุกคน แสดงข้อความ, หัวหน้ากรมเข้าได้
--   'readonly'  → 🟡 ดูได้แต่ทำอะไรไม่ได้ (ห้ามเข้าเวร/ส่งรายงาน)
--   'emergency' → 🔴 ล็อกทั้งหมด, เฉพาะ Super Admin เข้าได้
-- =============================================================

alter table public.system_settings
  alter column maintenance_mode drop default;

alter table public.system_settings
  alter column maintenance_mode type text
  using (case when maintenance_mode then 'standard' else 'off' end);

alter table public.system_settings
  alter column maintenance_mode set default 'off';

update public.system_settings
set maintenance_mode = 'off'
where maintenance_mode is null;

comment on column public.system_settings.maintenance_mode is
  'off / standard / readonly / emergency';

-- =============================================================
-- ตรวจสอบ
-- =============================================================
select maintenance_mode, maintenance_title, maintenance_message
from public.system_settings where id = 1;