-- =============================================================
-- 0061: get_storage_file_stats — นับทุก bucket จริง
-- =============================================================
-- เดิม hardcode 5 bucket ทำให้ไม่นับ 'dot-uploads' (bucket เก่า)
-- ที่ยังมีไฟล์ค้างอยู่ → ยอด "ไฟล์ทั้งหมด" ต่ำกว่าความจริง
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
    count(*)::bigint as file_count,
    coalesce(sum((o.metadata->>'size')::bigint), 0) as total_bytes
  from storage.objects o
  group by o.bucket_id
  order by total_bytes desc;
$$;

grant execute on function public.get_storage_file_stats() to anon, authenticated;

select * from public.get_storage_file_stats();