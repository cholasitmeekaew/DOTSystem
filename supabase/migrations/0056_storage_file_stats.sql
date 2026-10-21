-- =============================================================
-- 0056: RPC สถิติไฟล์รูปภาพใน Supabase Storage
-- =============================================================
-- คืนจำนวนไฟล์ + ขนาดรวม ต่อ bucket
-- เรียกจาก frontend:
--   supabase.rpc('get_storage_file_stats')
-- =============================================================

create or replace function public.get_storage_file_stats()
returns table (
  bucket_id text,
  file_count bigint,
  total_bytes bigint
)
language sql
security definer
set search_path = public
as $$
  select
    o.bucket_id,
    count(*)::bigint                        as file_count,
    coalesce(sum(o.metadata->>'size')::bigint, 0) as total_bytes
  from storage.objects o
  where o.bucket_id in ('officer-photos','announcements','evidence','vehicles','manual')
  group by o.bucket_id
  order by total_bytes desc;
$$;

grant execute on function public.get_storage_file_stats() to anon, authenticated;


-- =============================================================
-- ตรวจสอบ
-- =============================================================
select * from public.get_storage_file_stats();