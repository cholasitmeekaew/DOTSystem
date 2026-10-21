-- =============================================================
-- 0062: RPC นับไฟล์รูปใน Storage รายโมดูล (จาก bucket + โฟลเดอร์จริง)
-- =============================================================
-- ปัญหา:
--   get_module_image_stats นับจาก URL ใน DB เท่านั้น
--   แต่ URL ใน DB ถูก null ไปจำนวนมาก (จาก cleanup bug)
--   → โมดูลที่ยังมีไฟล์จริงใน Storage กลับแสดง 0
--
-- ใหม่:
--   นับไฟล์จริงใน storage.objects แล้ว map ตาม bucket + prefix โฟลเดอร์
--   แต่ละไฟล์ถูกนับครั้งเดียว (ไม่ทับซ้อน/ไม่แชร์กัน)
--
--   officers     ← bucket officer-photos + dot-uploads/officers
--   services     ← prefix evidence (bucket evidence + dot-uploads)
--   announcements← bucket announcements + dot-uploads/announcements
--   vehicles     ← bucket vehicles + dot-uploads/vehicles
--   manual       ← bucket manual + dot-uploads/manual
--
--   ข้ามไฟล์ทดสอบ __diag
-- =============================================================

create or replace function public.get_module_file_stats()
returns table (
  module_key text,
  file_count bigint,
  total_bytes bigint
)
language sql
security definer
set search_path = public
as $$
  with files as (
    select
      o.bucket_id,
      o.name,
      coalesce((o.metadata->>'size')::bigint, 0) as sz,
      split_part(o.name, '/', 1) as prefix
    from storage.objects o
  ),
  mapped as (
    select
      case
        when bucket_id = 'officer-photos' then 'officers'
        when bucket_id = 'announcements'  then 'announcements'
        when bucket_id = 'vehicles'       then 'vehicles'
        when bucket_id = 'manual'         then 'manual'
        when bucket_id = 'dot-uploads' and prefix = 'officers'      then 'officers'
        when bucket_id = 'dot-uploads' and prefix = 'announcements' then 'announcements'
        when bucket_id = 'dot-uploads' and prefix = 'vehicles'      then 'vehicles'
        when bucket_id = 'dot-uploads' and prefix = 'manual'        then 'manual'
        when prefix = 'evidence' then 'services'
        else null
      end as module_key,
      sz
    from files
    where prefix <> '__diag'
  )
  select
    module_key,
    count(*)::bigint as file_count,
    coalesce(sum(sz), 0)::bigint as total_bytes
  from mapped
  where module_key is not null
  group by module_key
  order by 3 desc;
$$;

grant execute on function public.get_module_file_stats() to anon, authenticated;

-- ตรวจสอบ
select * from public.get_module_file_stats();