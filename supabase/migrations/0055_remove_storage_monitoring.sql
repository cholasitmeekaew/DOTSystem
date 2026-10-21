-- =============================================================
-- 0055: ถอดฟีเจอร์ Storage Monitoring ออกจากฐานข้อมูล
-- =============================================================
-- ลบ RPC และตารางทั้งหมดที่สร้างไว้สำหรับหน้า Storage Monitoring
-- (กราฟพื้นที่ + เครื่องมือ Cleanup + Data Protection Guard)
--
-- รันไฟล์นี้ครั้งเดียวเพื่อเคลียร์ของเดิมออกจาก DB ที่ใช้งานอยู่
-- =============================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_storage_usage',
        'get_storage_file_stats',
        'get_module_image_stats',
        'get_orphan_files',
        'get_module_file_stats',
        'get_module_storage_stats',
        'list_module_files'
      )
  loop
    execute 'drop function if exists ' || f.sig || ' cascade';
  end loop;
end;
$$;

drop table if exists public.storage_module_locations;
drop table if exists public.storage_module_registry;
