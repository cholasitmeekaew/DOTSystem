-- =============================================================
-- 0052: เพิ่มหัวข้อ maintenance + เปิด realtime สำหรับ system_settings
-- =============================================================

-- เพิ่มคอลัมน์หัวข้อ (header) แยกจากเนื้อหา
-- เหมือนฟอร์มประกาศที่มี "หัวข้อประกาศ" + "เนื้อหา"
alter table public.system_settings
  add column if not exists maintenance_title text;

comment on column public.system_settings.maintenance_title is
  'หัวข้อที่แสดงบนหน้า maintenance เช่น "ปิดปรับปรุงระบบชั่วคราว"';

-- ถ้ายังไม่เคยใส่หัวข้อ ให้ใช้ค่าเริ่มต้น
update public.system_settings
set maintenance_title = 'ปิดปรับปรุงระบบชั่วคราว'
where id = 1 and maintenance_title is null;


-- =============================================================
-- เปิด realtime สำหรับ system_settings
--
-- ถ้าไม่เพิ่มตารางนี้ใน publication การกด toggle ที่หน้า Admin
-- จะไม่ส่ง event ไปให้หน้าอื่น → user ทั่วไปไม่เห็นหน้า maintenance
-- จนกว่าจะรีเฟรชเอง
-- =============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'system_settings'
  ) then
    alter publication supabase_realtime add table public.system_settings;
  end if;
end $$;


-- =============================================================
-- ตรวจสอบ
-- =============================================================
select
  maintenance_title,
  maintenance_mode,
  maintenance_message
from public.system_settings where id = 1;

select pubname, schemaname, tablename
from pg_publication_tables
where tablename = 'system_settings';
