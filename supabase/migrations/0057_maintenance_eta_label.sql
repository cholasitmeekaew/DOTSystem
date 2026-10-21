-- =============================================================
-- 0057: ข้อความหัวข้อนับถอยหลัง (กำหนดเอง)
-- =============================================================
-- เดิม label "คาดว่าจะเสร็จภายใน" hardcode ไว้ในหน้า Maintenance
-- ใหม่: ให้ Admin พิมพ์ข้อความเองได้
-- =============================================================

alter table public.system_settings
  add column if not exists maintenance_eta_label text;

comment on column public.system_settings.maintenance_eta_label is
  'ข้อความหัวข้อเหนือนับถอยหลัง (ว่าง = ใช้ค่าเริ่มต้น "คาดว่าจะเสร็จภายใน")';

-- =============================================================
-- ตรวจสอบ
-- =============================================================
select maintenance_eta_label, maintenance_eta
from public.system_settings where id = 1;